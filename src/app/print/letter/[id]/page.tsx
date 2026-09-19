import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getLetter } from "@/lib/data/letters";
import { getProfile } from "@/lib/data/me";
import { LetterPaper } from "@/components/letters/letter-paper";
import { PrintTrigger } from "@/components/resume/print-trigger";
import { civilDay, formatCivilDay, SERVER_ZONE } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * The letter equivalent of /print/[id], and for the same two reasons: it is
 * what the server drives a headless browser to, and it is the whole feature on
 * a host with no Chromium, where the browser's own "Save as PDF" produces the
 * same selectable text.
 *
 * Auth-gated like the resume print page. The PDF route signs in as a
 * short-lived session rather than making this address public.
 */
export default async function LetterPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [letter, profile] = await Promise.all([getLetter(user.id, id), getProfile(user.id)]);
  if (!letter) notFound();

  // Their zone, not the server's: a letter dated a day early because the box
  // is in UTC is exactly the class of bug the time-zone sweep removed.
  const zone = profile.timeZone || SERVER_ZONE;
  const date = formatCivilDay(civilDay(new Date(), zone), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-svh bg-neutral-200 py-8 print:bg-white print:py-0">
      <PrintTrigger fileName={letter.title || "Letter"} />
      <div className="mx-auto w-fit bg-white shadow-2xl print:shadow-none">
        <LetterPaper
          kind={letter.kind}
          title={letter.title}
          recipient={letter.recipient}
          body={letter.body}
          date={date}
          from={{
            name: profile.fullName || user.name || "",
            email: profile.email || user.email || "",
            phone: profile.phone,
            location: profile.location,
            website: profile.website,
          }}
        />
      </div>
    </div>
  );
}
