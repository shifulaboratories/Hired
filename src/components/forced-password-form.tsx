"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
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
import { setNewPasswordAction } from "@/server/actions";

/**
 * Set your own password, when the one you have was handed to you.
 *
 * Deliberately not the Settings form: there is no current-password field,
 * because the whole premise is that the password you know is one somebody else
 * chose, and asking you to prove you have it proves nothing about you. The
 * session cookie is the proof, and the flag on the account is the reason.
 */
export function ForcedPasswordForm({
  instanceName,
  email,
}: {
  instanceName: string;
  email: string;
}) {
  const [state, formAction] = useActionState(setNewPasswordAction, undefined);

  return (
    <AuthCard
      title="Set your own password"
      subtitle={`The password you have for ${instanceName} was chosen by an admin, so it is one somebody else knows. Replace it and you're in.`}
    >
      <motion.form variants={authGroup} action={formAction} className="space-y-4">
        {/* Here so a password manager files the new password against the right
            account, and so the person can see which one they are fixing. */}
        <motion.div variants={authRise} className="space-y-2">
          <Label>Account</Label>
          <Input value={email} readOnly disabled className="opacity-70" autoComplete="username" />
        </motion.div>

        <motion.div variants={authRise} className="space-y-2">
          <PasswordField
            id="newPassword"
            label="New password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            minLength={10}
            hint="Nobody else will know this one — not even the admin who set up your account."
          />
        </motion.div>

        <AuthError message={state?.error} />

        <motion.div variants={authRise}>
          <SubmitButton label="Save and continue" pendingLabel="Saving…" />
        </motion.div>
      </motion.form>
    </AuthCard>
  );
}
