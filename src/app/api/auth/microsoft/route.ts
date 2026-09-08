import { NextResponse, type NextRequest } from "next/server";
import { getSettings, microsoftIsConfigured } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { newStateValues, packState } from "@/lib/google";
import { MICROSOFT_STATE_COOKIE, microsoftAuthUrl, microsoftRedirectUri } from "@/lib/accounts/microsoft";
import { baseUrlFrom } from "@/lib/request-url";

/**
 * Start connecting a Microsoft 365 or Outlook.com account, for reading mail
 * and calendar. Never a sign-in: the grant has to land on an account, and
 * the only account it may land on is the one in the session cookie, so a
 * visitor who is not signed in is sent to sign in first.
 *
 * The state cookie is the same signed, httpOnly cookie the Google flow uses,
 * signed with this client's secret rather than Google's — see the note in
 * src/lib/google.ts for why nothing about a half-finished consent is worth a
 * row in the database.
 */

export async function GET(request: NextRequest) {
  const settings = await getSettings();
  if (!microsoftIsConfigured(settings)) {
    return NextResponse.redirect(new URL("/settings?tab=connections&account=not_set_up", request.url));
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings?tab=connections", request.url));
  }

  const baseUrl = settings.publicUrl || baseUrlFrom(request.headers, request.url);
  const state = newStateValues("/settings?tab=connections", false, true);

  const response = NextResponse.redirect(
    microsoftAuthUrl({
      clientId: settings.microsoftClientId,
      redirectUri: microsoftRedirectUri(baseUrl),
      state: state.state,
      nonce: state.nonce,
    }),
  );
  response.cookies.set(MICROSOFT_STATE_COOKIE, packState(state, settings.microsoftClientSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
