"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AuthCard,
  AuthError,
  PasswordField,
  SubmitButton,
  authGroup,
  authRise,
} from "@/components/login-form";
import { setupAction } from "@/server/actions";

export function SetupForm({ requiresKey }: { requiresKey: boolean }) {
  const [state, formAction] = useActionState(setupAction, undefined);

  return (
    <AuthCard
      title="Claim this instance"
      subtitle="Your owner account is normally created automatically on first boot — check your server logs for the password. Use this page only if that didn't happen."
    >
      <motion.form variants={authGroup} action={formAction} className="space-y-4">
        {requiresKey ? (
          <motion.div variants={authRise} className="space-y-2">
            <Label htmlFor="setupKey">
              <KeyRoundIcon className="size-3.5" /> Setup key
            </Label>
            <Input
              id="setupKey"
              name="setupKey"
              type="password"
              autoFocus
              placeholder="Your APP_PASSWORD"
            />
            <p className="text-muted-foreground text-xs">
              The <code className="bg-muted rounded px-1 py-0.5">APP_PASSWORD</code> variable from
              your host. This stops anyone else claiming the instance first.
            </p>
          </motion.div>
        ) : (
          <motion.div variants={authRise} className="flex items-start gap-2 rounded-lg bg-warning-tint shadow-[0_0_0_1px_color-mix(in_oklch,var(--warning)_32%,transparent)] px-3 py-2.5 text-xs">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" />
            <span className="text-muted-foreground">
              No <code className="bg-muted rounded px-1">APP_PASSWORD</code> is set, so this page is
              open to anyone who finds it. Finish setup now, or set that variable first.
            </span>
          </motion.div>
        )}

        <motion.div variants={authRise} className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" autoFocus={!requiresKey} placeholder="Ada Lovelace" />
        </motion.div>

        <motion.div variants={authRise} className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
          />
        </motion.div>

        <motion.div variants={authRise} className="space-y-2">
          <PasswordField
            id="password"
            label="Password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            minLength={10}
          />
        </motion.div>

        <AuthError message={state?.error} />

        <motion.div variants={authRise}>
          <SubmitButton label="Create owner account" pendingLabel="Setting up…" />
        </motion.div>
      </motion.form>
    </AuthCard>
  );
}
