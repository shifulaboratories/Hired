import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageShell } from "@/components/page-header";

/**
 * Not-found, inside the app rather than outside it.
 *
 * The root not-found.tsx renders on a bare page: no rail, no bell, no way
 * anywhere except one button. The commonest way to reach it is not a typo —
 * it is opening a link to something you archived, from a bookmark, an old
 * email, or the browser's own history. So it says where that thing went and
 * gives the two doors back, and because this file sits inside the (app) route
 * group it renders inside the Shell, which means the rail is still there even
 * if the copy fails somebody.
 */
export default function AppNotFound() {
  return (
    <PageShell>
      <PageHeader eyebrow="Not here" title="That's not here" />
      <EmptyState
        icon={SearchXIcon}
        title="Nothing at this address"
        description="If you deleted it, it is not gone — companies, people and jobs go to the archive for thirty days before anything is destroyed, and you can put them back from there."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/archive">Look in the archive</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to Today</Link>
            </Button>
          </div>
        }
      />
    </PageShell>
  );
}
