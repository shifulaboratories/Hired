"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HiredMark3D } from "@/components/hired-mark-3d";
import { loginAction } from "@/server/actions";

/** The deceleration the whole app settles on: fast, then coasting. */
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The card arrives as one object and then hands out its contents in order. The
 * blur is what makes it read as coming into focus rather than sliding: a card
 * that only translates looks like a slide transition, and this is a door
 * opening.
 */
const card: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.965, filter: "blur(10px)" },
  shown: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.85, ease: EASE, delayChildren: 0.22, staggerChildren: 0.07 },
  },
};

/**
 * One row of the card. Exported because the setup and invitation forms are the
 * same door and stagger the same way — anything that is a direct child of
 * `AuthCard` and wants its turn in the sequence wears this.
 */
export const authRise: Variants = {
  hidden: { opacity: 0, y: 10, filter: "blur(5px)" },
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE } },
};

/**
 * A row that is itself a list of rows — the form. It rises like any other and
 * then walks its own fields in, tighter than the card walks its sections, so
 * the whole sequence still lands inside a second.
 */
export const authGroup: Variants = {
  hidden: { opacity: 0, y: 10, filter: "blur(5px)" },
  shown: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: EASE, staggerChildren: 0.05 },
  },
};

/** The signed-in flag this instance leaves on a shared domain, if it leaves one. */
export type SignedInHint = { cookie: string; domain: string };

export function LoginForm({
  instanceName,
  googleReady,
  openSignup,
  allowedDomains,
  notice,
  signedInHint,
}: {
  instanceName: string;
  googleReady: boolean;
  /** Whether a stranger with a Google account can actually get in from here. */
  openSignup: boolean;
  allowedDomains: string;
  /** A refusal carried back from the Google callback, in Google's own words. */
  notice?: string;
  signedInHint: SignedInHint | null;
}) {
  const [state, formAction] = useActionState(loginAction, undefined);

  /**
   * Reaching this page means there is no session here — it redirects into the
   * app when there is one. So a hint still sitting on the shared domain is
   * stale, left by a session that expired or was ended from somewhere else, and
   * the landing page would go on bouncing this browser here for another month.
   * Clearing it is one line and this is the only page that can: the cookie is
   * deliberately script-readable, and this is the page that knows it is wrong.
   */
  useEffect(() => {
    if (!signedInHint) return;
    document.cookie = `${signedInHint.cookie}=; Max-Age=0; Path=/; Domain=${signedInHint.domain}`;
  }, [signedInHint]);

  return (
    <AuthCard title={instanceName} subtitle="Sign in to your job search.">
      {notice && (
        <motion.p
          variants={authRise}
          className="border-warning/40 bg-warning-tint text-warning mb-5 rounded-lg border px-3 py-2 text-[13px]"
        >
          {notice}
        </motion.p>
      )}

      {googleReady && (
        <motion.div variants={authRise}>
          <GoogleButton />
          <div className="my-5 flex items-center gap-3">
            <span className="auth-rule bg-border h-px flex-1" />
            <span className="text-faint text-[11px] tracking-wide uppercase">or</span>
            <span className="auth-rule bg-border h-px flex-1" />
          </div>
        </motion.div>
      )}

      <motion.form variants={authGroup} action={formAction} className="space-y-4">
        <motion.div variants={authRise} className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="username"
            placeholder="you@example.com"
          />
        </motion.div>
        <motion.div variants={authRise} className="space-y-2">
          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
            placeholder="••••••••••"
          />
        </motion.div>

        <motion.label
          variants={authRise}
          htmlFor="remember"
          className="text-muted-foreground flex w-fit cursor-pointer items-center gap-2 text-[13px] leading-none font-medium select-none"
        >
          {/* A real checkbox rather than the Radix one. This form posts to a
              server action and still works with scripting off, and Radix only
              grows the hidden input carrying its value once it has hydrated —
              which would quietly shorten the session of anyone without it. */}
          <input
            id="remember"
            name="remember"
            type="checkbox"
            defaultChecked
            className="accent-primary size-4 cursor-pointer"
          />
          Keep me signed in for a month
        </motion.label>

        <AuthError message={state?.error} />

        <motion.div variants={authRise}>
          <SubmitButton label="Sign in" pendingLabel="Signing in…" />
        </motion.div>
      </motion.form>

      {/* The truth here changes with the sign-up setting, and getting it wrong
          in either direction wastes somebody's time: telling an invited person
          they cannot get in, or inviting a stranger to press a button that
          will refuse them. */}
      <motion.p variants={authRise} className="text-muted-foreground mt-6 text-center text-xs">
        {!openSignup
          ? "Accounts here are invite-only. Ask an admin for an invitation, or to reset a password you’ve lost."
          : allowedDomains
            ? `Continue with Google to create an account, if your address is on ${allowedDomains}.`
            : "Continue with Google to create an account, or ask an admin for an invitation."}
      </motion.p>
    </AuthCard>
  );
}

/**
 * A link, not a button with an onClick — the whole flow is a browser redirect,
 * so there is no client-side work to do and this keeps working with JavaScript
 * still loading. The mark is inline SVG because the artifact CSP and the
 * offline-first posture both rule out fetching it from Google.
 */
export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  return (
    <Button asChild variant="outline" size="lg" className="w-full">
      <a href="/api/auth/google">
        <GoogleMark />
        {label}
      </a>
    </Button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * The card every unauthenticated page is inside.
 *
 * Its children are staggered rather than faded in as a block, so the eye is
 * walked down the form in the order it will be filled in — mark, name of the
 * instance, then each thing you have to do, arriving about seventy milliseconds
 * apart. Anything a caller passes that is a `motion` element wearing
 * `authRise` takes its place in that sequence; anything else simply appears
 * with the card, which is a fine second-best and needs no coordination.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={card}
      initial="hidden"
      animate="shown"
      className="auth-card w-full max-w-sm p-8"
    >
      <motion.div variants={authRise} className="mb-7 flex flex-col items-center text-center">
        <HiredMark3D size={84} className="mb-5" />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm text-balance">{subtitle}</p>
      </motion.div>
      {children}
    </motion.div>
  );
}

/**
 * A refusal, arriving and leaving rather than blinking in and out. `popLayout`
 * so the button underneath moves once, with the message, instead of jumping the
 * instant the text is removed.
 */
export function AuthError({ message }: { message?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {message && (
        <motion.p
          key={message}
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0, y: -4 }}
          transition={{ duration: 0.32, ease: EASE }}
          className="text-destructive overflow-hidden text-sm"
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="default"
      size="lg"
      className="auth-submit w-full"
      disabled={pending}
    >
      {/* Both labels are laid on top of each other and cross-faded, so the
          button never changes width mid-submit — "Sign in" and "Signing in…"
          are different lengths and a resizing primary action reads as a
          glitch. The invisible one is the longer of the two, which is what
          holds the width. */}
      <span className="relative inline-flex items-center justify-center gap-2">
        <span aria-hidden className="invisible flex items-center gap-2">
          <LoaderCircleIcon className="size-4" />
          {pendingLabel.length > label.length ? pendingLabel : label}
        </span>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={pending ? "pending" : "idle"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="absolute inset-0 flex items-center justify-center gap-2"
          >
            {pending && <LoaderCircleIcon className="size-4 animate-spin" />}
            {pending ? pendingLabel : label}
          </motion.span>
        </AnimatePresence>
      </span>
    </Button>
  );
}

/**
 * A password box you can look at.
 *
 * The sign-in screen had this and the two screens where you INVENT a password —
 * the invitation and the first-boot setup — did not: a bare dot field, no
 * reveal, no minimum enforced in the browser, so the only feedback on a short
 * one was a round trip to the server. That is the wrong way round. Somebody
 * typing a password they already know can retype it; somebody making one up on
 * a phone keyboard needs to see it.
 *
 * `minLength` matches the server's rule so the browser says it first, and the
 * server still says it too — the client is a courtesy, never the check.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  placeholder,
  minLength,
  hint,
}: {
  id: string;
  name?: string;
  label: string;
  autoComplete: string;
  placeholder: string;
  minLength?: number;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name ?? id}
          type={shown ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShown((was) => !was)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="text-faint hover:text-foreground absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-control transition-colors focus-visible:ring-ring/25 focus-visible:ring-2 outline-none"
        >
          {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
      {hint && <p className="text-faint text-[12px]">{hint}</p>}
    </>
  );
}
