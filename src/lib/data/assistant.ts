import type { AssistantMessage, AssistantThread } from "@prisma/client";
import { db } from "@/lib/db";
import { timeZoneOf } from "@/lib/data/me";
import { civilDay, civilInstant } from "@/lib/time";

/**
 * Threads for the assistant built into this app.
 *
 * A CLIENT'S TRANSCRIPT, NOT CAREER CONTENT — which is why there is no
 * `list_assistant_threads` tool, no `get_thread` and no `delete_thread`.
 * Claude Desktop's conversations are not in Hired either, and rule zero is
 * satisfied by construction: everything the assistant can DO was already
 * callable from a conversation, because it calls those exact tools.
 *
 * Every function here takes the owning userId first, like everything else in
 * this directory. `instanceAssistantUsage` is the one that does not, and its
 * own comment says why.
 */

export type AssistantThreadRow = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: number;
};

export type AssistantThreadWithMessages = AssistantThread & { messages: AssistantMessage[] };

/** The first sixty characters of what they said, tidied. Pure. */
export function titleFrom(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

export async function listThreads(userId: string, limit = 30): Promise<AssistantThreadRow[]> {
  const rows = await db.assistantThread.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messages: row._count.messages,
  }));
}

export async function getThread(
  userId: string,
  id: string,
): Promise<AssistantThreadWithMessages | null> {
  return db.assistantThread.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function createThread(userId: string, title: string): Promise<AssistantThread> {
  return db.assistantThread.create({ data: { userId, title: titleFrom(title) } });
}

export async function appendMessage(
  userId: string,
  threadId: string,
  input: {
    role: "user" | "assistant" | "tool" | "system";
    content: unknown[];
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
): Promise<AssistantMessage> {
  const thread = await db.assistantThread.findFirst({
    where: { id: threadId, userId },
    select: { id: true },
  });
  if (!thread) throw new Error("No such conversation.");

  const [message] = await db.$transaction([
    db.assistantMessage.create({
      data: {
        threadId,
        // Denormalised from the thread, and written from nowhere else.
        userId,
        role: input.role,
        content: input.content as object,
        model: input.model ?? "",
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheWriteTokens: input.cacheWriteTokens ?? 0,
      },
    }),
    db.assistantThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } }),
  ]);
  return message;
}

export async function renameThread(userId: string, id: string, title: string): Promise<void> {
  const { count } = await db.assistantThread.updateMany({
    where: { id, userId },
    data: { title: titleFrom(title) },
  });
  if (count === 0) throw new Error("No such conversation.");
}

export async function deleteThread(userId: string, id: string): Promise<void> {
  const { count } = await db.assistantThread.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No such conversation.");
}

/**
 * How many messages this person has sent since midnight IN THEIR OWN ZONE.
 *
 * Not the server's. A day belongs to the reader, and the stored zone is used
 * verbatim — no `|| "UTC"`, which the decision log records costing the digest
 * eight wrong hours a day.
 */
export async function messagesToday(userId: string, now = new Date()): Promise<number> {
  const zone = await timeZoneOf(userId);
  const dayStart = civilInstant(zone, civilDay(now, zone)) ?? new Date(now.getTime() - 86_400_000);
  // "user" alone. A tool result is stored as "tool" and the loop's own
  // out-of-budget nudge as "system": neither is something anybody sent, and
  // counting them made one question with five tool calls cost six of fifty.
  return db.assistantMessage.count({
    where: { userId, role: "user", createdAt: { gte: dayStart } },
  });
}

export async function assistantUsage(
  userId: string,
  since: Date,
): Promise<{ messages: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }> {
  const totals = await db.assistantMessage.aggregate({
    where: { userId, createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true },
  });
  return {
    messages: totals._count._all,
    inputTokens: totals._sum.inputTokens ?? 0,
    outputTokens: totals._sum.outputTokens ?? 0,
    cacheReadTokens: totals._sum.cacheReadTokens ?? 0,
  };
}

/**
 * Instance-wide totals, and the one function here with no leading userId.
 *
 * NOT AN EXCEPTION TO THE ISOLATION RULE, for the same reason users.ts,
 * system.ts and audit.ts are not: it counts rows and sums integers, returns no
 * content of any kind, and is only ever called from an adminOnly tool. An admin
 * manages accounts and what they cost; they never read anybody's conversation,
 * and there is deliberately no function here that would let them.
 */
export async function instanceAssistantUsage(
  since: Date,
): Promise<{ messages: number; inputTokens: number; outputTokens: number; people: number }> {
  const [totals, people] = await Promise.all([
    db.assistantMessage.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.assistantMessage.findMany({
      where: { createdAt: { gte: since } },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);
  return {
    messages: totals._count._all,
    inputTokens: totals._sum.inputTokens ?? 0,
    outputTokens: totals._sum.outputTokens ?? 0,
    people: people.length,
  };
}
