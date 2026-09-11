import { ProposalKind, ProposalStatus, Prisma, type ActivityType, type Stage } from "@prisma/client";
import { db } from "@/lib/db";
import * as pipeline from "@/lib/data/pipeline";

/**
 * The review queue: what an assistant thinks should happen, waiting for a yes.
 *
 * `inbox_review` reads a week of mail, finds six things the pipeline does not
 * know, and asks about them one at a time — which works only if you are at the
 * conversation when it asks. Anything you do not answer is gone. This is the
 * same six waiting on the dashboard, each with the line of evidence that
 * produced it, accepted or dismissed whenever you get to it.
 *
 * The safety story, because this is the one place in the app where a stored
 * blob turns into a write:
 *
 * - **A closed set of kinds.** Five, each mapping to exactly one data-layer
 *   call. There is no "run this tool" proposal and there should never be one.
 * - **Validated twice.** Once when it is queued, so a malformed proposal is
 *   refused rather than sitting there looking legitimate, and again on accept,
 *   because the world moves between the two.
 * - **userId comes from the session, never the payload.** Every call this
 *   dispatches to takes the owner's id as its first positional argument. A
 *   payload naming somebody else's application fails its own lookup.
 * - **Accepting is idempotent.** A row leaves PENDING before its work runs, so
 *   a double click cannot log the same interview twice.
 */

export const PROPOSAL_KINDS = [
  "LOG_ACTIVITY",
  "MOVE_STAGE",
  "CREATE_TASK",
  "SET_FOLLOW_UP",
  "CREATE_CONTACT",
] as const satisfies readonly ProposalKind[];

export const PROPOSAL_LABEL: Record<ProposalKind, string> = {
  LOG_ACTIVITY: "Log it",
  MOVE_STAGE: "Move stage",
  CREATE_TASK: "Add a task",
  SET_FOLLOW_UP: "Change the follow-up",
  CREATE_CONTACT: "Add a person",
};

type Payload = Record<string, unknown>;

export type ProposalInput = {
  kind: ProposalKind;
  summary: string;
  evidence?: string;
  source?: string;
  applicationId?: string | null;
  contactId?: string | null;
  payload: Payload;
};

const str = (payload: Payload, key: string): string | undefined => {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};
const num = (payload: Payload, key: string): number | undefined => {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};
const list = (payload: Payload, key: string): string[] | undefined => {
  const value = payload[key];
  return Array.isArray(value) ? value.map(String) : undefined;
};

/**
 * Is this payload the shape its kind needs?
 *
 * Runs when the proposal is queued and again when it is accepted. Returns the
 * complaint rather than throwing, so `proposeChanges` can refuse one bad row
 * and keep the other five — an inbox review that fails whole because one
 * suggestion was malformed is an inbox review nobody runs twice.
 */
function complain(kind: ProposalKind, payload: Payload): string | null {
  switch (kind) {
    case "LOG_ACTIVITY": {
      const hasParent = Boolean(str(payload, "applicationId")) !== Boolean(str(payload, "contactId"));
      if (!hasParent) return "log_activity needs exactly one of applicationId or contactId";
      if (!str(payload, "body")) return "log_activity needs a body";
      return null;
    }
    case "MOVE_STAGE":
      if (!str(payload, "applicationId")) return "move_stage needs an applicationId";
      if (!str(payload, "stage")) return "move_stage needs a stage";
      return null;
    case "CREATE_TASK":
      return str(payload, "title") ? null : "create_task needs a title";
    case "SET_FOLLOW_UP":
      if (!str(payload, "applicationId")) return "set_follow_up needs an applicationId";
      if (!str(payload, "nextFollowUpAt")) return "set_follow_up needs a date";
      return null;
    case "CREATE_CONTACT":
      return str(payload, "name") ? null : "create_contact needs a name";
  }
}

export type ProposeResult = {
  queued: { id: string; kind: ProposalKind; summary: string }[];
  refused: { summary: string; reason: string }[];
};

export async function proposeChanges(
  userId: string,
  items: ProposalInput[],
): Promise<ProposeResult> {
  const queued: ProposeResult["queued"] = [];
  const refused: ProposeResult["refused"] = [];

  for (const item of items) {
    const summary = item.summary?.trim();
    if (!summary) {
      refused.push({ summary: "", reason: "every proposal needs a one-line summary" });
      continue;
    }
    const reason = complain(item.kind, item.payload ?? {});
    if (reason) {
      refused.push({ summary, reason });
      continue;
    }
    // The two link columns are for grouping the queue by job or person, so a
    // link that is not theirs is dropped rather than refusing the row — the
    // payload's own ids are what the accept validates.
    const applicationId = item.applicationId
      ? ((await db.application.findFirst({
          where: { id: item.applicationId, userId, archivedAt: null },
          select: { id: true },
        }))?.id ?? null)
      : null;
    const contactId = item.contactId
      ? ((await db.contact.findFirst({
          where: { id: item.contactId, userId, archivedAt: null },
          select: { id: true },
        }))?.id ?? null)
      : null;

    const row = await db.proposal.create({
      data: {
        userId,
        kind: item.kind,
        summary,
        evidence: item.evidence?.trim() ?? "",
        source: item.source?.trim() ?? "",
        payload: (item.payload ?? {}) as Prisma.InputJsonValue,
        applicationId,
        contactId,
      },
      select: { id: true, kind: true, summary: true },
    });
    queued.push(row);
  }

  return { queued, refused };
}

const proposalInclude = {
  application: {
    select: { id: true, roleTitle: true, stage: true, company: { select: { name: true } } },
  },
  contact: { select: { id: true, name: true } },
} satisfies Prisma.ProposalInclude;

export async function listProposals(
  userId: string,
  options?: { status?: ProposalStatus; applicationId?: string; limit?: number },
) {
  return db.proposal.findMany({
    where: {
      userId,
      status: options?.status ?? "PENDING",
      ...(options?.applicationId ? { applicationId: options.applicationId } : {}),
      // A proposal about an archived job is not actionable, and showing it
      // would be offering to write to something the person has deleted.
      OR: [{ applicationId: null }, { application: { archivedAt: null } }],
    },
    orderBy: [{ createdAt: "asc" }],
    take: options?.limit,
    include: proposalInclude,
  });
}

export async function pendingProposalCount(userId: string) {
  return db.proposal.count({
    where: {
      userId,
      status: "PENDING",
      OR: [{ applicationId: null }, { application: { archivedAt: null } }],
    },
  });
}

/**
 * Do the thing.
 *
 * The row leaves PENDING before the work runs, so two clicks cannot log the
 * same interview twice. If the work then fails — the application was deleted,
 * the stage is not a stage — the row is put back to PENDING with the reason on
 * it, because a proposal that silently vanished is worse than one that says
 * why it could not be done.
 */
export async function acceptProposal(userId: string, id: string) {
  const claimed = await db.proposal.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "ACCEPTED", decidedAt: new Date(), outcome: "" },
  });
  if (claimed.count === 0) {
    const existing = await db.proposal.findFirst({ where: { id, userId } });
    if (!existing) throw new Error("No such proposal");
    throw new Error(`That was already ${existing.status.toLowerCase()}.`);
  }

  const proposal = await db.proposal.findFirstOrThrow({ where: { id, userId } });
  const payload = (proposal.payload ?? {}) as Payload;
  const reason = complain(proposal.kind, payload);
  if (reason) {
    await db.proposal.update({
      where: { id },
      data: { status: "PENDING", decidedAt: null, outcome: reason },
    });
    throw new Error(reason);
  }

  try {
    const outcome = await dispatch(userId, proposal.kind, payload);
    return db.proposal.update({ where: { id }, data: { outcome }, include: proposalInclude });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not do that.";
    await db.proposal.update({
      where: { id },
      data: { status: "PENDING", decidedAt: null, outcome: message },
    });
    throw error;
  }
}

/** One kind, one data call. Adding a branch here is adding a capability. */
async function dispatch(userId: string, kind: ProposalKind, payload: Payload): Promise<string> {
  switch (kind) {
    case "LOG_ACTIVITY": {
      await pipeline.addActivity(userId, {
        applicationId: str(payload, "applicationId"),
        contactId: str(payload, "contactId"),
        type: str(payload, "type") as ActivityType | undefined,
        body: str(payload, "body")!,
        occurredAt: str(payload, "occurredAt"),
      });
      return "Logged to the timeline.";
    }
    case "MOVE_STAGE": {
      const moved = await pipeline.moveApplicationStage(
        userId,
        str(payload, "applicationId")!,
        str(payload, "stage") as Stage,
        str(payload, "note"),
        {
          interviewRound: num(payload, "interviewRound"),
          roundLabel: str(payload, "roundLabel"),
          lossReasons: list(payload, "lossReasons"),
        },
      );
      const added = moved.addedTasks.length;
      return added === 0
        ? `Moved to ${moved.stage}.`
        : `Moved to ${moved.stage}, and your checklist added ${added} ${added === 1 ? "task" : "tasks"}.`;
    }
    case "CREATE_TASK": {
      await pipeline.createTask(userId, {
        title: str(payload, "title")!,
        detail: str(payload, "detail"),
        dueAt: str(payload, "dueAt") ?? null,
        applicationId: str(payload, "applicationId") ?? null,
        contactId: str(payload, "contactId") ?? null,
      });
      return "Added to your tasks.";
    }
    case "SET_FOLLOW_UP": {
      await pipeline.updateApplication(userId, str(payload, "applicationId")!, {
        nextFollowUpAt: str(payload, "nextFollowUpAt"),
      });
      return "Follow-up date changed.";
    }
    case "CREATE_CONTACT": {
      const contact = await pipeline.createContact(userId, {
        name: str(payload, "name")!,
        email: str(payload, "email"),
        title: str(payload, "title"),
        relationship: str(payload, "relationship"),
        applicationId: str(payload, "applicationId"),
        companyIds: list(payload, "companyIds") ?? (str(payload, "companyId") ? [str(payload, "companyId")!] : undefined),
      });
      return `Added ${contact.name} to your people.`;
    }
  }
}

export async function dismissProposal(userId: string, id: string) {
  const { count } = await db.proposal.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "DISMISSED", decidedAt: new Date() },
  });
  if (count === 0) throw new Error("No such pending proposal");
  return { dismissed: count };
}

/** Everything still waiting, gone at once. The "I will do this myself" button. */
export async function dismissAllProposals(userId: string) {
  const { count } = await db.proposal.updateMany({
    where: { userId, status: "PENDING" },
    data: { status: "DISMISSED", decidedAt: new Date() },
  });
  return { dismissed: count };
}

/** Clear out what has already been decided. Nothing pending is touched. */
export async function clearDecidedProposals(userId: string) {
  const { count } = await db.proposal.deleteMany({
    where: { userId, status: { in: ["ACCEPTED", "DISMISSED"] } },
  });
  return { deleted: count };
}

export { ProposalStatus, ProposalKind };
