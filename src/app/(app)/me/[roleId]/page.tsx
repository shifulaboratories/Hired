import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageShell } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { getRole } from "@/lib/data/me";
import { highlightUsage } from "@/lib/data/me-checks";
import { requireUser } from "@/lib/auth";
import { RoleEditor } from "@/components/me/role-editor";

export const dynamic = "force-dynamic";

export default async function RolePage({ params }: { params: Promise<{ roleId: string }> }) {
  const user = await requireUser();
  const { roleId } = await params;
  const [role, usage] = await Promise.all([getRole(user.id, roleId), highlightUsage(user.id)]);
  if (!role) notFound();

  return (
    <PageShell>
      <FadeIn>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2 mb-4">
          <Link href="/me">
            <ArrowLeftIcon /> Me
          </Link>
        </Button>

        <RoleEditor
          role={{
            id: role.id,
            company: role.company,
            title: role.title,
            employmentType: role.employmentType,
            location: role.location,
            startDate: role.startDate,
            endDate: role.endDate,
            isCurrent: role.isCurrent,
            summary: role.summary,
            background: role.background,
            tags: role.tags,
            startUnconfirmed: role.startUnconfirmed,
            endUnconfirmed: role.endUnconfirmed,
          }}
          highlights={role.highlights.map((h) => ({
            id: h.id,
            text: h.text,
            impact: h.impact,
            strength: h.strength,
            tags: h.tags,
            usedIn: (usage.get(h.id) ?? []).map((use) => ({ resumeId: use.resumeId, name: use.name })),
          }))}
          notes={role.notes.map((note) => ({
            id: note.id,
            title: note.title,
            body: note.body,
            kind: note.kind,
          }))}
        />
      </FadeIn>
    </PageShell>
  );
}
