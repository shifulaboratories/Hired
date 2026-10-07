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
  claiming = false,
}: {
  instanceName: string;
  email: string;
  /** The owner's first sign-in, still on the placeholder address. */
  claiming?: boolean;
}) {
  const [state, formAction] = useActionState(setNewPasswordAction, undefined);

  return (
    <AuthCard
      title={claiming ? "Make it yours" : "Set your own password"}
      subtitle={
        claiming
          ? `This is the owner account for ${instanceName}. Choose the email and password you will sign in with; the password from the deploy log stops working.`
          : `The password you have for ${instanceName} was chosen by an admin, so it is one somebody else knows. Replace it and you're in.`
      }
    >
      <motion.form variants={authGroup} action={formAction} className="space-y-4">
        {claiming ? (
          <motion.div variants={authRise} className="space-y-2">
            <Label htmlFor="email">Your email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              placeholder="you@example.com"
            />
          </motion.div>
        ) : (
          /* Here so a password manager files the new password against the right
             account, and so the person can see which one they are fixing. */
          <motion.div variants={authRise} className="space-y-2">
            <Label>Account</Label>
            <Input value={email} readOnly disabled className="opacity-70" autoComplete="username" />
          </motion.div>
        )}

        <motion.div variants={authRise} className="space-y-2">
          <PasswordField
            id="newPassword"
            label="New password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            minLength={10}
            hint={
              claiming
                ? "At least 10 characters. It replaces the one printed in the log."
                : "Nobody else will know this one — not even the admin who set up your account."
            }
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
