import { redirect } from "next/navigation";

/**
 * Tasks moved to the front door.
 *
 * The list you work from is the first thing you should see, so it is `/` now
 * and the numbers moved to their own page. This redirect stays because
 * `/tasks` is in people's history, in the command palette's muscle memory, and
 * in the two links the manual has been publishing.
 */
export default function TasksPage() {
  redirect("/");
}
