import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="text-6xl font-semibold tracking-tight">404</div>
        <p className="text-muted-foreground max-w-sm">
          That page doesn&apos;t exist. It may have been deleted.
        </p>
        <Button asChild variant="outline">
          <Link href="/">Back to your list</Link>
        </Button>
      </main>
  );
}
