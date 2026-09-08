import { redirect } from "next/navigation";
import {
  SIGNED_IN_COOKIE,
  getCurrentUser,
  instanceNeedsSetup,
  signedInHintDomain,
} from "@/lib/auth";
import { getSettings, googleIsConfigured } from "@/lib/settings";
import { isGoogleRefusal, refusalMessage } from "@/lib/google";
import { LoginForm } from "@/components/login-form";
import { AuthShell, authViewport } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

/** The door is light; the bar above it has to be told. */
export const viewport = authViewport;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await instanceNeedsSetup()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  // The hint domain is whatever the landing page reads to decide you are signed
  // in. There is no session here, so the form's job on arrival is to take it
  // back off.
  const [settings, params, hintDomain] = await Promise.all([
    getSettings(),
    searchParams,
    signedInHintDomain(),
  ]);

  return (
      <AuthShell>
        <LoginForm
          instanceName={settings.instanceName}
          googleReady={googleIsConfigured(settings)}
          openSignup={googleIsConfigured(settings) && settings.googleAllowSignup}
          allowedDomains={settings.googleAllowedDomains}
          notice={noticeFor(params.error, settings.googleAllowedDomains)}
          signedInHint={hintDomain ? { cookie: SIGNED_IN_COOKIE, domain: hintDomain } : null}
        />
      </AuthShell>
  );
}

/**
 * A refusal reaches this page as a code in the URL, and is only ever rendered
 * by looking the code up. Anything unrecognised is dropped rather than shown —
 * `?error=` is reachable by anyone with a link, and a sign-in page that will
 * print a stranger's sentence in a warning box is a phishing page with extra
 * steps.
 *
 * The one interpolated value, the allowed-domain list, is read from this
 * instance's own settings here rather than carried in the URL, so there is no
 * path from a query string into the rendered sentence at all.
 */
function noticeFor(error: string | undefined, allowedDomains: string) {
  if (!error) return undefined;
  if (error === "google_off") return "Google sign-in is not set up here.";
  if (!isGoogleRefusal(error)) return undefined;
  return refusalMessage(error, allowedDomains);
}
