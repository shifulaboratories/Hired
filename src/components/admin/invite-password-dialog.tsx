"use client";

import { useEffect, useState, useTransition } from "react";
import { KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setInvitePasswordAction } from "@/server/actions";

/**
 * Put a password on an invitation that has already gone out, or take one off.
 *
 * The link is deliberately untouched: the reason you are in here is usually
 * that you already sent it. Re-inviting the same address would also set a
 * password, and would break the link you sent, which is why this exists as its
 * own thing rather than as a second use of the invite form.
 *
 * Unlike the reset dialog there is nothing to show afterwards — you typed the
 * password, so you have it — so this one closes on success.
 */
export function InvitePasswordDialog({
  invite,
  onOpenChange,
  onDone,
}: {
  /** The invitation being edited, or null when the dialog is shut. */
  invite: { id: string; email: string; passwordSet: boolean; mustChangePassword: boolean } | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [pending, startTransition] = useTransition();

  // Opening on a different invitation has to start from that invitation's
  // state, not from whatever the last one was left on.
  useEffect(() => {
    if (invite) {
      setPassword("");
      setMustChange(invite.mustChangePassword);
    }
  }, [invite]);

  const save = (clear = false) =>
    startTransition(async () => {
      if (!invite) return;
      const chosen = clear ? "" : password.trim();
      const result = await setInvitePasswordAction(invite.id, {
        password: chosen,
        mustChange: clear ? false : mustChange,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.passwordSet
          ? "Password set — send it to them, it isn't in the invitation email"
          : "Password removed — they'll choose their own",
        { duration: result.passwordSet ? 10000 : 4000 },
      );
      onOpenChange(false);
      onDone?.();
    });

  return (
    <Dialog open={Boolean(invite)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Password for {invite?.email}</DialogTitle>
          <DialogDescription>
            {invite?.passwordSet
              ? "This invitation already carries a password. Type a new one to replace it, or remove it and let them choose their own."
              : "Set a password and the accept page will only ask for their name. Their invitation link keeps working either way."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="invite-edit-password">
            {invite?.passwordSet ? "New password" : "Password"}
          </Label>
          <Input
            id="invite-edit-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && password.trim() && save()}
            placeholder="At least 10 characters"
            autoComplete="off"
            autoFocus
            minLength={10}
          />
          <p className="text-muted-foreground text-xs">
            The invitation email doesn&apos;t carry it — send it to them another way, or they
            can&apos;t sign in.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
          <Checkbox
            checked={mustChange}
            onCheckedChange={(value) => setMustChange(value === true)}
            className="mt-0.5"
          />
          <span>
            Make them replace it when they first sign in
            <span className="text-muted-foreground block text-xs">
              Otherwise the password you chose stays theirs, and you know it.
            </span>
          </span>
        </label>

        <DialogFooter className="sm:justify-between">
          {invite?.passwordSet ? (
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={pending}
              onClick={() => save(true)}
            >
              Remove password
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => save()} disabled={pending || !password.trim()}>
              {pending ? <LoaderCircleIcon className="animate-spin" /> : <KeyRoundIcon />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
