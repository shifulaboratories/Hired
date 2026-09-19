import type { McpScope } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/data/audit";
import { SCOPE_VALUES } from "@/lib/mcp/scopes";

/**
 * Instance-wide configuration, stored in the database rather than in env vars
 * so an admin can change it from the UI without a redeploy.
 *
 * Everything configurable is declared once, in VARIABLES below. That list is
 * the source of the typed settings object, the defaults, the audit wording and
 * the Variables screen — so adding a knob is one entry here plus a field on
 * InstanceSettings, and nothing has to be taught about it twice.
 *
 * Note the shape of this file against me.ts, resumes.ts and pipeline.ts.
 * Those take `userId` first because they touch one person's content and the
 * compiler has to reject a call site that forgets. Nothing here is anyone's
 * content — it is how the instance behaves — so it follows users.ts and
 * system.ts instead: the writes take the acting admin first, for the audit
 * trail rather than for isolation, and only admins can reach any of it.
 */

/**
 * What answers when nobody has said otherwise.
 *
 * Here rather than inside the assistant's own code because the Variables screen
 * shows it as the placeholder and the fallback, and two copies of a model id is
 * a model id that goes stale in one of them.
 */
export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5";

export const SETTING_KEYS = {
  instanceName: "instance_name",
  resendApiKey: "resend_api_key",
  resendFromEmail: "resend_from_email",
  resendFromName: "resend_from_name",
  publicUrl: "public_url",
  landingUrl: "landing_url",
  companyLogos: "company_logos",
  mcpAllowedOrigins: "mcp_allowed_origins",
  archiveRetentionDays: "archive_retention_days",
  /** Bookkeeping the sweep owns, not a knob. See listVariables. */
  archiveSweptAt: "archive_swept_at",
  revisionRetentionDays: "revision_retention_days",
  /** Bookkeeping again, not a knob. */
  revisionsSweptAt: "revisions_swept_at",
  googleClientId: "google_client_id",
  googleClientSecret: "google_client_secret",
  googleAllowSignup: "google_allow_signup",
  googleAllowedDomains: "google_allowed_domains",
  microsoftClientId: "microsoft_client_id",
  microsoftClientSecret: "microsoft_client_secret",
  stripeSecretKey: "stripe_secret_key",
  stripeWebhookSecret: "stripe_webhook_secret",
  stripePaymentLink: "stripe_payment_link",
  /// The shared secret the digest sweep URL carries. Minted on demand.
  digestToken: "digest_token",
  /// The shared secret /api/sweep/<token> carries. Deliberately NOT the digest
  /// token: a secret that only ever caused mail to be sent must not silently
  /// become one that fetches URLs and reads mailboxes.
  sweepToken: "sweep_token",
  attachmentMaxBytes: "attachment_max_bytes",
  attachmentWorkspaceBytes: "attachment_workspace_bytes",
  outboundEnabled: "outbound_enabled",
  assistantApiKey: "assistant_api_key",
  assistantModel: "assistant_model",
  assistantDailyMessages: "assistant_daily_messages",
  assistantScope: "assistant_scope",
} as const;

export type InstanceSettings = {
  instanceName: string;
  resendApiKey: string;
  resendFromEmail: string;
  resendFromName: string;
  publicUrl: string;
  /** The marketing site in front of this instance, if it has one. */
  landingUrl: string;
  /** Off means no request ever leaves the browser for a logo. */
  companyLogos: boolean;
  /**
   * Extra browser origins allowed to POST to the MCP endpoint, comma separated.
   * Same-origin and loopback are always allowed and are not listed here.
   */
  mcpAllowedOrigins: string;
  /**
   * Days a deleted company, person or application waits in the archive before
   * it is destroyed. 0 keeps everything until somebody empties it by hand.
   */
  archiveRetentionDays: number;
  /**
   * Days a version of a resume or a role, and a line in the change log, is kept
   * before it is swept. 0 keeps everything. This is storage, not content: it
   * holds copies of documents, so the default is finite where the archive's is
   * a person's own decision.
   */
  revisionRetentionDays: number;
  /** Google sign-in. Empty client id means the button is not shown at all. */
  googleClientId: string;
  googleClientSecret: string;
  /** Whether a Google account nobody invited may create an account here. */
  googleAllowSignup: boolean;
  /** Comma-separated domains a new Google account must be on. Empty is any. */
  googleAllowedDomains: string;
  /**
   * A Microsoft Entra app registration, for members who connect their
   * Microsoft 365 mail and calendar. Empty client id means the option is
   * not offered. Never used for sign-in.
   */
  microsoftClientId: string;
  microsoftClientSecret: string;
  /** Stripe, for the instance owner who hosts other people for a fee. */
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  /** A Stripe Payment Link — the public checkout URL for this instance. */
  stripePaymentLink: string;
  /**
   * The secret in the digest sweep URL. Empty means digests never go out on a
   * schedule — a self-hoster mints one in Admin and points their platform's
   * cron at the address it produces. A Setting rather than an env var, because
   * DATABASE_URL is the only variable and that is a promise the README makes.
   */
  digestToken: string;
  /**
   * The secret in the background sweep URL. Empty means the address answers 404
   * for everybody — not open, off — and watched boards, posting liveness and
   * the mail sweep only ever run when somebody asks for them by tool. A Setting
   * rather than an env var, for the reason above.
   */
  sweepToken: string;
  /** Bytes, one file. Every byte here is a byte in the database. */
  attachmentMaxBytes: number;
  /** Bytes, every file one person keeps. */
  attachmentWorkspaceBytes: number;
  /**
   * Whether anybody on this instance may send a message from their own mailbox
   * through the app. OFF by default, and when it is off nothing a member sets
   * on their own profile matters.
   */
  outboundEnabled: boolean;

  /**
   * The built-in assistant. Empty key means the app is exactly what it is
   * without it, minus one button that is never rendered — and there is NO
   * environment-variable fallback, deliberately: DATABASE_URL is the only
   * variable, and that is a promise the README makes.
   */
  assistantApiKey: string;
  assistantModel: string;
  /** Messages one person may send in a day. 0 means no cap. */
  assistantDailyMessages: number;
  /** Which subset of the tools the assistant is served. The same four scopes. */
  assistantScope: McpScope;
};

/**
 * `secret` is never sent to a browser or returned by a tool, and the audit log
 * records only that it moved. `toggle` stores "1" or "0". Everything else is
 * a string that shows its value everywhere.
 */
export type VariableKind = "text" | "url" | "secret" | "toggle";

export type VariableGroup = "Instance" | "Sign-in" | "Accounts" | "Email" | "Billing" | "Assistant";

export type VariableDef = {
  key: string;
  /** The field this key backs on InstanceSettings. */
  field: keyof InstanceSettings;
  label: string;
  help: string;
  kind: VariableKind;
  group: VariableGroup;
  placeholder: string;
  /** What the app uses when no row is stored. Raw, so "1" for a toggle. */
  fallback: string;
};

/** The group a key with no entry here lands in on the Variables screen. */
export const CUSTOM_GROUP = "Custom";

export const VARIABLES: VariableDef[] = [
  {
    key: SETTING_KEYS.instanceName,
    field: "instanceName",
    label: "Instance name",
    help: "What this instance is called. Shown on the sign-in page and in every email it sends.",
    kind: "text",
    group: "Instance",
    placeholder: "Hired",
    fallback: "Hired",
  },
  {
    key: SETTING_KEYS.publicUrl,
    field: "publicUrl",
    label: "Public URL",
    help: "Where this instance is reachable from outside. Invitation links and the Stripe webhook URL are built from it. Left empty, the app guesses from the incoming request, which is right until something sits in front of it.",
    kind: "url",
    group: "Instance",
    placeholder: "https://your-app.up.railway.app",
    fallback: "",
  },
  {
    key: SETTING_KEYS.landingUrl,
    field: "landingUrl",
    label: "Landing page",
    help: "The marketing site in front of this instance, if it has one. When it shares a domain with the app — hired.tools and app.hired.tools — signing in leaves a flag on that shared domain, and somebody already signed in who lands on the marketing page is sent straight through to the app. Empty, or on an unrelated domain, and no flag is written.",
    kind: "url",
    group: "Instance",
    placeholder: "https://hired.tools",
    fallback: "",
  },
  {
    key: SETTING_KEYS.companyLogos,
    field: "companyLogos",
    label: "Company logos",
    // On by default: a job tracker with no logos looks unfinished, and the
    // switch exists for the person who would rather twenty-icons.com not see
    // which companies they are applying to.
    help: "Shows each company's favicon in the pipeline. Fetching it means the browser asks twenty-icons.com for the logo, so that service can see which companies people here are tracking. Off, everyone gets initials instead.",
    kind: "toggle",
    group: "Instance",
    placeholder: "",
    fallback: "1",
  },
  {
    key: SETTING_KEYS.mcpAllowedOrigins,
    field: "mcpAllowedOrigins",
    label: "Extra MCP origins",
    // Empty by default and almost always right that way. The MCP spec makes
    // rejecting a foreign Origin a MUST, and every client in the app library
    // connects from a server or a desktop process, which sends no Origin at
    // all. This exists for the one case that does: a browser-resident client
    // — the MCP Inspector on a machine that is not this one, say — which
    // otherwise gets a 403 with no way for an admin to allow it.
    help: "Browser origins allowed to call the MCP endpoint, comma separated, e.g. https://inspector.example.com. This instance's own address and anything on localhost are always allowed and do not need listing. Almost every client connects from a server or a desktop app and sends no origin, so leaving this empty is normally right. A blocked origin is written to the event log with the address it came from.",
    kind: "text",
    group: "Instance",
    placeholder: "https://inspector.example.com",
    fallback: "",
  },
  {
    key: SETTING_KEYS.archiveRetentionDays,
    field: "archiveRetentionDays",
    label: "Archive retention",
    help: "How many days a deleted company, person or application waits in the archive before it is deleted for good. Everyone on this instance gets the same window. 0 keeps everything until somebody empties it by hand.",
    kind: "text",
    group: "Instance",
    placeholder: "30",
    fallback: "30",
  },
  {
    key: SETTING_KEYS.revisionRetentionDays,
    field: "revisionRetentionDays",
    label: "Version history",
    help: "How many days a previous version of a resume or a role, and a line in the change log, is kept before it is swept. Versions are what undo_change and restore_revision put back, so shortening this shortens how far back somebody can go. 0 keeps everything, which grows without limit.",
    kind: "text",
    group: "Instance",
    placeholder: "90",
    fallback: "90",
  },
  {
    key: SETTING_KEYS.googleClientId,
    field: "googleClientId",
    label: "Google client ID",
    help: "From a Web application OAuth client in the Google Cloud console. Setting this is what puts the Continue with Google button on the sign-in page; clearing it takes the button away.",
    kind: "text",
    group: "Sign-in",
    placeholder: "1234567890-abc.apps.googleusercontent.com",
    fallback: "",
  },
  {
    key: SETTING_KEYS.googleClientSecret,
    field: "googleClientSecret",
    label: "Google client secret",
    help: "From the same OAuth client. Stored on your server and never shown again.",
    kind: "secret",
    group: "Sign-in",
    placeholder: "GOCSPX-...",
    fallback: "",
  },
  {
    key: SETTING_KEYS.googleAllowSignup,
    field: "googleAllowSignup",
    // Off by default, and it has to be: this instance is invite-only
    // everywhere else, and a switch that silently opened the door on upgrade
    // would be a security change nobody asked for.
    help: "Off, Google only signs in people who already have an account or an outstanding invitation — everyone else is sent to the waitlist. On, anyone who can sign in to Google gets an account, so pair it with a domain list unless you mean the whole internet.",
    label: "Let new people sign up with Google",
    kind: "toggle",
    group: "Sign-in",
    placeholder: "",
    fallback: "0",
  },
  {
    key: SETTING_KEYS.googleAllowedDomains,
    field: "googleAllowedDomains",
    label: "Allowed email domains",
    help: "Comma-separated, e.g. acme.com, acme.co.uk. Only checked when sign-up is on, and only for people who are new — an existing member on any domain always signs in. Empty means any domain.",
    kind: "text",
    group: "Sign-in",
    placeholder: "acme.com, acme.co.uk",
    fallback: "",
  },
  {
    key: SETTING_KEYS.microsoftClientId,
    field: "microsoftClientId",
    label: "Microsoft client ID",
    help: "The Application (client) ID of an app registration in Microsoft Entra. Setting it lets each person connect their Microsoft 365 or Outlook.com mail and calendar under Settings → Connections. It is never used for signing in.",
    kind: "text",
    group: "Accounts",
    placeholder: "00000000-0000-0000-0000-000000000000",
    fallback: "",
  },
  {
    key: SETTING_KEYS.microsoftClientSecret,
    field: "microsoftClientSecret",
    label: "Microsoft client secret",
    help: "A client secret from the same app registration. Stored on your server and never shown again. Entra secrets expire — two years at most — so put the date in your calendar.",
    kind: "secret",
    group: "Accounts",
    placeholder: "",
    fallback: "",
  },
  {
    key: SETTING_KEYS.resendApiKey,
    field: "resendApiKey",
    label: "Resend API key",
    help: "Starts with re_. Stored on your server and never shown again.",
    kind: "secret",
    group: "Email",
    placeholder: "re_...",
    fallback: "",
  },
  {
    key: SETTING_KEYS.resendFromEmail,
    field: "resendFromEmail",
    label: "From address",
    help: "Must be on a domain you have verified in Resend, or every send is rejected.",
    kind: "text",
    group: "Email",
    placeholder: "hello@yourdomain.com",
    fallback: "",
  },
  {
    key: SETTING_KEYS.resendFromName,
    field: "resendFromName",
    label: "From name",
    help: "The display name on outgoing mail.",
    kind: "text",
    group: "Email",
    placeholder: "Hired",
    fallback: "Hired",
  },
  {
    key: SETTING_KEYS.stripeSecretKey,
    field: "stripeSecretKey",
    label: "Stripe secret key",
    help: "A restricted rk_ key with read-only Customers and Subscriptions is enough, and safer than the full sk_ key.",
    kind: "secret",
    group: "Billing",
    placeholder: "rk_live_… or sk_live_…",
    fallback: "",
  },
  {
    key: SETTING_KEYS.stripeWebhookSecret,
    field: "stripeWebhookSecret",
    label: "Stripe signing secret",
    help: "From the webhook you registered in Stripe. Without it every incoming event is refused.",
    kind: "secret",
    group: "Billing",
    placeholder: "whsec_…",
    fallback: "",
  },
  {
    key: SETTING_KEYS.stripePaymentLink,
    field: "stripePaymentLink",
    label: "Stripe payment link",
    help: "The public checkout URL — put it wherever you send people who want in.",
    kind: "url",
    group: "Billing",
    placeholder: "https://buy.stripe.com/…",
    fallback: "",
  },
  {
    key: SETTING_KEYS.digestToken,
    field: "digestToken",
    label: "Digest sweep token",
    help: "The secret in /api/digest/<token>. Point your host's scheduler at that address hourly and the people who asked for a weekly summary or a due-today nudge get one. Empty means nothing is sent on a schedule; anybody can still ask for one by hand.",
    kind: "secret",
    group: "Email",
    placeholder: "A long random string",
    fallback: "",
  },
  {
    key: SETTING_KEYS.sweepToken,
    field: "sweepToken",
    label: "Background sweep token",
    help: "The secret in /api/sweep/<token>. Point your host's scheduler at that address and watched company boards get checked, job postings get re-read to see whether they came down, and anyone who turned on the mail sweep has their inbox looked at. Add ?only=boards, ?only=postings or ?only=mail to run one on its own schedule. Empty means the address answers 404 — not open, off.",
    kind: "secret",
    group: "Instance",
    placeholder: "A long random string",
    fallback: "",
  },
  {
    key: SETTING_KEYS.attachmentMaxBytes,
    field: "attachmentMaxBytes",
    label: "Largest attachment",
    help: "Bytes, for one file. 8MB by default — a signed offer letter is well under one, and every byte here is a byte in your database rather than in an object store this app deliberately does not have.",
    kind: "text",
    group: "Instance",
    placeholder: "8000000",
    fallback: "8000000",
  },
  {
    key: SETTING_KEYS.attachmentWorkspaceBytes,
    field: "attachmentWorkspaceBytes",
    label: "Attachments per workspace",
    help: "Bytes, across every file one person keeps. 250MB by default. At the cap, attaching refuses and says how much is in use so they can delete something.",
    kind: "text",
    group: "Instance",
    placeholder: "250000000",
    fallback: "250000000",
  },
  {
    key: SETTING_KEYS.outboundEnabled,
    field: "outboundEnabled",
    label: "Members may send mail",
    help: "Off by default. When off, nobody on this instance can send a message from their own mailbox through the app, whatever their own settings say. On, each person still has to turn it on for themselves and set a daily number, and every message still goes from their own account rather than from this instance.",
    kind: "toggle",
    group: "Email",
    placeholder: "",
    fallback: "0",
  },
  {
    key: SETTING_KEYS.assistantApiKey,
    field: "assistantApiKey",
    label: "Anthropic API key",
    help: "Turns on the assistant built into this app — a chat that talks to this instance's own tools, so a fresh deploy is conversational without connecting a second application. Empty means the button is never rendered and nothing here calls out. Billing is yours: get a key from console.anthropic.com. Connecting Claude or another MCP client instead costs this instance nothing, and is usually better.",
    kind: "secret",
    group: "Assistant",
    placeholder: "sk-ant-…",
    fallback: "",
  },
  {
    key: SETTING_KEYS.assistantModel,
    field: "assistantModel",
    label: "Model",
    help: "Which model answers. Leave it alone unless you have a reason.",
    kind: "text",
    group: "Assistant",
    placeholder: DEFAULT_ASSISTANT_MODEL,
    fallback: DEFAULT_ASSISTANT_MODEL,
  },
  {
    key: SETTING_KEYS.assistantDailyMessages,
    field: "assistantDailyMessages",
    label: "Messages a day, each",
    help: "How many messages one person may send in a day, counted in their own time zone. 0 means no cap at all, which on a key you are paying for is a decision rather than a default.",
    kind: "text",
    group: "Assistant",
    placeholder: "50",
    fallback: "50",
  },
  {
    key: SETTING_KEYS.assistantScope,
    field: "assistantScope",
    label: "Tools it is served",
    help: "FULL, WRITING, PIPELINE or READONLY — the same four a connection can be narrowed to. This is the one honest cost lever: the whole tool surface is roughly sixty thousand tokens of definitions on every turn, and WRITING is about a quarter of that. It is not a permission; the assistant runs as whoever is signed in.",
    kind: "text",
    group: "Assistant",
    placeholder: "FULL",
    fallback: "FULL",
  },
];

const BY_KEY = new Map(VARIABLES.map((variable) => [variable.key, variable]));

/**
 * A key an admin invents. Lowercase, underscores, no spaces — the same shape
 * as the keys above, so a variable added by hand today reads like one that
 * grows a form tomorrow.
 */
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export function assertVariableKey(key: string) {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      "A variable key is lowercase letters, numbers and underscores, starting with a letter — like retention_days.",
    );
  }
}

/** Raw stored values for the declared keys, so a write can tell what changed. */
async function getSettingsMap() {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(SETTING_KEYS) } },
  });
  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function getSettings(): Promise<InstanceSettings> {
  const map = await getSettingsMap();
  const raw = (key: string) => map.get(key) ?? BY_KEY.get(key)?.fallback ?? "";
  return {
    instanceName: raw(SETTING_KEYS.instanceName),
    resendApiKey: raw(SETTING_KEYS.resendApiKey),
    resendFromEmail: raw(SETTING_KEYS.resendFromEmail),
    resendFromName: raw(SETTING_KEYS.resendFromName),
    publicUrl: raw(SETTING_KEYS.publicUrl),
    landingUrl: raw(SETTING_KEYS.landingUrl),
    companyLogos: raw(SETTING_KEYS.companyLogos) !== "0",
    mcpAllowedOrigins: raw(SETTING_KEYS.mcpAllowedOrigins),
    archiveRetentionDays: retentionDays(raw(SETTING_KEYS.archiveRetentionDays)),
    revisionRetentionDays: retentionDays(raw(SETTING_KEYS.revisionRetentionDays)),
    googleClientId: raw(SETTING_KEYS.googleClientId),
    googleClientSecret: raw(SETTING_KEYS.googleClientSecret),
    googleAllowSignup: raw(SETTING_KEYS.googleAllowSignup) === "1",
    googleAllowedDomains: raw(SETTING_KEYS.googleAllowedDomains),
    microsoftClientId: raw(SETTING_KEYS.microsoftClientId),
    microsoftClientSecret: raw(SETTING_KEYS.microsoftClientSecret),
    stripeSecretKey: raw(SETTING_KEYS.stripeSecretKey),
    stripeWebhookSecret: raw(SETTING_KEYS.stripeWebhookSecret),
    stripePaymentLink: raw(SETTING_KEYS.stripePaymentLink),
    digestToken: raw(SETTING_KEYS.digestToken),
    sweepToken: raw(SETTING_KEYS.sweepToken),
    outboundEnabled: raw(SETTING_KEYS.outboundEnabled) === "1",
    assistantApiKey: raw(SETTING_KEYS.assistantApiKey),
    assistantModel: raw(SETTING_KEYS.assistantModel).trim() || DEFAULT_ASSISTANT_MODEL,
    assistantDailyMessages: byteCap(raw(SETTING_KEYS.assistantDailyMessages), 50, 10_000),
    assistantScope: readScope(raw(SETTING_KEYS.assistantScope)),
    attachmentMaxBytes: byteCap(raw(SETTING_KEYS.attachmentMaxBytes), 8_000_000, 100_000_000),
    attachmentWorkspaceBytes: byteCap(
      raw(SETTING_KEYS.attachmentWorkspaceBytes),
      250_000_000,
      50_000_000_000,
    ),
  };
}

/**
 * How long the archive holds on to something, as a number of days.
 *
 * Every other field in InstanceSettings is a raw string or a "1"/"0" toggle;
 * this one is arithmetic, so it is parsed once here rather than at each of the
 * three places that count days. Clamped rather than rejected: an admin who
 * types "3650" gets ten years, one who types "banana" gets the default back,
 * and neither ends up with a bin that empties immediately.
 */
/**
 * A byte cap an admin typed, with a floor and a ceiling.
 *
 * Nonsense falls back to the default rather than to zero: a cap of zero would
 * refuse every attachment with a message about a setting nobody meant to set.
 */
/**
 * A stored scope, or FULL.
 *
 * Validated rather than cast: a typo saved through admin_set_variable would
 * otherwise reach toolsFor() as a scope nothing matches, and the assistant
 * would quietly be served an empty tool list — which looks like a broken model
 * rather than like a bad setting.
 */
function readScope(value: string): McpScope {
  const upper = value.trim().toUpperCase();
  return (SCOPE_VALUES as readonly string[]).includes(upper) ? (upper as McpScope) : "FULL";
}

function byteCap(raw: string, fallback: number, ceiling: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, ceiling);
}

export function retentionDays(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 30;
  return Math.min(parsed, 3650);
}

export async function setSetting(key: string, value: string) {
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

type Actor = { id: string; email: string };

/** What a value looks like when nothing is stored, in words. */
function defaultText(variable: VariableDef) {
  if (variable.kind === "toggle") return variable.fallback === "0" ? "off" : "on";
  return variable.fallback || "empty";
}

/**
 * How a change reads in the audit log.
 *
 * A secret records that the field was set, never what it was set to.
 * Everything else records the new value, because "Public URL →
 * https://app.hired.tools" is the whole reason you would read the row.
 */
function describeChange(key: string, value: string) {
  const variable = BY_KEY.get(key);
  if (!variable) return `${key} → ${value || "(empty)"}`;
  if (variable.kind === "secret") return `${variable.label} ${value ? "set" : "cleared"}`;
  if (variable.kind === "toggle") return `${variable.label} → ${value === "0" ? "off" : "on"}`;
  return `${variable.label} → ${value || "(empty)"}`;
}

/**
 * The one write path. Compares against what is stored, saves what actually
 * moved, and records a single audit row naming every field that changed.
 *
 * A save that changes nothing writes nothing — the panels send every field on
 * every submit, so without the comparison the log would fill with rows
 * recording that somebody opened a form.
 */
async function applyChanges(actor: Actor, entries: [string, string][]) {
  if (entries.length === 0) return [];

  const rows = await db.setting.findMany({
    where: { key: { in: entries.map(([key]) => key) } },
  });
  const before = new Map(rows.map((row) => [row.key, row.value]));
  const changed: string[] = [];

  for (const [key, value] of entries) {
    const next = value.trim();
    if ((before.get(key) ?? "") === next) continue;
    await setSetting(key, next);
    changed.push(describeChange(key, next));
  }

  if (changed.length > 0) {
    await recordAudit({ actor, action: "settings.change", detail: changed.join(", ") });
  }
  return changed;
}

/**
 * Change instance configuration.
 *
 * The actor is first and required, the same shape as `setUserRole` and
 * `adminResetPassword`, and for the same reason: the compiler rejects a call
 * site that forgets, so nothing can change how the instance behaves without a
 * name attached. That matters most for the quietest failure this app has —
 * clearing the Resend key breaks every future invitation and produces no error
 * anywhere until somebody notices they were never emailed.
 */
export async function updateSettings(actor: Actor, patch: Partial<InstanceSettings>) {
  const entries: [string, string][] = [];
  for (const variable of VARIABLES) {
    const value = patch[variable.field];
    if (value === undefined) continue;
    entries.push([
      variable.key,
      variable.kind === "toggle" ? (value ? "1" : "0") : String(value),
    ]);
  }
  return applyChanges(actor, entries);
}

export type VariableRow = {
  key: string;
  label: string;
  help: string;
  kind: VariableKind;
  group: string;
  /** Masked when the variable is a secret — the raw value never leaves here. */
  value: string;
  placeholder: string;
  /** What this falls back to with nothing stored, in words. */
  fallbackText: string;
  hasValue: boolean;
  /** True when no row is stored and the built-in default is in force. */
  isDefault: boolean;
  /** False for a key an admin invented, which has no form of its own. */
  known: boolean;
  updatedAt: string | null;
};

/**
 * Every configurable value on this instance, declared ones first and anything
 * an admin added after them. Secrets come back masked, which is why this is
 * safe to hand straight to a client component.
 */
export async function listVariables(): Promise<VariableRow[]> {
  const rows = await db.setting.findMany({ orderBy: { key: "asc" } });
  const stored = new Map(rows.map((row) => [row.key, row]));

  const declared = VARIABLES.map((variable) => {
    const row = stored.get(variable.key);
    const value = row?.value ?? variable.fallback;
    return {
      key: variable.key,
      label: variable.label,
      help: variable.help,
      kind: variable.kind,
      group: variable.group as string,
      value: variable.kind === "secret" ? maskSecret(value) : value,
      placeholder: variable.placeholder,
      fallbackText: defaultText(variable),
      hasValue: Boolean(value),
      isDefault: !row,
      known: true,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });

  const custom = rows
    // archive_swept_at is a clock the sweep keeps, not a knob anybody sets. An
    // operator screen of settings should not carry a timestamp that changes on
    // its own every hour.
    .filter(
      (row) =>
        !BY_KEY.has(row.key) &&
        row.key !== SETTING_KEYS.archiveSweptAt &&
        row.key !== SETTING_KEYS.revisionsSweptAt,
    )
    .map((row) => ({
      key: row.key,
      label: row.key,
      help: "",
      kind: "text" as VariableKind,
      group: CUSTOM_GROUP,
      value: row.value,
      placeholder: "",
      fallbackText: "empty",
      hasValue: Boolean(row.value),
      isDefault: false,
      known: false,
      updatedAt: row.updatedAt.toISOString(),
    }));

  return [...declared, ...custom];
}

/**
 * Write variables by key. Unknown keys are created, which is how a setting
 * exists before it has a form of its own.
 */
export async function setVariables(actor: Actor, patch: Record<string, string>) {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(patch)) {
    const variable = BY_KEY.get(key);
    if (!variable) assertVariableKey(key);
    // Same rule as the guided forms: blank means keep what's there.
    if (variable?.kind === "secret" && value.trim() === "") continue;
    entries.push([
      key,
      variable?.kind === "toggle" ? (value === "1" || value === "true" ? "1" : "0") : value,
    ]);
  }
  return applyChanges(actor, entries);
}

/**
 * Remove a variable's stored value. A declared key falls back to its built-in
 * default; a custom one disappears.
 */
export async function deleteVariable(actor: Actor, key: string) {
  const existing = await db.setting.findUnique({ where: { key } });
  if (!existing) return { deleted: false, key };

  await db.setting.delete({ where: { key } });

  const variable = BY_KEY.get(key);
  const detail = !variable
    ? `Variable ${key} removed`
    : variable.kind === "secret"
      ? `${variable.label} cleared`
      : `${variable.label} reset to ${defaultText(variable)}`;
  await recordAudit({ actor, action: "settings.change", detail });

  return { deleted: true, key, detail };
}

/**
 * The assistant answers only when there is a key. Nothing falls back to an
 * environment variable, ever — see the field's own comment.
 */
export function assistantIsConfigured(settings: InstanceSettings): boolean {
  return settings.assistantApiKey.trim() !== "";
}

export function emailIsConfigured(settings: InstanceSettings) {
  return Boolean(settings.resendApiKey && settings.resendFromEmail);
}

/**
 * Both halves or nothing. A client id with no secret would show the button and
 * fail at the callback, which is a worse failure than no button.
 */
/** Whether members can connect a Microsoft 365 account at all. */
export function microsoftIsConfigured(settings: InstanceSettings) {
  return Boolean(settings.microsoftClientId && settings.microsoftClientSecret);
}

export function googleIsConfigured(settings: InstanceSettings) {
  return Boolean(settings.googleClientId && settings.googleClientSecret);
}

export function billingIsConfigured(settings: InstanceSettings) {
  return Boolean(settings.stripeSecretKey && settings.stripeWebhookSecret);
}

/** Never send the raw key to the browser. */
export function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 5)}${"•".repeat(18)}${value.slice(-4)}`;
}
