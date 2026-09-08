import { NextResponse, type NextRequest } from "next/server";
import { getSettings, googleIsConfigured } from "@/lib/settings";
import { getCurrentUser, startSession } from "@/lib/auth";
import {
  GOOGLE_STATE_COOKIE,
  exchangeCode,
  googleRedirectUri,
  linkGoogleToUser,
  refusalMessage,
  resolveGoogleAccount,
  unpackState,
  type GoogleRefusal,
} from "@/lib/google";
import { recordSystemEvent } from "@/lib/data/system";
import { connectOAuthAccount } from "@/lib/data/accounts";
import { googleFeatures } from "@/lib/accounts/google";
import { baseUrlFrom } from "@/lib/request-url";

/**
 * Where Google sends the browser back.
 *
 * Every exit from here clears the state cookie, so one authorization code can
 * never be replayed against a second attempt — including the failures, which
 * is the case it would be easy to miss.
 */
export async function GET(request: NextRequest) {
  const settings = await getSettings();
  const url = request.nextUrl;

  /**
   * Every exit goes through here, so the state cookie is cleared on the
   * failures too — one authorization code can never be replayed against a
   * second attempt. Only a fixed code travels in the URL; the sentence is
   * looked up on the sign-in page, so nothing a stranger puts in a query
   * string can be made to appear there.
   */
  const stored = unpackState(
    request.cookies.get(GOOGLE_STATE_COOKIE)?.value,
    settings.googleClientSecret,
  );

  const fail = (reason: GoogleRefusal) => {
    // A Gmail/Calendar connect started from Settings ends there, whatever
    // happened: the person is signed in, and the sign-in page would only
    // confuse them. Same fixed codes, looked up by the panel.
    const target = stored?.data
      ? new URL("/settings?tab=connections", request.url)
      : new URL("/login", request.url);
    target.searchParams.set(stored?.data ? "account" : "error", reason);
    const response = NextResponse.redirect(target);
    response.cookies.delete(GOOGLE_STATE_COOKIE);
    return response;
  };

  if (!googleIsConfigured(settings)) return fail("not_set_up");
  const returned = url.searchParams.get("state");
  if (!stored || !returned || stored.state !== returned) {
    // Either the cookie expired or this request did not start here. The same
    // answer for both, because the difference is not the visitor's problem.
    return fail("expired_state");
  }

  // The person pressed cancel, or Google refused. Google's own words go to the
  // health log, not onto the page — see the note on `fail`.
  const denied = url.searchParams.get("error");
  if (denied) {
    if (denied !== "access_denied") {
      await recordSystemEvent({
        level: "WARN",
        source: "google.signin",
        message: "Google refused a sign-in",
        detail: denied.slice(0, 200),
      });
    }
    return fail(denied === "access_denied" ? "cancelled" : "failed");
  }

  const code = url.searchParams.get("code");
  if (!code) return fail("failed");

  const baseUrl = settings.publicUrl || baseUrlFrom(request.headers, request.url);

  try {
    const identity = await exchangeCode({
      settings,
      code,
      redirectUri: googleRedirectUri(baseUrl),
      nonce: stored.nonce,
    });

    // Started from the Google tile on Settings → Connections by somebody signed in: keep the tokens
    // against the account they are in. No account matching happens at all —
    // the inbox they connect need not be the address they sign in with.
    if (stored.data) {
      const user = await getCurrentUser();
      if (!user) return fail("expired_state");
      if (!identity.grant.refreshToken) return fail("no_refresh_token");
      const features = googleFeatures(identity.grant.scopes);
      if (features.length === 0) return fail("no_scopes");
      await connectOAuthAccount(user.id, {
        provider: "GOOGLE",
        email: identity.email,
        externalId: identity.sub,
        features,
        refreshToken: identity.grant.refreshToken,
        accessToken: identity.grant.accessToken,
        expiresAt: identity.grant.expiresAt,
      });
      await recordSystemEvent({
        level: "INFO",
        source: "google.data",
        message: "Connected Gmail and Calendar",
        userEmail: user.email,
      });
      const target = new URL("/settings?tab=connections", request.url);
      target.searchParams.set("account", "connected");
      const response = NextResponse.redirect(target);
      response.cookies.delete(GOOGLE_STATE_COOKIE);
      return response;
    }

    // Started from Settings by somebody already signed in: attach Google to
    // the account they are in rather than looking for one to sign them into.
    if (stored.link) {
      const user = await getCurrentUser();
      if (!user) return fail("expired_state");
      const linked = await linkGoogleToUser(user.id, identity);
      if (!linked.ok) return fail(linked.reason);
      const response = NextResponse.redirect(new URL(stored.next, request.url));
      response.cookies.delete(GOOGLE_STATE_COOKIE);
      return response;
    }

    const outcome = await resolveGoogleAccount(identity);
    if (!outcome.ok) {
      await recordSystemEvent({
        level: "WARN",
        source: "google.signin",
        message: "Refused a Google sign-in",
        detail: refusalMessage(outcome.reason, outcome.detail),
        userEmail: identity.email,
      });
      return fail(outcome.reason);
    }

    await startSession(outcome.user.id);
    const response = NextResponse.redirect(new URL(stored.next, request.url));
    response.cookies.delete(GOOGLE_STATE_COOKIE);
    return response;
  } catch (error) {
    await recordSystemEvent({
      level: "ERROR",
      source: stored.data ? "google.data" : "google.signin",
      message: stored.data ? "Connecting Gmail and Calendar failed" : "Google sign-in failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
    // The visitor gets a fixed sentence; the specifics — redirect_uri_mismatch,
    // a bad secret — are for the admin reading Health, not the sign-in page.
    return fail("failed");
  }
}
