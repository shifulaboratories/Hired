import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CrmTabs } from "@/components/crm/tabs";
import { SearchBox } from "@/components/crm/search-box";
import { ContactFilterMenu, type ContactFacets } from "@/components/crm/filter-menu";
import { ContactsList, type ContactRow } from "@/components/crm/contacts-list";
import { SortHeader } from "@/components/crm/sort-header";
import { SortMenu } from "@/components/lists/sort-menu";
import { ArchiveNote } from "@/components/archive/archive-note";
import { listContacts } from "@/lib/data/pipeline";
import { archiveCounts } from "@/lib/data/archive";
import { listTags } from "@/lib/data/tags";
import { getProfile } from "@/lib/data/me";
import { parseWidths } from "@/lib/column-widths";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { BRAND_LABEL, NAMED_PLATFORMS, brandFor, linkHref } from "@/lib/social";
import { agoDay, cn, relativeDay } from "@/lib/utils";
import {
  CONTACT_MISSING,
  EMPTY_CONTACT_FILTERS,
  buildContactQuery,
  contactDesc,
  hasAnyContactFilter,
  matchesContact,
  parseContactFilters,
  parseContactSort,
  sortContacts,
  type ContactCut,
  type ContactFilters,
  type ContactSort,
} from "@/lib/crm-filters";

export const dynamic = "force-dynamic";

/** Same rule as everywhere else: the URL is the state of this screen. */
const CUTS: { key: ContactCut | null; label: string }[] = [
  { key: null, label: "Everyone" },
  { key: "ping-due", label: "Ping due" },
  { key: "with-application", label: "On an application" },
  { key: "no-company", label: "No company" },
];

/**
 * The one link worth a button in a table row.
 *
 * LinkedIn first because it usually is the answer, then whatever else they
 * have — a row that shows nothing for the founder who only posts on X is the
 * bug this replaces.
 */
function bestLink(contact: {
  linkedin: string;
  twitter: string;
  instagram: string;
  github: string;
  website: string;
  otherLinks: string[];
}) {
  for (const platform of NAMED_PLATFORMS) {
    const href = linkHref(contact[platform]);
    if (href) {
      const brand = brandFor(contact[platform], platform);
      return { href, value: contact[platform], label: BRAND_LABEL[brand] };
    }
  }
  for (const value of contact.otherLinks) {
    const href = linkHref(value);
    if (href) return { href, value, label: BRAND_LABEL[brandFor(value)] };
  }
  return null;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);

  const filters = parseContactFilters(one);
  const sort = parseContactSort(one("sort"));
  const desc = contactDesc(sort, one("dir"));

  const [everyContact, tagOptions, bin, { companyLogos }, profile] = await Promise.all([
    listContacts(user.id),
    listTags(user.id, "CONTACT"),
    archiveCounts(user.id),
    getSettings(),
    getProfile(user.id),
  ]);
  const widths = parseWidths(profile.columnWidths);

  const passing = (except: keyof ContactFilters) =>
    everyContact.filter((row) =>
      matchesContact(row, { ...filters, [except]: EMPTY_CONTACT_FILTERS[except] }),
    );

  const tagCounts = new Map<string, number>();
  for (const row of passing("tags")) {
    for (const tag of row.tags) tagCounts.set(tag.id, (tagCounts.get(tag.id) ?? 0) + 1);
  }

  // The company facet is built from the rows themselves rather than a second
  // query, the way the pipeline builds its own.
  const companyCounts = new Map<string, { name: string; count: number }>();
  for (const row of passing("companies")) {
    for (const company of row.companies) {
      const seen = companyCounts.get(company.id);
      companyCounts.set(company.id, { name: company.name, count: (seen?.count ?? 0) + 1 });
    }
  }

  const facets: ContactFacets = {
    tags: tagOptions
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        count: tagCounts.get(tag.id) ?? 0,
      }))
      .filter((tag) => tag.count > 0 || filters.tags.includes(tag.id)),
    companies: [...companyCounts.entries()]
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    missing: Object.fromEntries(
      CONTACT_MISSING.map((gap) => [
        gap,
        everyContact.filter((row) =>
          matchesContact(row, { ...filters, missing: [...new Set([...filters.missing, gap])] }),
        ).length,
      ]),
    ) as ContactFacets["missing"],
  };

  const visible = sortContacts(
    everyContact.filter((contact) => matchesContact(contact, filters)),
    sort,
    desc,
  );

  const cutHref = (cut: ContactCut | null) =>
    buildContactQuery({ filters: { ...filters, cut }, sort, dir: one("dir") });

  const sortHref = (key: ContactSort) =>
    buildContactQuery({
      filters,
      sort: key,
      dir: key === sort ? (desc ? "asc" : "desc") : key === "touch" ? "desc" : "asc",
    });

  const exportHref = `/api/export/contacts?${buildContactQuery({ filters, sort, dir: one("dir") }).split("?")[1] ?? ""}`;
  const narrowed = hasAnyContactFilter(filters);
  const today = new Date();

  const rows: ContactRow[] = visible.map((contact) => ({
    id: contact.id,
    name: contact.name,
    title: contact.title,
    relationship: contact.relationship,
    email: contact.email,
    tags: contact.tags,
    companies: contact.companies.map((company) => ({
      id: company.id,
      name: company.name,
      website: company.website,
    })),
    nextPing: contact.nextFollowUpAt ? relativeDay(contact.nextFollowUpAt) : "—",
    pingDue: contact.nextFollowUpAt !== null && contact.nextFollowUpAt <= today,
    lastTouch: contact.activities[0] ? agoDay(contact.activities[0].occurredAt) : "never",
    best: bestLink(contact),
  }));

  return (
    <PageShell>
      <PageHeader
        eyebrow="CRM"
        title="Contacts"
        description="Recruiters, hiring managers, referrals and the friend who might put in a word. Add people from an application, or straight from a company."
        actions={<CrmTabs current="contacts" />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox placeholder="Search people…" className="w-full sm:w-72" />
        <ContactFilterMenu filters={filters} facets={facets} sort={sort} dir={one("dir")} />
        <SortMenu
          active={sort}
          desc={desc}
          ariaLabel="Sort the people"
          options={[
            {
              key: "name",
              label: "Name",
              href: sortHref("name"),
              ascHref: buildContactQuery({ filters, sort: "name", dir: "asc" }),
              descHref: buildContactQuery({ filters, sort: "name", dir: "desc" }),
            },
            {
              key: "company",
              label: "Company",
              href: sortHref("company"),
              ascHref: buildContactQuery({ filters, sort: "company", dir: "asc" }),
              descHref: buildContactQuery({ filters, sort: "company", dir: "desc" }),
            },
            {
              key: "ping",
              label: "Next ping",
              href: sortHref("ping"),
              ascHref: buildContactQuery({ filters, sort: "ping", dir: "asc" }),
              descHref: buildContactQuery({ filters, sort: "ping", dir: "desc" }),
            },
            {
              key: "touch",
              label: "Last touch",
              href: sortHref("touch"),
              ascHref: buildContactQuery({ filters, sort: "touch", dir: "asc" }),
              descHref: buildContactQuery({ filters, sort: "touch", dir: "desc" }),
            },
          ]}
        />
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <a href={exportHref} download>
            <DownloadIcon /> Export
          </a>
        </Button>
        <span className="text-faint nums ml-auto text-[12px]">
          {narrowed && visible.length !== everyContact.length
            ? `${visible.length} of ${everyContact.length} people`
            : `${visible.length} ${visible.length === 1 ? "person" : "people"}`}
        </span>
      </div>

      <div className="no-scrollbar -mx-1 mb-3 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
        {CUTS.map(({ key, label }) => {
          const active = filters.cut === key;
          const count = everyContact.filter((row) =>
            matchesContact(row, { ...filters, cut: key }),
          ).length;
          return (
            <Link
              key={label}
              href={cutHref(key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "touch-target flex h-11 shrink-0 items-center gap-1.5 rounded-chip px-2 text-[12.5px] transition-colors duration-150 md:h-7",
                active
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {label}
              {count > 0 && <span className="text-faint nums">{count}</span>}
            </Link>
          );
        })}
      </div>

      <ContactsList
        rows={rows}
        filtered={narrowed}
        exportHref={exportHref}
        logos={companyLogos}
        widths={widths}
        header={
          <>
            <SortHeader
              className="min-w-0 flex-1"
              href={sortHref("name")}
              label="Name"
              active={sort === "name"}
              desc={desc}
            />
            <SortHeader
              col="company"
              className="hidden w-44 shrink-0 md:block"
              href={sortHref("company")}
              label="Company"
              active={sort === "company"}
              desc={desc}
            />
            <SortHeader
              col="relationship"
              className="hidden w-32 shrink-0 lg:block"
              label="Relationship"
            />
            <SortHeader
              col="ping"
              className="hidden w-24 shrink-0 sm:block"
              href={sortHref("ping")}
              label="Next ping"
              active={sort === "ping"}
              desc={desc}
              align="right"
            />
            <SortHeader
              col="touch"
              className="w-24 shrink-0"
              href={sortHref("touch")}
              label="Last touch"
              active={sort === "touch"}
              desc={desc}
              align="right"
            />
            <SortHeader col="links" className="hidden w-[60px] shrink-0 sm:block" label="" />
          </>
        }
      />

      <ArchiveNote kind="contact" count={bin.contact} />
    </PageShell>
  );
}
