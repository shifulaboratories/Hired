import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageShell } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { CompanyDetail } from "@/components/crm/company-detail";
import { getCompany, listCompanies } from "@/lib/data/pipeline";
import { tagsOfKind } from "@/lib/data/tags";
import { companyKey } from "@/lib/company";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { accountAccess } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [company, { companyLogos }, everyCompany, googleConnection] = await Promise.all([
    getCompany(user.id, id),
    getSettings(),
    listCompanies(user.id),
    accountAccess(user.id),
  ]);
  if (!company) notFound();

  const candidates = everyCompany
    .filter((candidate) => candidate.id !== company.id)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      website: candidate.website,
      applications: candidate._count.applications,
      contacts: candidate._count.contacts,
    }));
  // "Stripe" and "Stripe, Inc." reduce to the same key. Only ever a suggestion:
  // the key strips enough noise that it will also pair "Meta" with "Meta Labs",
  // so a person reads the plan before anything moves.
  const key = companyKey(company.name);
  const suggestedMergeId = key
    ? candidates.find((candidate) => companyKey(candidate.name) === key)?.id
    : undefined;

  return (
    <PageShell>
      <FadeIn>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2 mb-3">
          <Link href="/crm/companies">
            <ArrowLeftIcon /> Companies
          </Link>
        </Button>

        <CompanyDetail
          company={{
            id: company.id,
            name: company.name,
            website: company.website,
            notes: company.notes,
          }}
          companyTags={{
            industry: tagsOfKind(company.tags, "INDUSTRY"),
            size: tagsOfKind(company.tags, "SIZE"),
            location: tagsOfKind(company.tags, "LOCATION"),
            tags: tagsOfKind(company.tags, "COMPANY"),
          }}
          applications={company.applications.map((application) => ({
            id: application.id,
            roleTitle: application.roleTitle,
            stage: application.stage,
            location: application.location,
            workMode: application.workMode,
            salaryRange: application.salaryRange,
            jobUrl: application.jobUrl,
            tags: application.tags,
            appliedAt: application.appliedAt?.toISOString() ?? null,
            nextFollowUpAt: application.nextFollowUpAt?.toISOString() ?? null,
          }))}
          contacts={company.contacts.map((contact) => ({
            id: contact.id,
            name: contact.name,
            title: contact.title,
            email: contact.email,
            relationship: contact.relationship,
          }))}
          logos={companyLogos}
          candidates={candidates}
          suggestedMergeId={suggestedMergeId}
          googleAccess={googleConnection}
        />
      </FadeIn>
    </PageShell>
  );
}
