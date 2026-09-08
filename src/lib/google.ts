import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { CLAIMED, ensureDefaultConnection, isClaimed } from "@/lib/auth";
import { getSettings, googleIsConfigured, type InstanceSettings } from "@/lib/settings";
import { recordSystemEvent } from "@/lib/data/system";
import { GOOGLE_DATA_SCOPES, type GoogleGrant } from "@/lib/accounts/google";

/**
 * Sign in with Google.
 *
 * The authorization-code flow, written out rather than pulled from a library,
 * for the same reason the MCP transport is hand-rolled: it is about ninety
 * lines, and a dependency here would own the login page of every instance.
 *
 * Two things are worth knowing before changing anything in this file.
 *
 * **The ID token's signature is not verified, and does not need to be.** It
 * arrives in the body of a direct TLS POST that this server makes to Google's
 * token endpoint, authenticated with the client secret — not through the
 * browser. Google's own guidance is that a token collected that way can be
 * used without validating the signature, because TLS already proves who sent
 * it. The claims that guard against *misconfiguration* rather than forgery —
 * issuer, audience, expiry, nonce — are still checked below.
 *
 * **`email_verified` is the whole security model for matching.** An account
 * here is found by email address, so an unverified Google email would let
 * anyone who can create a Google account walk into the matching account on
 * this instance. It is refused, loudly.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** Where Google sends the browser back to. Registered in the Cloud console. */
export function googleRedirectUri(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/auth/google/callback`;
}

// ---------------------------------------------------------------------------
// The state cookie
// ---------------------------------------------------------------------------

/**
 * State and nonce live in one signed, httpOnly cookie rather than a row in the
 * database. Nothing about a sign-in that is half-finished is worth persisting,
 * and keeping it out of the database means a login still works across a
 * restart, a replica or a redeploy — the same reason the MCP transport holds
 * no session state.
 *
 * Signed with the client secret, which is the one instance-wide secret both
 * ends of this flow already have to agree on.
 */
export type GoogleState = {
  state: string;
  nonce: string;
  next: string;
  /**
   * Set when the flow was started from Settings by somebody already signed in,
   * who is attaching Google to the account they are already in. It lives in
   * the signed cookie rather than a query parameter precisely so the callback
   * cannot be talked into linking by a crafted URL.
   */
  link?: boolean;
  /**
   * Set when the flow was started from Settings → Connections by somebody signed
   * in, asking for read access to their Gmail and Calendar rather than a
   * sign-in. Same cookie, same reason: the callback trusts only what it
   * signed.
   */
  data?: boolean;
};

export const GOOGLE_STATE_COOKIE = "hired_google_oauth";

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function packState(value: GoogleState, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function unpackState(cookie: string | undefined, secret: string): GoogleState | null {
  if (!cookie) return null;
  const [payload, mac] = cookie.split(".");
  if (!payload || !mac) return null;

  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof parsed?.state !== "string" || typeof parsed?.nonce !== "string") return null;
    return {
      state: parsed.state,
      nonce: parsed.nonce,
      next: safeNext(parsed.next),
      link: parsed.link === true,
      data: parsed.data === true,
    };
  } catch {
    return null;
  }
}

/**
 * Where to land after signing in. Anything but a path on this instance is
 * dropped — an open redirect on a login callback is how a phishing page
 * borrows your domain, in the moment right after the visitor watched a real
 * sign-in succeed.
 *
 * The backslash case is the one worth naming, because the obvious check misses
 * it: WHATWG URL resolution treats `\` as `/` for http(s), so `/\evil.com`
 * begins with a single slash, passes "starts with / but not //", and resolves
 * to `https://evil.com/`. Control characters are stripped by parsers before
 * resolution, so they smuggle the same thing past the same check.
 */
export function safeNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\x00-\x1f\x7f]/.test(value)) return "/";
  return value;
}

export function newStateValues(next: string | null, link = false, data = false): GoogleState {
  return {
    state: randomBytes(16).toString("hex"),
    nonce: randomBytes(16).toString("hex"),
    next: safeNext(next),
    link,
    data,
  };
}

/**
 * Attach a Google identity to the account already signed in.
 *
 * This is the safe direction of the link that step 2 of `resolveGoogleAccount`
 * refuses to make on its own: the person has proved they hold this account by
 * being in it, and Google has proved they hold the address. Doing both makes
 * the address proven, which is what lets them use the button next time.
 */
export async function linkGoogleToUser(
  userId: string,
  identity: GoogleIdentity,
): Promise<{ ok: true } | { ok: false; reason: GoogleRefusal }> {
  if (!identity.sub) return { ok: false, reason: "no_identity" };
  if (!identity.emailVerified) return { ok: false, reason: "unverified" };

  const taken = await db.user.findUnique({ where: { googleId: identity.sub } });
  if (taken && taken.id !== userId) return { ok: false, reason: "linked_elsewhere" };

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, reason: "failed" };

  // Only vouch for the address when it is the one they already hold here.
  // Linking a Google account under a different address is fine — people have
  // several — but it says nothing about the address on this account.
  const proves = user.email === identity.email;
  await db.user.update({
    where: { id: userId },
    data: {
      googleId: identity.sub,
      ...(proves && !user.emailProvenAt ? { emailProvenAt: new Date() } : {}),
    },
  });
  return { ok: true };
}

/** Detach Google, refusing to leave an account with no way back in. */
export async function unlinkGoogleFromUser(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "No such account." };
  if (!user.googleId) return { ok: true };
  if (!user.passwordHash) {
    return {
      ok: false,
      error: "Set a password first, or you would have no way to sign in.",
    };
  }
  await db.user.update({ where: { id: userId }, data: { googleId: null } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

export function googleAuthUrl(input: {
  settings: InstanceSettings;
  redirectUri: string;
  state: GoogleState;
}) {
  const params = new URLSearchParams({
    client_id: input.settings.googleClientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.state.data
      ? `openid email ${GOOGLE_DATA_SCOPES.mail} ${GOOGLE_DATA_SCOPES.calendar}`
      : "openid email profile",
    state: input.state.state,
    nonce: input.state.nonce,
    // Ask every time rather than reusing whatever account the browser is
    // already signed in to. On a shared machine, silently landing in someone
    // else's workspace is the worst possible outcome here.
    prompt: "select_account",
  });
  if (input.state.data) {
    // A refresh token is only issued with offline access, and only on a
    // consent screen the person actually sees — so both are forced. Without
    // `consent`, a second connect from the same Google account comes back
    // with no refresh token at all and nothing to store.
    params.set("access_type", "offline");
    params.set("prompt", "consent select_account");
    params.set("include_granted_scopes", "true");
  }
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
  /**
   * The tokens that came back with the identity. Only the Settings → Connections
   * flow asks for anything worth keeping; for a sign-in the refresh token is
   * empty and the access token is thrown away with the response.
   */
  grant: GoogleGrant;
};

/** Read a JWT payload without verifying it. See the note at the top. */
function decodeSegment(token: string) {
  const segment = token.split(".")[1];
  if (!segment) throw new Error("Google returned a token this app could not read.");
  return JSON.parse(Buffer.from(segment, "base64url").toString()) as Record<string, unknown>;
}

export async function exchangeCode(input: {
  settings: InstanceSettings;
  code: string;
  redirectUri: string;
  nonce: string;
}): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.settings.googleClientId,
      client_secret: input.settings.googleClientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // Google's own words are far more useful than anything this app could
    // invent — redirect_uri_mismatch names the exact misconfiguration.
    const detail = [body.error, body.error_description].filter(Boolean).join(": ");
    throw new Error(detail || `Google refused the sign-in (HTTP ${response.status}).`);
  }

  const idToken = typeof body.id_token === "string" ? body.id_token : "";
  if (!idToken) throw new Error("Google did not return an identity token.");

  const claims = decodeSegment(idToken);
  const issuer = String(claims.iss ?? "");
  const audience = String(claims.aud ?? "");
  const expiry = Number(claims.exp ?? 0);

  if (!ISSUERS.includes(issuer)) throw new Error("That identity token did not come from Google.");
  if (audience !== input.settings.googleClientId) {
    throw new Error("That identity token was issued for a different application.");
  }
  if (!expiry || expiry * 1000 < Date.now()) throw new Error("That sign-in took too long. Try again.");
  if (String(claims.nonce ?? "") !== input.nonce) {
    throw new Error("That sign-in could not be matched to the request that started it.");
  }

  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("That Google account has no email address on it.");

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    sub: String(claims.sub ?? ""),
    email,
    // Google sends this as a boolean, but has historically sent the string
    // "true" as well. Anything else is treated as unverified.
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: String(claims.name ?? ""),
    picture: String(claims.picture ?? ""),
    grant: {
      accessToken: typeof body.access_token === "string" ? body.access_token : "",
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : "",
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Who is allowed in
// ---------------------------------------------------------------------------

/**
 * Why a sign-in was refused, as a code rather than a sentence.
 *
 * The sentence is looked up on the sign-in page. It travels as a code because
 * the callback's only way to say anything is `?error=` on a redirect, and a
 * callback that echoes arbitrary text back onto its own sign-in page is a
 * phishing primitive: "Your workspace is locked, email it-desk@… with your
 * recovery phrase", rendered in a styled box on the real domain, above the
 * real password form.
 */
export type GoogleRefusal =
  | "unverified"
  | "no_identity"
  | "not_set_up"
  | "suspended"
  | "unpaid"
  | "linked_elsewhere"
  | "unproven_email"
  | "invite_only"
  | "domain"
  | "expired_state"
  | "cancelled"
  | "no_refresh_token"
  | "no_scopes"
  | "failed";

const REFUSALS: GoogleRefusal[] = [
  "unverified",
  "no_identity",
  "not_set_up",
  "suspended",
  "unpaid",
  "linked_elsewhere",
  "unproven_email",
  "invite_only",
  "domain",
  "expired_state",
  "cancelled",
  "no_refresh_token",
  "no_scopes",
  "failed",
];

export function isGoogleRefusal(value: string): value is GoogleRefusal {
  return (REFUSALS as string[]).includes(value);
}

export type GoogleOutcome =
  | { ok: true; user: User; created: boolean }
  | { ok: false; reason: GoogleRefusal; detail?: string };

/**
 * The sentence a visitor reads. `detail` is only ever filled in from settings
 * this instance owns — never from anything Google or a query string said.
 */
export function refusalMessage(reason: GoogleRefusal, detail = "") {
  switch (reason) {
    case "unverified":
      return "That Google account's email address is not verified, so it can't be matched to an account here.";
    case "no_identity":
      return "Google did not identify that account.";
    case "not_set_up":
      return "This instance has not been set up yet.";
    case "suspended":
      return "That account has been suspended. Ask an admin to turn it back on.";
    case "unpaid":
      return "That account is suspended because its subscription lapsed. Paying again turns it back on.";
    case "linked_elsewhere":
      return "That address already belongs to an account linked to a different Google account. An admin can help if the address changed hands.";
    case "unproven_email":
      return "There is already an account with that address here, and this instance can't confirm it belongs to you. Sign in with your password, then connect Google from Settings.";
    case "invite_only":
      return "Accounts here are invite-only. Ask an admin for an invitation.";
    case "domain":
      return detail ? `Sign-up here is limited to ${detail}.` : "That address can't sign up here.";
    case "expired_state":
      return "That sign-in link has expired. Try again.";
    case "cancelled":
      return "Sign-in was cancelled.";
    case "no_refresh_token":
      return "The provider did not hand over a lasting token. Remove Hired under your account's third-party app access, then connect again.";
    case "no_scopes":
      return "Neither mail nor calendar was allowed on the consent screen, so there is nothing to connect. Try again and tick at least one.";
    default:
      return "Google sign-in didn't work. Check Admin → Health for the reason.";
  }
}

function domainAllowed(email: string, allowed: string) {
  const list = allowed
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (list.length === 0) return true;
  const domain = email.split("@")[1] ?? "";
  return list.includes(domain);
}

/**
 * Turn a verified Google identity into a session, or a reason why not.
 *
 * The order matters and is the whole policy:
 *
 *   1. Known Google id     → that account, whatever their email is today.
 *   2. Proven email match  → link Google to the account they already have.
 *   3. Open invitation     → accept it; no password ever gets chosen.
 *   4. Sign-up allowed     → a new member account.
 *   5. Otherwise           → refused.
 *
 * Steps 2 and 3 are why an admin does not have to do anything for existing
 * people: the invitation they already sent works with the Google button.
 *
 * **"Proven" in step 2 is doing real work, and skipping it is an account
 * takeover.** Matching on the address alone would mean trusting a field the
 * account holder can type into. Anyone here can change their own email to any
 * address nobody is using; if that were enough to match, a member could set
 * theirs to a colleague's address and the colleague's first Google sign-in
 * would drop them into the member's workspace — career history, resumes, pipeline —
 * while the member kept their password and could still read all of it.
 * `emailProvenAt` records the instance actually having had a reason to believe
 * the address: an admin addressed an invitation to it, the owner claimed the
 * instance with it, or Google itself handed it over verified. Typing it into
 * Settings clears it.
 *
 * Step 2 also refuses when the account is already bound to a *different*
 * Google identity, rather than rebinding it. Workspace admins reassign
 * addresses when somebody leaves, and silently rebinding would hand the new
 * holder of alex@corp.com everything the previous Alex ever wrote.
 */
export async function resolveGoogleAccount(identity: GoogleIdentity): Promise<GoogleOutcome> {
  const settings = await getSettings();

  if (!identity.sub) return { ok: false, reason: "no_identity" };
  if (!identity.emailVerified) {
    return { ok: false, reason: "unverified" };
  }

  // Nobody may claim an unclaimed instance this way. Setup is a deliberate act
  // with the owner's own password, and it happens before any of this exists.
  if ((await db.user.count({ where: CLAIMED })) === 0) {
    return { ok: false, reason: "not_set_up" };
  }

  // 1. Seen before.
  const byGoogle = await db.user.findUnique({ where: { googleId: identity.sub } });
  if (byGoogle) {
    if (!byGoogle.isActive) return { ok: false, reason: suspended(byGoogle) };
    return { ok: true, user: await touch(byGoogle, identity), created: false };
  }

  // 2. Already has an account under this address — link the two, but only when
  //    the address was established by somebody other than its holder.
  const byEmail = await db.user.findUnique({ where: { email: identity.email } });
  if (byEmail && isClaimed(byEmail)) {
    if (!byEmail.isActive) return { ok: false, reason: suspended(byEmail) };

    if (byEmail.googleId && byEmail.googleId !== identity.sub) {
      return { ok: false, reason: "linked_elsewhere" };
    }

    if (!byEmail.emailProvenAt) {
      return { ok: false, reason: "unproven_email" };
    }

    const linked = await touch(byEmail, identity);
    await recordSystemEvent({
      level: "INFO",
      source: "google.signin",
      message: "Linked a Google account to an existing member",
      userEmail: identity.email,
    });
    return { ok: true, user: linked, created: false };
  }

  // 3. Invited but never accepted — the invitation is the permission.
  const invite = await db.invite.findFirst({
    where: { email: identity.email, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (invite) {
    const user = await db.$transaction(async (tx) => {
      const data = {
        name: identity.name,
        googleId: identity.sub,
        role: invite.role,
        isActive: true,
        // Google verified it and an admin addressed an invitation to it.
        emailProvenAt: new Date(),
        invitedById: invite.invitedById,
        lastLoginAt: new Date(),
        ...(invite.stripeCustomerId ? { stripeCustomerId: invite.stripeCustomerId } : {}),
      };
      const created = byEmail
        ? await tx.user.update({ where: { id: byEmail.id }, data })
        : await tx.user.create({ data: { ...data, email: identity.email, passwordHash: "" } });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return created;
    });
    await ensureDefaultConnection(user.id);
    return { ok: true, user, created: true };
  }

  // 4. Nobody invited them. Only an admin's explicit choice lets them in.
  if (!settings.googleAllowSignup) {
    return { ok: false, reason: "invite_only" };
  }
  if (!domainAllowed(identity.email, settings.googleAllowedDomains)) {
    return { ok: false, reason: "domain", detail: settings.googleAllowedDomains };
  }

  // A new member, never an admin: role is something an admin grants on
  // purpose, and no sign-in method should be able to hand it out.
  //
  // `role` is set on the update branch too, not just the create. Reaching here
  // with an existing row means it was unclaimed — today only the placeholder
  // from the multi-user migration, which is a SUPER_ADMIN — and adopting it
  // without saying so would inherit that role. The placeholder's address is on
  // a .local domain that Google can never verify, so this is unreachable
  // rather than load-bearing; it is written down because the next unclaimed
  // row this app learns to create might not be.
  const user = byEmail
    ? await db.user.update({
        where: { id: byEmail.id },
        data: {
          name: identity.name,
          googleId: identity.sub,
          role: "MEMBER",
          isActive: true,
          emailProvenAt: new Date(),
          lastLoginAt: new Date(),
        },
      })
    : await db.user.create({
        data: {
          email: identity.email,
          name: identity.name,
          passwordHash: "",
          googleId: identity.sub,
          role: "MEMBER",
          emailProvenAt: new Date(),
          lastLoginAt: new Date(),
        },
      });
  await ensureDefaultConnection(user.id);
  await recordSystemEvent({
    level: "INFO",
    source: "google.signin",
    message: "New account created through Google sign-up",
    userEmail: identity.email,
  });
  return { ok: true, user, created: true };
}

function suspended(user: User): GoogleRefusal {
  return user.stripeCustomerId ? "unpaid" : "suspended";
}

/** Attach the Google id, and take a name from Google only if we have none. */
async function touch(user: User, identity: GoogleIdentity) {
  return db.user.update({
    where: { id: user.id },
    data: {
      googleId: identity.sub,
      ...(user.name ? {} : { name: identity.name }),
    },
  });
}

export { googleIsConfigured };
