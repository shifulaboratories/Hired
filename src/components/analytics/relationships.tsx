import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Relationships } from "@/lib/data/pipeline";

/**
 * Who has been worth something, and who has gone quiet.
 *
 * The diagnosis card above answers that about documents and channels. This is
 * the same question about people, and for most searches it is the one with the
 * biggest number behind it — referrals convert better than anything else, and
 * until now nothing in the app could say who yours came from.
 *
 * Two counts rather than one score. A person attached to the application is
 * evidence; a person who merely works there is a hint. Adding them would make
 * a recruiter at a large employer look like the best contact on file.
 */
export function RelationshipsCard({ relationships }: { relationships: Relationships }) {
  const { contacts, worthKeepingWarm, confident } = relationships;
  const earned = contacts.filter(
    (row) => row.direct.applications > 0 || row.atCompany.applications > 0,
  );

  if (!confident || earned.length === 0) return null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-[15px]">Who has been worth something</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {earned.slice(0, 5).map((row) => (
            <li key={row.id} className="flex items-baseline gap-2">
              <Link
                href={`/crm/contacts/${row.id}`}
                className="min-w-0 flex-1 truncate text-[12.5px] hover:underline"
              >
                {row.name}
                {row.title ? <span className="text-faint"> · {row.title}</span> : null}
              </Link>
              <span className="nums text-faint shrink-0 text-[11.5px]">
                {/* Spelled out rather than summed: "2 direct" and "9 at their
                    company" are different claims and the reader needs both. */}
                {row.direct.interviews > 0
                  ? `${row.direct.interviews} interview${row.direct.interviews > 1 ? "s" : ""}`
                  : row.direct.applications > 0
                    ? `${row.direct.applications} application${row.direct.applications > 1 ? "s" : ""}`
                    : `${row.atCompany.applications} at their company`}
              </span>
            </li>
          ))}
        </ul>

        {worthKeepingWarm.length > 0 && (
          <div className="border-t pt-3">
            <div className="eyebrow mb-1.5">Worth a message</div>
            <ul className="space-y-1">
              {worthKeepingWarm.slice(0, 4).map((row) => (
                <li key={row.id} className="flex items-baseline gap-2">
                  <Link
                    href={`/crm/contacts/${row.id}`}
                    className="min-w-0 flex-1 truncate text-[12.5px] hover:underline"
                  >
                    {row.name}
                  </Link>
                  <span className="nums text-faint shrink-0 text-[11.5px]">
                    {row.pingDue ? "ping due" : `quiet ${row.quietDays}d`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
