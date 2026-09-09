"use client";

import { useState, useTransition } from "react";
import { CheckIcon, CopyIcon, KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
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
import { adminResetPasswordAction } from "@/server/actions";

/**
 * Resetting somebody's password, in one place.
 *
 * There are two screens that do this — the people table's row menu and the
 * person page — and this used to be a `confirm()` in each of them, which was
 * fine while the only choice was "yes, generate one". It is not fine now that
 * there are two choices to make, so both call this instead of growing two
 * slightly different dialogs that drift.
 *
 * The password it hands back is shown once and never stored in the clear, so
 * the dialog stays open on the result rather than closing over it: closing an
 * unread password is losing it.
 */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  userId,
  email,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  email: string;
  /** Called once a reset lands, for the caller to refresh whatever it shows. */
  onDone?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [result, setResult] = useState<{ password: string; mustChange: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      // Only on the way out, so the fields don't blank while it animates shut.
      setTimeout(() => {
        setPassword("");
        setMustChange(false);
        setResult(null);
      }, 200);
    }
  };

  const submit = () =>
    startTransition(async () => {
      const chosen = password.trim();
      const response = await adminResetPasswordAction(userId, {
        password: chosen || undefined,
        mustChange,
      });
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setResult({ password: response.password, mustChange: response.mustChange });
      onDone?.();
    });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Password for {email}</DialogTitle>
              <DialogDescription>
                This is the only time it is shown. Send it through something other than email if
                you can — a bounced invite is often why you are here.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {result.password}
              </code>
              <CopyPassword password={result.password} />
            </div>
            <p className="text-faint text-[12px]">
              {result.mustChange
                ? "They are signed out everywhere, and the app stays closed to them until they replace this with one of their own."
                : "They are signed out everywhere. This password is theirs until they change it."}
            </p>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset password for {email}</DialogTitle>
              <DialogDescription>
                They will be signed out everywhere, and you will get the new password to pass on.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="reset-password">New password (optional)</Label>
              <Input
                id="reset-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && submit()}
                placeholder="Leave empty to generate a passphrase"
                autoComplete="off"
                autoFocus
                minLength={10}
              />
              <p className="text-muted-foreground text-xs">
                A generated passphrase is easier to read out and harder to guess. Type one only if
                they asked for something specific.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <Checkbox
                checked={mustChange}
                onCheckedChange={(value) => setMustChange(value === true)}
                className="mt-0.5"
              />
              <span>
                Make them replace it when they next sign in
                <span className="text-muted-foreground block text-xs">
                  Otherwise this password stays theirs, and you know it.
                </span>
              </span>
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending}>
                {pending ? <LoaderCircleIcon className="animate-spin" /> : <KeyRoundIcon />}
                Reset password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopyPassword({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(password);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
