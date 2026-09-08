import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Stage } from "@prisma/client";
import { getSharedPipeline } from "@/lib/data/pipeline-share";
import { STAGE_LABEL, STAGE_TONE, TERMINAL_STAGES } from "@/lib/data/pipeline";
import { CompanyAvatar } from "@/components/pipeline/company-avatar";
import { HiredMark } from "@/components/hired-mark";
import { companyDomain } from "@/lib/company";
import { getSettings } from "@/lib/settings";
import { cn, relativeDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Somebody else's job search, read-only.
 *
 * The same shape as the public resume page and for the same reasons: no
 * authentication, because this is a link you send to a person you have already
 * decided to send it to; and deliberately mute, because the slug is the only
 * thing protecting it. There is no navigation into the app, no way to walk
 * from here to anything the owner has not shared, and a slug that does not
 * resolve is a plain 404 — indistinguishable from one that never existed, so
 * the page cannot be used to probe for real links.
 *
 * What is shown is decided in `getSharedPipeline`'s select, not here. If you
 * are about to add a column to this table, go and read that comment first.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const shared = await getSharedPipeline(slug);
  if (!shared) return { title: "Not found", robots: { index: false, follow: false } };
  return {
    title: shared.ownerName ? `${shared.ownerName} — job search` : "Job search",
    // Unlisted means unlisted. An indexed "unlisted" link is a listed one.
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function SharedPipelinePage({ params }: Params) {
  const { slug } = await params;
  const [shared, { companyLogos }] = await Promise.all([getSharedPipeline(slug), getSettings()]);
  if (!shared) notFound();

  const { applications, ownerName, ownerTimeZone } = shared;
  const live = applications.filter((a) => !TERMINAL_STAGES.includes(a.stage));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 md:px-8">
      <header className="mb-7">
        <div className="text-faint mb-3 flex items-center gap-2 text-[12px]">
          <HiredMark size={18} />
          <span>Shared from Hired</span>
        </div>
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight md:text-[26px]">
          {ownerName ? `${ownerName}'s job search` : "A job search"}
        </h1>
        <p className="text-muted-foreground mt-1.5 text-[13.5px]">
          {live.length} live {live.length === 1 ? "application" : "applications"}
          {applications.length > live.length && ` · ${applications.length - live.length} closed`}.
          Read-only — nothing here can be changed from this page.
        </p>
      </header>

      {applications.length === 0 ? (
        <div className="text-faint rounded-xl border border-dashed py-16 text-center text-[13px]">
          Nothing in the pipeline yet.
        </div>
      ) : (
        <div className="bg-card shadow-card overflow-hidden rounded-xl">
          <div className="eyebrow bg-inset flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">Company</div>
            <div className="w-28 shrink-0">Stage</div>
            <div className="hidden w-20 shrink-0 text-right sm:block">Waiting</div>
            <div className="hidden w-24 shrink-0 text-right md:block">Follow-up</div>
          </div>
          <ul className="divide-y">
            {applications.map((application) => (
              <li
                key={application.id}
                style={{ ["--tone" as string]: STAGE_TONE[application.stage] }}
                className="stage-band flex items-center gap-3 px-4 py-2.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <CompanyAvatar
                    name={application.company.name}
                    domain={
                      companyLogos
                        ? companyDomain({
                            name: application.company.name,
                            website: application.company.website,
                          })
                        : null
                    }
                    size={26}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">
                      {application.company.name}
                    </div>
                    <div className="text-faint truncate text-[12px]">
                      {application.roleTitle}
                      {application.location ? ` · ${application.location}` : ""}
                    </div>
                  </div>
                </div>

                <div className="w-28 shrink-0">
                  <span
                    className="stage-chip inline-block max-w-full truncate rounded-chip px-1.5 py-0.5 text-[11.5px] font-medium"
                    style={{ ["--tone" as string]: STAGE_TONE[application.stage as Stage] }}
                  >
                    {STAGE_LABEL[application.stage]}
                  </span>
                </div>

                <div
                  className={cn(
                    "nums hidden w-20 shrink-0 text-right text-[12px] sm:block",
                    !TERMINAL_STAGES.includes(application.stage) && application.daysInStage >= 21
                      ? "text-destructive"
                      : "text-faint",
                  )}
                >
                  {TERMINAL_STAGES.includes(application.stage)
                    ? "—"
                    : `${application.daysInStage}d`}
                </div>

                <div className="nums text-muted-foreground hidden w-24 shrink-0 text-right text-[12px] md:block">
                  {application.nextFollowUpAt ? relativeDay(application.nextFollowUpAt, ownerTimeZone) : "—"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-faint mt-6 text-[12px]">
        Salaries, notes, contacts and job descriptions are not shared.
      </p>
    </main>
  );
}
