"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reportRenderErrorAction } from "@/server/actions";

/**
 * What a person sees when a screen throws.
 *
 * Next hands the browser a `digest` and nothing else — the real error goes to
 * the server's stdout, which on a hosted instance nobody is reading. So this
 * does two jobs: it says something honest to the person in front of it, and it
 * tells the instance, which is what puts a row in Admin → Health.
 *
 * The digest is the only thing sent back. The message the browser holds is not
 * trustworthy and is not the real one anyway.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    void reportRenderErrorAction({ digest: error.digest, path: pathname }).catch(() => {});
  }, [error.digest, pathname]);

  return (
    <main className="flex min-h-[60svh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">This screen didn&apos;t load</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        Nothing you had saved is affected. Try again, and if it keeps happening the failure has
        been recorded for whoever runs this instance.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <a href="/">Back to your list</a>
        </Button>
      </div>
      {error.digest && (
        <p className="text-faint meta text-[11.5px]">Reference {error.digest}</p>
      )}
    </main>
  );
}
