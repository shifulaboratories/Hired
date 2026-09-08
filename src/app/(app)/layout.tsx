import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Shell } from "@/components/shell";
import { relativeDay } from "@/lib/utils";
import { dueNow } from "@/lib/data/pipeline";

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
    db.profile.findUnique({ where: { userId: user.id }, select: { photo: true } }),
  ]);

  // Flattened here rather than in the bell: the shell is a client component,
  // and a Date crossing that boundary is one more thing that can format
  // differently on the two sides of a hydration.
  const notices = [...due.followUps, ...due.pings, ...due.tasks].map((item) => ({
    kind: item.kind,
    id: item.id,
    title: item.title,
    detail: item.detail,
    due: relativeDay(item.dueAt),
    overdue: item.overdue,
  }));

  return (
    <>
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
    </>
  );
}
