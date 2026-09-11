"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  DownloadIcon,
  GraduationCapIcon,
  LoaderCircleIcon,
  LogOutIcon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeZoneField } from "@/components/settings/time-zone-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PhotoField } from "@/components/settings/photo-field";
import { DigestPanel } from "@/components/settings/digest-panel";
import {
  changeOwnPasswordAction,
  logoutAction,
  restartTourAction,
  unlinkGoogleAction,
  updateOwnAccountAction,
} from "@/server/actions";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export function AccountPanel({
  user,
  googleReady,
  digest,
}: {
  digest: {
    weeklyDigest: boolean;
    dailyNudge: boolean;
    digestHour: number;
    emailConfigured: boolean;
  };
  user: {
    name: string;
    email: string;
    role: string;
    photo: string;
    googleLinked: boolean;
    hasPassword: boolean;
    /** IANA zone, or "" meaning the server's own clock. */
    timeZone: string;
  };
  /** Whether this instance has Google sign-in configured at all. */
  googleReady: boolean;
}) {
  const [values, setValues] = useState({ name: user.name, email: user.email });
  const [pending, startTransition] = useTransition();
  const [passwordState, passwordAction] = useActionState(changeOwnPasswordAction, undefined);

  const saveProfile = () => {
    startTransition(async () => {
      try {
        await updateOwnAccountAction(values);
        toast.success("Account updated");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update.");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          {/* A neutral tile, not a second copy of the face: the photo field
              below is already showing it, and two avatars of the same person
              a hundred pixels apart reads as a mistake. */}
          <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-xl">
            <UserRoundIcon className="size-[18px]" />
          </div>
          <div>
            <CardTitle className="text-[15px]">{user.name || "Your account"}</CardTitle>
            <p className="text-muted-foreground text-sm">{user.email}</p>
          </div>
          <Badge variant={user.role === "MEMBER" ? "secondary" : "default"} className="ml-auto">
            {ROLE_LABEL[user.role] ?? user.role}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <PhotoField name={user.name} email={user.email} photo={user.photo} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              value={values.email}
              onChange={(event) => setValues({ ...values, email: event.target.value })}
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={saveProfile} disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" />}
          Save
        </Button>

        <Separator />

        <form action={passwordAction} className="space-y-3">
          <h3 className="text-[13px] font-semibold">Change password</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                placeholder="At least 10 characters"
              />
            </div>
          </div>
          {passwordState?.error && (
            <p className="text-destructive text-sm">{passwordState.error}</p>
          )}
          {passwordState?.ok && (
            <p className="flex items-center gap-1.5 text-sm text-[var(--success)]">
              <CheckIcon className="size-3.5" /> Password changed. Other devices were signed out.
            </p>
          )}
          <Button type="submit" variant="outline" size="sm">
            Update password
          </Button>
        </form>

        {googleReady && (
          <>
            <Separator />
            <GoogleLink linked={user.googleLinked} hasPassword={user.hasPassword} />
          </>
        )}

        <Separator />

        <TimeZoneField zone={user.timeZone} />

        <Separator />

        <ShowTourAgain />

        <Separator />

        <DigestPanel initial={digest} />

        <Separator />

        <YourData />

        <Separator />

        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            <LogOutIcon /> Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Everything you own, as a file.
 *
 * The question behind this button is the one anybody self-hosting asks before
 * they put two years of their career somewhere: can I get it all out. A link
 * rather than a server action, for the reason the CSV route records — a browser
 * download wants a real response with a Content-Disposition on it.
 *
 * There is no Restore button beside it, and that is deliberate rather than
 * unfinished: putting a file back is `import_everything` over a connection,
 * where an assistant can dry-run it first and read the report back. A file
 * picker in a settings panel cannot show somebody what 1,400 records are about
 * to do to a workspace they have already started using.
 */
function YourData() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">Your data</p>
        <p className="text-muted-foreground text-xs">
          Everything you own as one JSON file: Me, your resumes, your letters and the whole
          pipeline. Connection tokens, mail passwords and published links are left out on
          purpose. Ask Claude to import_everything to put one back.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <a href="/api/export/everything" download>
          <DownloadIcon /> Download everything
        </a>
      </Button>
    </div>
  );
}

/**
 * Bring the welcome tour back.
 *
 * Here rather than under Appearance because it is about you, not about how the
 * app looks — and because Settings → Account is where somebody who is lost
 * actually goes looking. The tour mounts in the app layout, so `router.refresh`
 * is enough to make it appear: no navigation, no reload, and it is on screen
 * before the toast has faded.
 */
function ShowTourAgain() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">The welcome tour</div>
        <p className="text-muted-foreground text-[12.5px]">
          A short walk through what the board, Me and the assistant are for.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await restartTourAction();
            router.refresh();
          })
        }
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <GraduationCapIcon />}
        Show it again
      </Button>
    </div>
  );
}

/**
 * Connect or disconnect Google for your own account.
 *
 * Connecting is a link out to the sign-in flow rather than an action, because
 * it is a round trip through Google — and doing it while signed in is the
 * safe direction: you have already proved you hold this account, so the
 * instance can trust the pairing. A Google sign-in on its own will not adopt
 * an account whose address nobody has vouched for, which is exactly the case
 * this control exists to resolve.
 */
function GoogleLink({ linked, hasPassword }: { linked: boolean; hasPassword: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">Google</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {linked
            ? hasPassword
              ? "Connected. You can sign in with Google or with your password."
              : "Connected. This is currently the only way you can sign in."
            : "Connect it and you can sign in with one press next time."}
        </p>
      </div>

      {linked ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !hasPassword}
          title={hasPassword ? undefined : "Set a password first, or you'd have no way to sign in."}
          onClick={() =>
            startTransition(async () => {
              const result = await unlinkGoogleAction();
              if (result.ok) toast.success("Google disconnected");
              else toast.error(result.error);
            })
          }
        >
          Disconnect
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm">
          <a href="/api/auth/google?link=1">Connect Google</a>
        </Button>
      )}
    </div>
  );
}
