import Link from "next/link";
import { getInviteByToken } from "@/lib/data/users";
import { getSettings, googleIsConfigured } from "@/lib/settings";
import { AuthCard } from "@/components/login-form";
import { Button } from "@/components/ui/button";
import { AcceptInviteForm } from "@/components/accept-invite-form";
import { AuthShell, authViewport } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

/** The door is light; the bar above it has to be told. */
export const viewport = authViewport;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [{ status, invite }, settings] = await Promise.all([
    getInviteByToken(token),
    getSettings(),
  ]);

  if (status !== "valid" || !invite) {
    const message =
      status === "expired"
        ? "This invitation has expired. Ask whoever invited you to send a new one."
        : status === "used"
          ? "This invitation has already been used. Try signing in instead."
          : "This invitation link isn't valid.";
    return (
        <AuthShell>
          <AuthCard title="Invitation unavailable" subtitle={message}>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </AuthCard>
        </AuthShell>
  );
  }

  const inviter = invite.invitedBy.name || invite.invitedBy.email;

  return (
      <AuthShell>
        <AcceptInviteForm
          token={token}
          email={invite.email}
          inviter={inviter}
          instanceName={settings.instanceName}
          googleReady={googleIsConfigured(settings)}
        />
      </AuthShell>
  );
}
