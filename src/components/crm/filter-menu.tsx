import { FacetMenu, type FacetGroup, type FacetRow } from "@/components/filters/facet-menu";
import { tagTone } from "@/lib/data/tags";
import {
  COMPANY_MISSING,
  CONTACT_MISSING,
  EMPTY_COMPANY_FILTERS,
  EMPTY_CONTACT_FILTERS,
  buildCompanyQuery,
  buildContactQuery,
  toggleIn,
  type CompanyFilters,
  type CompanyMissing,
  type CompanySort,
  type ContactFilters,
  type ContactMissing,
  type ContactSort,
} from "@/lib/crm-filters";

/**
 * The CRM's two filter menus.
 *
 * Same shell as the pipeline's, same reasoning: what is here is only the part
 * that is true of these screens — which dimensions exist, what each row says,
 * and the URL each produces.
 */

export type CompanyFacets = {
  industry: { id: string; name: string; color: string; count: number }[];
  size: { id: string; name: string; color: string; count: number }[];
  location: { id: string; name: string; color: string; count: number }[];
  tags: { id: string; name: string; color: string; count: number }[];
  missing: Record<CompanyMissing, number>;
};

export type ContactFacets = {
  tags: { id: string; name: string; color: string; count: number }[];
  companies: { id: string; name: string; count: number }[];
  missing: Record<ContactMissing, number>;
};

const QUIET = [30, 60, 90];

const MISSING_COMPANY_LABEL: Record<CompanyMissing, string> = {
  website: "No website",
  industry: "No industry",
  location: "No location",
};

const MISSING_CONTACT_LABEL: Record<ContactMissing, string> = {
  email: "No email",
  tags: "No tags",
};

export function CompanyFilterMenu({
  filters,
  facets,
  sort,
  dir,
}: {
  filters: CompanyFilters;
  facets: CompanyFacets;
  sort?: CompanySort;
  dir?: string;
}) {
  const href = (next: CompanyFilters) => buildCompanyQuery({ filters: next, sort, dir });

  const tagGroup = (
    heading: string,
    rows: CompanyFacets["industry"],
    key: "industries" | "sizes" | "locations" | "tags",
    prefix: string,
  ): FacetGroup => ({
    heading,
    rows: rows.map((tag) => ({
      id: `${prefix}-${tag.id}`,
      label: tag.name,
      count: tag.count,
      on: filters[key].includes(tag.id),
      dot: tagTone(tag.color),
      href: href({ ...filters, [key]: toggleIn(filters[key], tag.id) }),
    })),
  });

  const active =
    filters.industries.length +
    filters.sizes.length +
    filters.locations.length +
    filters.tags.length +
    filters.missing.length;

  const groups: FacetGroup[] = [
    tagGroup("Industry", facets.industry, "industries", "ind"),
    tagGroup("Size", facets.size, "sizes", "size"),
    tagGroup("Location", facets.location, "locations", "loc"),
    tagGroup("Tags", facets.tags, "tags", "tag"),
    {
      heading: "Gaps",
      separated: true,
      rows: COMPANY_MISSING.map((gap) => ({
        id: `miss-${gap}`,
        label: MISSING_COMPANY_LABEL[gap],
        count: facets.missing[gap],
        on: filters.missing.includes(gap),
        href: href({ ...filters, missing: toggleIn(filters.missing, gap) as CompanyMissing[] }),
      })),
    },
  ];

  const noTagsAtAll =
    facets.industry.length === 0 && facets.size.length === 0 && facets.location.length === 0;

  return (
    <FacetMenu
      groups={groups}
      activeCount={active}
      clearHref={href({ ...EMPTY_COMPANY_FILTERS, cut: filters.cut, search: filters.search })}
      placeholder="Industry, size, location, tag…"
      ariaLabel="Filter companies"
      note={
        noTagsAtAll
          ? "Tag a company's industry, size or location and those lists appear here."
          : undefined
      }
    />
  );
}

export function ContactFilterMenu({
  filters,
  facets,
  sort,
  dir,
}: {
  filters: ContactFilters;
  facets: ContactFacets;
  sort?: ContactSort;
  dir?: string;
}) {
  const href = (next: ContactFilters) => buildContactQuery({ filters: next, sort, dir });

  const active =
    filters.tags.length +
    filters.companies.length +
    filters.missing.length +
    (filters.quiet !== null ? 1 : 0);

  const groups: FacetGroup[] = [
    {
      heading: "Tags",
      rows: facets.tags.map((tag) => ({
        id: `tag-${tag.id}`,
        label: tag.name,
        count: tag.count,
        on: filters.tags.includes(tag.id),
        dot: tagTone(tag.color),
        href: href({ ...filters, tags: toggleIn(filters.tags, tag.id) }),
      })),
    },
    {
      heading: "Company",
      rows: facets.companies.map((company) => ({
        id: `co-${company.id}`,
        label: company.name,
        count: company.count,
        on: filters.companies.includes(company.id),
        href: href({ ...filters, companies: toggleIn(filters.companies, company.id) }),
      })),
    },
    {
      // The networking question, and not the same one the pipeline asks: this
      // counts from the day you added somebody you have never logged anything
      // against, so people you filed and forgot come back.
      heading: "Nothing logged for",
      separated: true,
      rows: QUIET.map((days) => ({
        id: `qd-${days}`,
        label: `${days} days or more`,
        on: filters.quiet === days,
        href: href({ ...filters, quiet: filters.quiet === days ? null : days }),
      })) as FacetRow[],
    },
    {
      heading: "Gaps",
      rows: CONTACT_MISSING.map((gap) => ({
        id: `miss-${gap}`,
        label: MISSING_CONTACT_LABEL[gap],
        count: facets.missing[gap],
        on: filters.missing.includes(gap),
        href: href({ ...filters, missing: toggleIn(filters.missing, gap) as ContactMissing[] }),
      })),
    },
  ];

  return (
    <FacetMenu
      groups={groups}
      activeCount={active}
      clearHref={href({ ...EMPTY_CONTACT_FILTERS, cut: filters.cut, search: filters.search })}
      placeholder="Tag, company…"
      ariaLabel="Filter people"
    />
  );
}
