import type { McpScope } from "@prisma/client";
import { db } from "@/lib/db";
import { generateMcpToken } from "@/lib/auth";
import { clientsById } from "@/lib/mcp/clients";

/**
 * MCP connections. Like everything in this directory, every function takes the
 * owning userId first and every query filters on it, so a caller cannot reach
 * somebody else's connections even by accident.
 */

const MAX_PER_USER = 20;

function cleanName(name: string, fallback: string) {
  const trimmed = name.trim().slice(0, 60);
  return trimmed || fallback;
}

export async function listConnections(userId: string) {
  return db.mcpConnection.findMany({
    where: { userId },
    orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

export async function createConnection(
  userId: string,
  input: { name?: string; client?: string; scope?: McpScope } = {},
) {
  const count = await db.mcpConnection.count({ where: { userId } });
  if (count >= MAX_PER_USER) {
    throw new Error(`You already have ${MAX_PER_USER} connections. Delete one first.`);
  }

  const client = input.client && clientsById.has(input.client) ? input.client : "other";
  return db.mcpConnection.create({
    data: {
      userId,
      name: cleanName(input.name ?? "", clientsById.get(client)?.name ?? "New connection"),
      client,
      scope: input.scope ?? "FULL",
      token: generateMcpToken(),
    },
  });
}

/**
 * Narrow or widen what one connection is served.
 *
 * Not a permission: the token still resolves to the whole account, and this
 * only changes which tools the client is offered. It takes effect on that
 * client's next call, because the transport re-reads the row every time.
 */
export async function setConnectionScope(userId: string, id: string, scope: McpScope) {
  const { count } = await db.mcpConnection.updateMany({ where: { id, userId }, data: { scope } });
  if (count === 0) throw new Error("No connection with that id.");
}

export async function renameConnection(userId: string, id: string, name: string) {
  const { count } = await db.mcpConnection.updateMany({
    where: { id, userId },
    data: { name: cleanName(name, "Connection") },
  });
  if (count === 0) throw new Error("No connection with that id.");
}

/**
 * New token on the same row, so the client keeps its name and place in the list
 * but the old URL stops working immediately.
 */
export async function rotateConnection(userId: string, id: string) {
  const token = generateMcpToken();
  const { count } = await db.mcpConnection.updateMany({
    where: { id, userId },
    data: { token, lastUsedAt: null, lastUsedFrom: "" },
  });
  if (count === 0) throw new Error("No connection with that id.");
  return token;
}

export async function deleteConnection(userId: string, id: string) {
  const { count } = await db.mcpConnection.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No connection with that id.");
}
