import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Shell } from "@/components/shell";
import { relativeDay } from "@/lib/utils";
import { dueNow } from "@/lib/data/pipeline";
import { WelcomeTour } from "@/components/onboarding/welcome-tour";
import { ViewerZoneProvider } from "@/components/viewer-zone";

export const dynamic = "force-dynamic";

/**
 * The chrome, and as little else as possible.
 *
 * This used to assemble the command palette's index too — three content
 * queries on every single navigation, for a dialog most navigations never
 * open, and three hand-written `where: { userId }` clauses outside
 * src/lib/data/. The palette fetches its own index when it opens now.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [due, profile] = await Promise.all([
    dueNow(user.id),
    db.profile.findUnique({
      where: { userId: user.id },
      select: { photo: true, tourSeenAt: true, timeZone: true },
    }),
  ]);

  // Flattened here rather than in the bell: the shell is a client component,
  // and a Date crossing that boundary is one more thing that can format
  // differently on the two sides of a hydration.
  // Empty until the browser seeds it, and empty means the server's own clock —
  // which is what every date in this app was computed against before this.
  const zone = profile?.timeZone ?? "";
  const notices = [...due.followUps, ...due.pings, ...due.tasks].map((item) => ({
    kind: item.kind,
    id: item.id,
    title: item.title,
    detail: item.detail,
    due: relativeDay(item.dueAt, zone),
    overdue: item.overdue,
  }));

  return (
    <ViewerZoneProvider zone={zone}>
      <Shell
        notices={notices}
        user={{
          name: user.name,
          email: user.email,
          role: user.role,
          photo: profile?.photo ?? "",
        }}
      >
        {children}
      </Shell>

      {/* In the layout rather than on a page: it is the first thing somebody
          sees whichever screen they land on, and a first-run tour that only
          fires on one route is a first-run tour that misses half the people.
          Null means never seen — including for every account that predates the
          column, which is the right answer for a feature whose job is to
          explain what the app is. */}
      <WelcomeTour open={profile?.tourSeenAt == null} />
    </ViewerZoneProvider>
  );
}
