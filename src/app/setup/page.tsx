import { redirect } from "next/navigation";
import { instanceNeedsSetup, setupKeyIsRequired } from "@/lib/auth";
import { SetupForm } from "@/components/setup-form";
import { AuthShell, authViewport } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

/** The door is light; the bar above it has to be told. */
export const viewport = authViewport;

/**
 * Fallback only. The owner account is normally provisioned at boot by
 * src/lib/bootstrap.ts, which closes the window where a stranger could claim
 * the instance. This page exists for the case where that failed — and still
 * requires APP_PASSWORD as a setup key when one is configured.
 */
export default async function SetupPage() {
  if (!(await instanceNeedsSetup())) redirect("/login");

  return (
      <AuthShell>
        <SetupForm requiresKey={setupKeyIsRequired()} />
      </AuthShell>
  );
}
