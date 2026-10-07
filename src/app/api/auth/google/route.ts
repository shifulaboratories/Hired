import { NextResponse, type NextRequest } from "next/server";
import { getSettings, googleIsConfigured } from "@/lib/settings";
import {
  GOOGLE_STATE_COOKIE,
  googleAuthUrl,
  googleRedirectUri,
  newStateValues,
  packState,
} from "@/lib/google";
import { baseUrlFrom } from "@/lib/request-url";
import { currentUserForApi } from "@/lib/auth";

/**
 * Start a Google sign-in. A GET because it is reached by a link on the sign-in
 * page, and because everything it needs to remember goes into one signed
 * cookie rather than a row in the database.
 */
export async function GET(request: NextRequest) {
  const settings = await getSettings();
  if (!googleIsConfigured(settings)) {
    return NextResponse.redirect(new URL("/login?error=google_off", request.url));
  }

  const baseUrl = settings.publicUrl || baseUrlFrom(request.headers, request.url);

  // Linking is only on the table for somebody already signed in; asking for it
  // while signed out is just an ordinary sign-in. The same goes for `data`,
  // which asks for read access to their Gmail and Calendar: the grant has to
  // land on an account, and the only account it may land on is the one in
  // the session cookie.
  const wantsLink = request.nextUrl.searchParams.get("link") === "1";
  const wantsData = request.nextUrl.searchParams.get("data") === "1";
  const signedIn = wantsLink || wantsData ? await currentUserForApi() : null;
  if (wantsData && !signedIn) {
    return NextResponse.redirect(new URL("/login?next=/settings?tab=connections", request.url));
  }
  const state = newStateValues(
    request.nextUrl.searchParams.get("next") ??
      (signedIn ? "/settings?tab=connections" : null),
    Boolean(signedIn) && !wantsData,
    Boolean(signedIn) && wantsData,
  );

  const response = NextResponse.redirect(
    googleAuthUrl({ settings, redirectUri: googleRedirectUri(baseUrl), state }),
  );
  response.cookies.set(GOOGLE_STATE_COOKIE, packState(state, settings.googleClientSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Long enough to pick an account and type a password, short enough that a
    // cookie left on a shared machine is not a standing invitation.
    maxAge: 600,
  });
  return response;
}
