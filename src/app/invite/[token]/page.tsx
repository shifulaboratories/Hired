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
    // getInviteByToken hands back the row for the expired and used cases, with
    // the inviter already on it — so "ask whoever invited you" was the app
    // withholding a name it was holding. Somebody who cannot get in should be
    // told who to ask, and given the way to ask them.
    const sender = invite ? invite.invitedBy.name || invite.invitedBy.email : "";
    const message =
      status === "expired"
        ? `This invitation has expired. Ask ${sender || "whoever invited you"} to send a new one.`
        : status === "used"
          ? "This invitation has already been used. If that was you, sign in."
          : "This invitation link isn't valid.";
    return (
        <AuthShell>
          <AuthCard title="Invitation unavailable" subtitle={message}>
            <div className="space-y-2">
              {status === "expired" && invite?.invitedBy.email && (
                <Button asChild className="w-full">
                  <a href={`mailto:${invite.invitedBy.email}?subject=${encodeURIComponent("My invitation expired")}`}>
                    Email {sender}
                  </a>
                </Button>
              )}
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            </div>
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
