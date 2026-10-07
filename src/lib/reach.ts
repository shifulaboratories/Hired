import type { Stage } from "@prisma/client";

/**
 * How far one application ever got: sent, interviewed, offered.
 *
 * The one rule behind every per-resume outcome. list_resumes' grid counts and
 * resume_performance used to carry a copy each, with their own stage lists and
 * slightly different offer rules (one counted a move into ACCEPTED, the other
 * did not), and both tools said they answered "which resume is working".
 *
 * An offer proves the interviews happened even when no move to a screen was
 * recorded, so `offered` implies `interviewed`, always. A wishlist row was
 * never sent and reaches nothing.
 */
export const INTERVIEWED_STAGES: Stage[] = ["INTERVIEWING", "OFFER", "ACCEPTED"];
export const OFFER_STAGES: Stage[] = ["OFFER", "ACCEPTED"];

export type Reach = { sent: boolean; interviewed: boolean; offered: boolean };

export function reachOf(application: {
  stage: Stage;
  activities: { type: string; toStage: Stage | null }[];
}): Reach {
  if (application.stage === "WISHLIST") return { sent: false, interviewed: false, offered: false };
  const reached = (stages: Stage[], type: "INTERVIEW" | "OFFER") =>
    stages.includes(application.stage) ||
    application.activities.some(
      (activity) => activity.type === type || (activity.toStage !== null && stages.includes(activity.toStage)),
    );
  const offered = reached(OFFER_STAGES, "OFFER");
  return { sent: true, interviewed: offered || reached(INTERVIEWED_STAGES, "INTERVIEW"), offered };
}
