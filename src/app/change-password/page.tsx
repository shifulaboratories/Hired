import { redirect } from "next/navigation";
import { requireUserPendingPasswordChange } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { AuthShell, authViewport } from "@/components/auth-shell";
import { ForcedPasswordForm } from "@/components/forced-password-form";

export const dynamic = "force-dynamic";

/** The door is light; the bar above it has to be told. */
export const viewport = authViewport;

/**
 * The one screen an account with an admin-set password can reach.
 *
 * It is out here with `/login` and `/invite/[token]` rather than inside
 * `(app)` on purpose: this person is signed in but not yet in, and the app
 * chrome — sidebar, search, their pipeline behind a dialog — would be a lie.
 * `requireUserPendingPasswordChange` is `requireUser` without the gate, and
 * this page and its action are the only two callers it is allowed to have.
 *
 * Somebody who is not flagged is sent to Settings, which is where changing a
 * password you already own belongs.
 */
export default async function ChangePasswordPage() {
  const user = await requireUserPendingPasswordChange();
  if (!user.mustChangePassword) redirect("/settings");

  const settings = await getSettings();

  return (
    <AuthShell>
      <ForcedPasswordForm instanceName={settings.instanceName} email={user.email} />
    </AuthShell>
  );
}
