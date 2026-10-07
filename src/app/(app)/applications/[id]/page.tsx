import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageShell } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { requireUser } from "@/lib/auth";
import { applicationDetail } from "@/server/application-detail";
import { ApplicationDetail } from "@/components/pipeline/application-detail";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await applicationDetail(user.id, id);
  if (!detail) notFound();

  return (
    <PageShell>
      <FadeIn>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2 mb-4">
          <Link href="/applications">
            <ArrowLeftIcon /> Board
          </Link>
        </Button>

        <ApplicationDetail {...detail} />
      </FadeIn>
    </PageShell>
  );
}
