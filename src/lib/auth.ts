import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma, User, UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { sweepArchive } from "@/lib/data/archive";
import { getSettings } from "@/lib/settings";
import { baseUrlFrom } from "@/lib/request-url";

const SESSION_COOKIE = "hired_session";

/**
 * The name this cookie had before the rename. Sessions are rows in the
 * database keyed by token, not by cookie name, so reading the old name keeps
 * everyone signed in through the deploy that renamed it — otherwise a branding
 * change silently logs out every person on the instance.
 *
 * Safe to delete once every live session predating the rename has expired,
 * which is 30 days after it shipped.
 */
const LEGACY_SESSION_COOKIE = "resume_os_session";

async function sessionToken(jar: Awaited<ReturnType<typeof cookies>>) {
  return jar.get(SESSION_COOKIE)?.value ?? jar.get(LEGACY_SESSION_COOKIE)?.value;
}
const SESSION_DAYS = 30;

/**
 * How long a session lasts when the person did not tick "keep me signed in".
 * Its cookie also loses its expiry, so closing the browser ends it — this is
 * the backstop for the browser that is never closed.
 */
const UNREMEMBERED_HOURS = 12;

// ---------------------------------------------------------------------------
// The signed-in hint — how a landing page knows to send somebody to the app
// ---------------------------------------------------------------------------

/**
 * A cookie that says "somebody is signed in on this instance", and nothing else.
 *
 * hired.tools is a static site on its own origin, so it cannot ask this app
 * anything: the session cookie is SameSite=Lax and is simply not sent on a
 * cross-site request, and relaxing it to None so that one would work trades a
 * real defence against cross-site requests for a convenience. What two hosts
 * under one domain can share is a cookie on the domain above them both, so
 * signing in leaves a "1" up there and the landing page reads it in two lines
 * of script.
 *
 * Readable by script on purpose, and it carries no authority — the session
 * token stays httpOnly on the app's own host. The worst a forged one does is
 * send somebody to a sign-in page.
 */
const SIGNED_IN_COOKIE = "hired_signed_in";

/**
 * The domain the app and its landing page have in common, or null when they
 * have none worth writing to.
 *
 * It is the longest run of labels the two hosts share, which means it can never
 * be wider than the landing page an admin wrote down, whatever Host header a
 * request arrives with. Two labels is the floor. `.co.uk` is the case this
 * deliberately does not get clever about — a browser refuses a cookie on a
 * public suffix, so the hint is simply never stored and the landing page shows
 * the landing page.
 */
export function sharedCookieDomain(appHost: string, landingUrl: string): string | null {
  const app = appHost.split(":")[0].trim().toLowerCase();
  let landing = "";
  try {
    const url = /^https?:\/\//i.test(landingUrl) ? landingUrl : `https://${landingUrl}`;
    landing = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!app || !landing) return null;

  const left = app.split(".");
  const right = landing.split(".");
  const shared: string[] = [];
  while (left.length > 0 && right.length > 0 && left[left.length - 1] === right[right.length - 1]) {
    shared.unshift(left.pop() as string);
    right.pop();
  }
  return shared.length >= 2 ? shared.join(".") : null;
}

/**
 * Where the hint goes on this instance, or null when it goes nowhere — which is
 * every instance that has not configured a landing page, meaning almost every
 * self-hosted one.
 *
 * The Public URL setting first and the request second, the same order the rest
 * of the app resolves its own address in; `baseUrlFrom` is what knows about the
 * forwarded headers every supported deployment sits behind.
 */
export async function signedInHintDomain(): Promise<string | null> {
  const { landingUrl, publicUrl } = await getSettings();
  if (!landingUrl.trim()) return null;

  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  };
  // A Public URL too malformed to parse should cost the redirect, not the login.
  const host = (publicUrl.trim() && hostOf(publicUrl)) || hostOf(baseUrlFrom(await headers()));
  return host ? sharedCookieDomain(host, landingUrl) : null;
}

type Jar = Awaited<ReturnType<typeof cookies>>;

/** Leave the hint. No expiry means it dies with the browser, like the session. */
async function writeSignedInHint(jar: Jar, expires?: Date) {
  const domain = await signedInHintDomain();
  if (!domain) return;
  jar.set(SIGNED_IN_COOKIE, "1", {
    // Not httpOnly: a script on the landing page is the only thing that reads it.
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    domain,
    ...(expires ? { expires } : {}),
  });
}

/** Take it away again. Deleting a cookie means naming the domain it was set on. */
async function clearSignedInHint(jar: Jar) {
  const domain = await signedInHintDomain();
  if (!domain) return;
  jar.set(SIGNED_IN_COOKIE, "", { path: "/", domain, maxAge: 0 });
}

// ---------------------------------------------------------------------------
// Passwords — scrypt from the standard library, no native dependency.
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_r}:${SCRYPT_p}:${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  // An empty hash is the unclaimed-placeholder marker; nothing may match it.
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const actual = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function generateMcpToken() {
  return `rsm_${randomBytes(24).toString("hex")}`;
}

function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

export function generateInviteToken() {
  return randomBytes(24).toString("hex");
}

// ---------------------------------------------------------------------------
// Instance setup
// ---------------------------------------------------------------------------

/**
 * What makes an account real.
 *
 * The migration to multi-user left behind a placeholder row owning any
 * single-user-era data: no password, and nothing may sign in as it. For a long
 * time "has a password" and "is a real account" were the same sentence, so the
 * check was spelled `passwordHash != ""` in sixteen places.
 *
 * Google sign-in breaks that: someone who has only ever used Google has no
 * password and is entirely real. So the rule gets a name and one
 * implementation — a Prisma fragment for queries and a predicate for rows in
 * hand — because sixteen copies of a rule is sixteen chances for the next
 * sign-in method to lock somebody out of one screen and not the others.
 */
export const CLAIMED: Prisma.UserWhereInput = {
  OR: [{ passwordHash: { not: "" } }, { googleId: { not: null } }],
};

export function isClaimed(user: { passwordHash: string; googleId: string | null }) {
  return Boolean(user.passwordHash || user.googleId);
}

/** The instance is unclaimed until somebody who can sign in exists. */
export async function instanceNeedsSetup() {
  return (await db.user.count({ where: CLAIMED })) === 0;
}

export function setupKeyIsRequired() {
  return Boolean(process.env.APP_PASSWORD);
}

export function setupKeyMatches(candidate: string) {
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return true; // nothing configured — nothing to check
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Claim the instance as super admin. Adopts the placeholder owner when one
 * exists so data from the single-user era keeps its ids and simply changes
 * hands, rather than being orphaned or deleted.
 */
export async function claimInstance(input: {
  email: string;
  name: string;
  password: string;
}) {
  if (!(await instanceNeedsSetup())) {
    throw new Error("This instance has already been set up.");
  }

  const email = input.email.trim().toLowerCase();
  const placeholder = await db.user.findFirst({ where: { passwordHash: "", googleId: null } });

  const data = {
    email,
    name: input.name.trim(),
    passwordHash: hashPassword(input.password),
    role: "SUPER_ADMIN" as const,
    isActive: true,
    emailProvenAt: new Date(),
  };

  const user = placeholder
    ? await db.user.update({ where: { id: placeholder.id }, data })
    : await db.user.create({ data });

  await ensureDefaultConnection(user.id);
  return user;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Sign this browser in. `remember` is the sign-in page's "keep me signed in":
 * on, a session lasts a month and survives the browser closing; off, it is a
 * few hours and dies with the window, which is what somebody on a borrowed
 * machine is asking for. Everything else that starts a session — setup,
 * accepting an invitation, changing your own password — is already a
 * deliberate act on a machine you own, so it takes the default.
 */
export async function startSession(userId: string, options: { remember?: boolean } = {}) {
  const remember = options.remember !== false;
  const token = generateSessionToken();
  const expiresAt = new Date(
    Date.now() + (remember ? SESSION_DAYS * 86400_000 : UNREMEMBERED_HOURS * 3600_000),
  );
  const headerList = await headers();

  await db.session.create({
    data: {
      token,
      userId,
      expiresAt,
      userAgent: (headerList.get("user-agent") ?? "").slice(0, 200),
    },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // No expiry when they did not ask to be remembered: the cookie goes when
    // the browser does, and the row above expires on its own soon after.
    ...(remember ? { expires: expiresAt } : {}),
  });
  await writeSignedInHint(jar, remember ? expiresAt : undefined);
}

/**
 * A session that exists only long enough for the PDF renderer to load one page.
 *
 * Deliberately an ordinary Session row rather than a new kind of token: the
 * print page keeps its `requireUser()` guard, so there is no new authentication
 * bypass to reason about, and this inherits every check that already applies —
 * a suspended user's ephemeral session is rejected exactly like any other.
 * Callers must delete it when they're done; the short expiry is the backstop.
 */
export async function createEphemeralSession(userId: string, seconds = 120) {
  const token = generateSessionToken();
  await db.session.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + seconds * 1000),
      userAgent: "hired-pdf-renderer",
    },
  });
  return token;
}

export async function destroySession(token: string) {
  await db.session.deleteMany({ where: { token } });
}

export async function endSession() {
  const jar = await cookies();
  const token = await sessionToken(jar);
  if (token) await db.session.deleteMany({ where: { token } });
  jar.delete(SESSION_COOKIE);
  jar.delete(LEGACY_SESSION_COOKIE);
  await clearSignedInHint(jar);
}

/** Sign every device out — used when a password changes. */
export async function endAllSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = await sessionToken(jar);
  if (!token) return null;

  const session = await db.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user.isActive || !isClaimed(session.user)) return null;
  return session.user;
}

/**
 * Sign in with a password. Deliberately still tests `passwordHash` rather than
 * `isClaimed`: a Google-only account has no password, so there is nothing here
 * for it to match, and saying so is the point.
 */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Spend the same work whether or not the account exists.
  const hash = user?.passwordHash || "scrypt:16384:8:1:00:00";
  const ok = verifyPassword(password, hash);
  if (!user || !ok || !user.isActive || !user.passwordHash) return null;
  return user;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function isAdmin(user: { role: UserRole }) {
  return user.role === "ADMIN" || user.role === "SUPER_ADMIN";
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/");
  return user;
}

export async function requireSuperAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") redirect("/");
  return user;
}

// ---------------------------------------------------------------------------
// MCP tokens — each connection belongs to exactly one user, so a connection URL
// only ever reaches that person's data.
// ---------------------------------------------------------------------------

/** Don't write a timestamp on every single tool call. */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * The caller, and the connection they came in on.
 *
 * The connection id travels with the user because a tool that manages
 * connections has to know which one it is speaking through — that is what lets
 * "disconnect the old laptop" refuse to cut the wire it is standing on.
 */
export type McpCaller = { user: User; connectionId: string };

export async function userByMcpToken(
  token: string | null | undefined,
  userAgent = "",
): Promise<McpCaller | null> {
  if (!token || !token.startsWith("rsm_")) return null;

  const connection = await db.mcpConnection.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!connection) return null;

  const { user } = connection;
  if (!user.isActive || !isClaimed(user)) return null;

  const now = Date.now();
  const stale =
    !connection.lastUsedAt || now - connection.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS;
  if (stale) {
    // Piggybacking on the once-a-minute-per-connection throttle already here,
    // which closes the assistant-only case: an instance nobody signs into and
    // nobody restarts still clears its archive. Never let bookkeeping fail a
    // real request.
    void sweepArchive().catch(() => {});
    void db.mcpConnection
      .update({
        where: { id: connection.id },
        data: {
          lastUsedAt: new Date(now),
          lastUsedFrom: userAgent.slice(0, 200),
        },
      })
      .catch(() => {});
  }

  return { user, connectionId: connection.id };
}

/** Every user starts with one connection so Settings is never an empty page. */
export async function ensureDefaultConnection(userId: string) {
  const existing = await db.mcpConnection.count({ where: { userId } });
  if (existing > 0) return;
  await db.mcpConnection.create({
    data: { userId, name: "Claude", client: "claude", token: generateMcpToken() },
  });
}

export { SESSION_COOKIE, SIGNED_IN_COOKIE };
