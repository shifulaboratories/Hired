import { requireUser } from "@/lib/auth";
import {
  exportApplicationsCsv,
  exportCompaniesCsv,
  exportContactsCsv,
  exportFilename,
} from "@/lib/data/export";
import {
  parseCompanyFilters,
  parseCompanySort,
  parseContactFilters,
  parseContactSort,
  companyDesc,
  contactDesc,
} from "@/lib/crm-filters";
import { parsePipelineFilters } from "@/lib/pipeline-filters";
import { parseSort } from "@/lib/pipeline-list";
import { STAGES } from "@/lib/data/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = ["companies", "contacts", "applications"] as const;
type Kind = (typeof KINDS)[number];

/**
 * A list, as a file.
 *
 * A route rather than a server action returning a string, for one reason: a
 * browser download wants a real response with a Content-Disposition on it. The
 * alternative — hand the client a string and have it build a Blob — puts the
 * whole file through the React payload and then asks the browser to save
 * something it never fetched.
 *
 * Authenticated the ordinary way, through `requireUser` and the session cookie,
 * exactly like the PDF route beside it. There is no unauthenticated export
 * link: the two unlisted URLs this app has, /r and /p, are the deliberate
 * ceiling, and a third one over somebody's whole CRM is not a ceiling.
 *
 * The query string is the one the screen was already on, so what comes out is
 * what was on screen — same filters, same search, same order. `ids` narrows to
 * a ticked selection.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await requireUser();
  const { kind } = await params;
  if (!(KINDS as readonly string[]).includes(kind)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const one = (key: string) => url.searchParams.get(key) ?? undefined;
  const ids = one("ids")?.split(",").filter(Boolean);

  const csv = await build(kind as Kind, user.id, one, ids);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(kind)}"`,
      "Cache-Control": "no-store",
    },
  });
}

function build(kind: Kind, userId: string, one: (key: string) => string | undefined, ids?: string[]) {
  if (kind === "companies") {
    const filters = parseCompanyFilters(one);
    const sort = parseCompanySort(one("sort"));
    return exportCompaniesCsv(userId, {
      search: filters.search,
      filter: filters.cut ?? undefined,
      industryIds: filters.industries,
      sizeIds: filters.sizes,
      locationIds: filters.locations,
      tagIds: filters.tags,
      missing: filters.missing,
      sort,
      dir: companyDesc(sort, one("dir")) ? "desc" : "asc",
      ids,
    });
  }
  if (kind === "contacts") {
    const filters = parseContactFilters(one);
    const sort = parseContactSort(one("sort"));
    return exportContactsCsv(userId, {
      search: filters.search,
      filter: filters.cut ?? undefined,
      companyIds: filters.companies,
      tagIds: filters.tags,
      quietDays: filters.quiet ?? undefined,
      missing: filters.missing,
      sort,
      dir: contactDesc(sort, one("dir")) ? "desc" : "asc",
      ids,
    });
  }
  return exportApplicationsCsv(userId, {
    filters: parsePipelineFilters(one, STAGES),
    sort: parseSort(one("sort")),
    desc: one("dir") === "desc",
    ids,
  });
}
