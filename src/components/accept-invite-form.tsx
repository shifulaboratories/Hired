"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AuthCard,
  AuthError,
  GoogleButton,
  SubmitButton,
  authGroup,
  authRise,
} from "@/components/login-form";
import { acceptInviteAction } from "@/server/actions";

export function AcceptInviteForm({
  token,
  email,
  inviter,
  instanceName,
  googleReady,
}: {
  token: string;
  email: string;
  inviter: string;
  instanceName: string;
  googleReady: boolean;
}) {
  const [state, formAction] = useActionState(acceptInviteAction, undefined);

  return (
    <AuthCard
      title={`Join ${instanceName}`}
      subtitle={
        googleReady
          ? `${inviter} invited you. Continue with Google, or pick a password.`
          : `${inviter} invited you. Pick a password and you're in.`
      }
    >
      {/* What this actually is.
          Somebody arriving here got a link in an email from a friend and has
          never heard of the product. The card told them who invited them and
          asked for a password, and nothing on the way in ever said what they
          were signing up to — which is a strange thing to ask of a person, and
          the sort of thing they close the tab over. One sentence, before the
          fields, in the words the tour uses on the other side of the door. */}
      <motion.p variants={authRise} className="text-muted-foreground -mt-2 mb-5 text-[13px] leading-relaxed">
        It keeps a job search in one place: every job you go for, everything you have ever done,
        and the resumes you build out of it.
      </motion.p>
      {/* No token travels with this. The callback finds the outstanding
          invitation by the verified email Google hands back, so the button is
          the same one as on the sign-in page and cannot accept an invitation
          addressed to somebody else. */}
      {googleReady && (
        <motion.div variants={authRise}>
          <GoogleButton label="Continue with Google" />
          <div className="my-5 flex items-center gap-3">
            <span className="auth-rule bg-border h-px flex-1" />
            <span className="text-faint text-[11px] tracking-wide uppercase">or</span>
            <span className="auth-rule bg-border h-px flex-1" />
          </div>
        </motion.div>
      )}

      <motion.form variants={authGroup} action={formAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <motion.div variants={authRise} className="space-y-2">
          <Label>Email</Label>
          <Input value={email} readOnly disabled className="opacity-70" />
        </motion.div>

        <motion.div variants={authRise} className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" autoFocus placeholder="Ada Lovelace" />
        </motion.div>

        <motion.div variants={authRise} className="space-y-2">
          <Label htmlFor="password">Choose a password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
          />
        </motion.div>

        <AuthError message={state?.error} />

        <motion.div variants={authRise}>
          <SubmitButton label="Create my account" pendingLabel="Creating…" />
        </motion.div>
      </motion.form>

      <motion.p variants={authRise} className="text-muted-foreground mt-6 text-center text-xs">
        You get your own private space. Nobody else can see your career history, resumes or applications.
      </motion.p>
    </AuthCard>
  );
}
