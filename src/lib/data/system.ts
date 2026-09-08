import type { SystemEventLevel } from "@prisma/client";
import { db } from "@/lib/db";
import { billingIsConfigured, emailIsConfigured, getSettings } from "@/lib/settings";

/**
 * Whether the instance is working, and what broke when it wasn't.
 *
 * Note the shape of this file against me.ts, resumes.ts and pipeline.ts.
 * Those take `userId` first because they touch one person's content and the
 * compiler has to reject a call site that forgets. Nothing here is anyone's
 * content — it is the instance talking about itself — so it follows users.ts
 * and waitlist.ts instead: no `userId`, and only admins can reach it. That is
 * the same distinction those files already draw, not a new exception.
 *
 * Two halves:
 *
 *   `recordSystemEvent` writes what happened. Call it from the edges that can
 *   fail quietly — the Stripe webhook, an email send, a tool call, a page that
 *   threw.
 *
 *   `instanceHealth` reads the current state. Live checks where a live check is
 *   possible (can we reach the database, are migrations applied) and "when did
 *   this last work" from the event stream where it isn't — you cannot ping
 *   Stripe to ask whether it is still delivering your webhooks, you can only
 *   notice that one arrived recently.
 */

/** How long a row lives before `sweepSystemEvents` removes it. */
const RETENTION_DAYS = 30;

/** Long enough to diagnose, short enough that nothing pastes a payload in. */
const DETAIL_LIMIT = 300;

export type SystemEventSource =
  | "stripe.webhook"
  | "billing.sync"
  | "email.send"
  | "google.signin"
  | "google.data"
  | "microsoft.data"
  | "mcp.tool"
  | "app";

/**
 * Record something the instance did.
 *
 * **Never pass an operation's inputs.** A message produced by a failure is fine
 * — "Resend returned 422", "Missing required argument: role_id". The arguments
 * that produced it are someone's content, and every admin reads this table.
 *
 * This never throws. It is called from catch blocks, including catch blocks
 * around database work, and a logger that fails the request it was logging is
 * worse than no logger.
 */
export async function recordSystemEvent(input: {
  level?: SystemEventLevel;
  source: SystemEventSource;
  message: string;
  detail?: string;
  userEmail?: string;
}) {
  try {
    await db.systemEvent.create({
      data: {
        level: input.level ?? "ERROR",
        source: input.source,
        message: input.message.slice(0, DETAIL_LIMIT),
        detail: (input.detail ?? "").slice(0, DETAIL_LIMIT),
        userEmail: input.userEmail ?? "",
      },
    });
  } catch {
    // Nothing to do about it here, and nothing worth breaking a request over.
  }
}

export async function listSystemEvents(options?: {
  limit?: number;
  level?: SystemEventLevel;
  source?: SystemEventSource;
  /** Only what happened to one person's requests. Matched by address, since
   *  a row outlives the account it describes. */
  userEmail?: string;
}) {
  return db.systemEvent.findMany({
    where: {
      ...(options?.level ? { level: options.level } : {}),
      ...(options?.source ? { source: options.source } : {}),
      ...(options?.userEmail ? { userEmail: options.userEmail } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(options?.limit ?? 50, 200),
  });
}

/** Drop anything past the retention window. Cheap; call it opportunistically. */
export async function sweepSystemEvents() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  await db.systemEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type HealthStatus = "ok" | "warn" | "down";

export type HealthCheck = {
  key: string;
  label: string;
  status: HealthStatus;
  /** One plain sentence. This is the whole answer for most people. */
  summary: string;
  /** Optional specifics, shown underneath. */
  detail: string;
};

const DAY = 86_400_000;

function ago(date: Date | null): string {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

async function lastEvent(source: SystemEventSource, level?: SystemEventLevel) {
  return db.systemEvent.findFirst({
    where: { source, ...(level ? { level } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * The database check is also the honest one to run first: if it fails, most of
 * the others cannot be answered, so they say so rather than guessing.
 */
async function checkDatabase(): Promise<HealthCheck & { up: boolean }> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const ms = Date.now() - started;
    return {
      key: "database",
      label: "Database",
      status: ms > 1000 ? "warn" : "ok",
      summary: ms > 1000 ? `Responding slowly — ${ms}ms` : `Responding in ${ms}ms`,
      detail: "",
      up: true,
    };
  } catch (error) {
    return {
      key: "database",
      label: "Database",
      status: "down",
      summary: "Cannot reach the database.",
      detail: error instanceof Error ? error.message.slice(0, DETAIL_LIMIT) : "",
      up: false,
    };
  }
}

/**
 * Migrations apply on boot. A half-applied one is the failure mode where the
 * app is up, looks fine, and every query touching the new column throws — so
 * it is worth naming rather than leaving to be discovered.
 */
async function checkMigrations(): Promise<HealthCheck> {
  try {
    const rows = await db.$queryRaw<{ migration_name: string; failed: boolean }[]>`
      SELECT migration_name,
             (finished_at IS NULL OR rolled_back_at IS NOT NULL) AS failed
      FROM _prisma_migrations
      ORDER BY started_at DESC
      LIMIT 50
    `;
    const bad = rows.filter((row) => row.failed);
    if (bad.length > 0) {
      return {
        key: "migrations",
        label: "Migrations",
        status: "down",
        summary: `${bad.length} did not finish.`,
        detail: bad.map((row) => row.migration_name).join(", "),
      };
    }
    return {
      key: "migrations",
      label: "Migrations",
      status: "ok",
      summary: `${rows.length} applied, latest ${rows[0]?.migration_name ?? "none"}.`,
      detail: "",
    };
  } catch {
    return {
      key: "migrations",
      label: "Migrations",
      status: "warn",
      summary: "Could not read the migration table.",
      detail: "",
    };
  }
}

export async function instanceHealth(): Promise<{
  checks: HealthCheck[];
  errorsLastDay: number;
}> {
  const database = await checkDatabase();
  if (!database.up) {
    const { up: _up, ...check } = database;
    return { checks: [check], errorsLastDay: 0 };
  }

  const since = new Date(Date.now() - DAY);
  const [
    settings,
    migrations,
    lastEmail,
    lastEmailFail,
    lastWebhook,
    lastWebhookOk,
    connection,
    errorsLastDay,
  ] = await Promise.all([
    getSettings(),
    checkMigrations(),
    lastEvent("email.send"),
    lastEvent("email.send", "ERROR"),
    lastEvent("stripe.webhook"),
    lastEvent("stripe.webhook", "INFO"),
    db.mcpConnection.findFirst({
      where: { lastUsedAt: { not: null } },
      orderBy: { lastUsedAt: "desc" },
      select: { lastUsedAt: true },
    }),
    db.systemEvent.count({ where: { level: "ERROR", createdAt: { gte: since } } }),
  ]);

  const { up: _up, ...databaseCheck } = database;
  const checks: HealthCheck[] = [databaseCheck, migrations];

  // Email. "Configured" is not the same as "working", so the last actual send
  // outranks the settings — a key that stopped working still looks configured.
  if (!emailIsConfigured(settings)) {
    checks.push({
      key: "email",
      label: "Email",
      status: "warn",
      summary: "Not configured, so invites have to be sent by hand.",
      detail: "Add a Resend API key and a from address in the Email tab.",
    });
  } else if (lastEmailFail && (!lastEmail || lastEmailFail.id === lastEmail.id)) {
    checks.push({
      key: "email",
      label: "Email",
      status: "down",
      summary: `The last send failed, ${ago(lastEmailFail.createdAt)}.`,
      detail: lastEmailFail.message,
    });
  } else {
    checks.push({
      key: "email",
      label: "Email",
      status: "ok",
      summary: lastEmail ? `Last send ${ago(lastEmail.createdAt)}.` : "Configured, nothing sent yet.",
      detail: "",
    });
  }

  // Billing. The question worth answering is not "is the key set" but "is
  // Stripe still reaching us" — entitlement only stays correct while webhooks
  // arrive, and a webhook that silently stops produces no error anywhere.
  //
  // "A webhook arrived" is not the same as "a webhook worked", and conflating
  // them is how this check would report green on its own worst case: the wrong
  // signing secret rejects every delivery, so deliveries keep arriving and
  // billing is completely broken. So the last *successful* one is what counts,
  // and a rejection with nothing successful behind it is a down, not a warn.
  if (!billingIsConfigured(settings)) {
    checks.push({
      key: "billing",
      label: "Billing",
      status: "ok",
      summary: "Not configured. Nobody is being charged.",
      detail: "",
    });
  } else if (!lastWebhook) {
    checks.push({
      key: "billing",
      label: "Billing",
      status: "warn",
      summary: "Configured, but Stripe has never called the webhook.",
      detail: "Check the endpoint URL and its events in the Stripe dashboard.",
    });
  } else if (lastWebhook.level === "INFO") {
    const stale = Date.now() - lastWebhook.createdAt.getTime() > 30 * DAY;
    checks.push({
      key: "billing",
      label: "Billing",
      status: stale ? "warn" : "ok",
      summary: `Last delivery ${ago(lastWebhook.createdAt)}.`,
      detail: stale ? "Nothing in a month. Check the endpoint is still enabled." : "",
    });
  } else {
    // The most recent delivery failed. Whether that is a broken instance or a
    // stray probe depends on whether anything has succeeded lately.
    const recentlyWorked =
      lastWebhookOk && Date.now() - lastWebhookOk.createdAt.getTime() < 7 * DAY;
    checks.push({
      key: "billing",
      label: "Billing",
      status: recentlyWorked ? "warn" : "down",
      summary: recentlyWorked
        ? `A delivery failed ${ago(lastWebhook.createdAt)}, but others are getting through.`
        : `No delivery has succeeded. The last one failed ${ago(lastWebhook.createdAt)}.`,
      detail: lastWebhook.message,
    });
  }

  checks.push({
    key: "assistants",
    label: "Assistants",
    status: "ok",
    summary: connection?.lastUsedAt
      ? `Last tool call ${ago(connection.lastUsedAt)}.`
      : "No assistant has connected yet.",
    detail: "",
  });

  checks.push({
    key: "errors",
    label: "Errors",
    status: errorsLastDay === 0 ? "ok" : errorsLastDay > 20 ? "down" : "warn",
    summary:
      errorsLastDay === 0
        ? "Nothing failed in the last 24 hours."
        : `${errorsLastDay} in the last 24 hours.`,
    detail: "",
  });

  return { checks, errorsLastDay };
}
