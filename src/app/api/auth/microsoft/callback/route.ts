import { NextResponse, type NextRequest } from "next/server";
import { getSettings, microsoftIsConfigured } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { unpackState, type GoogleRefusal } from "@/lib/google";
import {
  MICROSOFT_STATE_COOKIE,
  exchangeMicrosoftCode,
  microsoftFeatures,
  microsoftProfile,
  microsoftRedirectUri,
} from "@/lib/accounts/microsoft";
import { connectOAuthAccount } from "@/lib/data/accounts";
import { recordSystemEvent } from "@/lib/data/system";
import { baseUrlFrom } from "@/lib/request-url";

/**
 * Where Microsoft sends the browser back.
 *
 * Every exit clears the state cookie, so one authorization code can never be
 * replayed against a second attempt. Every exit also lands on the Connections
 * tab with a fixed outcome code — the same list the sign-in page uses, for
 * the same reason: a callback that echoes text into its own page is a
 * phishing primitive.
 */
export async function GET(request: NextRequest) {
  const settings = await getSettings();
  const url = request.nextUrl;

  const fail = (reason: GoogleRefusal) => {
    const target = new URL("/settings?tab=connections", request.url);
    target.searchParams.set("account", reason);
    const response = NextResponse.redirect(target);
    response.cookies.delete(MICROSOFT_STATE_COOKIE);
    return response;
  };

  if (!microsoftIsConfigured(settings)) return fail("not_set_up");

  const stored = unpackState(request.cookies.get(MICROSOFT_STATE_COOKIE)?.value, settings.microsoftClientSecret);
  const returned = url.searchParams.get("state");
  if (!stored || !returned || stored.state !== returned) return fail("expired_state");

  const denied = url.searchParams.get("error");
  if (denied) {
    if (denied !== "access_denied") {
      await recordSystemEvent({
        level: "WARN",
        source: "microsoft.data",
        message: "Microsoft refused a connect",
        detail: `${denied}: ${url.searchParams.get("error_description") ?? ""}`.slice(0, 300),
      });
    }
    return fail(denied === "access_denied" ? "cancelled" : "failed");
  }

  const code = url.searchParams.get("code");
  if (!code) return fail("failed");

  const user = await getCurrentUser();
  if (!user) return fail("expired_state");

  const baseUrl = settings.publicUrl || baseUrlFrom(request.headers, request.url);

  try {
    const grant = await exchangeMicrosoftCode({
      clientId: settings.microsoftClientId,
      clientSecret: settings.microsoftClientSecret,
      code,
      redirectUri: microsoftRedirectUri(baseUrl),
    });
    if (!grant.refreshToken) return fail("no_refresh_token");
    const features = microsoftFeatures(grant.scopes);
    if (features.length === 0) return fail("no_scopes");

    const profile = await microsoftProfile(grant.accessToken);
    await connectOAuthAccount(user.id, {
      provider: "MICROSOFT",
      email: profile.email,
      externalId: profile.id,
      features,
      refreshToken: grant.refreshToken,
      accessToken: grant.accessToken,
      expiresAt: grant.expiresAt,
    });
    await recordSystemEvent({
      level: "INFO",
      source: "microsoft.data",
      message: "Connected a Microsoft 365 account",
      userEmail: user.email,
    });

    const target = new URL("/settings?tab=connections", request.url);
    target.searchParams.set("account", "connected");
    const response = NextResponse.redirect(target);
    response.cookies.delete(MICROSOFT_STATE_COOKIE);
    return response;
  } catch (error) {
    await recordSystemEvent({
      level: "ERROR",
      source: "microsoft.data",
      message: "Connecting a Microsoft 365 account failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
    return fail("failed");
  }
}
