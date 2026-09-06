import { redirect } from "next/navigation";

/**
 * Analytics is a tab on the front door, not a screen of its own.
 *
 * It was briefly both, and having it in the rail made it a place you had to
 * decide to visit rather than a second look at the page you already open. This
 * redirect stays because `/analytics` is in the manual, in the README, and in
 * whatever history the change caught.
 */
export default function AnalyticsPage() {
  redirect("/?tab=analytics");
}
