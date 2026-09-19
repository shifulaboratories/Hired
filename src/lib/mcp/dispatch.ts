import { recordWrite } from "@/lib/data/revision-store";
import { isAdmin } from "@/lib/auth";
import { outOfScope, toolsByName, type McpContext, type McpTool } from "@/lib/mcp/tools";

/**
 * The one door every tool call goes through.
 *
 * This exists because there is now more than one caller. The MCP transport was
 * the only one for a long time, and every check that mattered — the admin
 * refusal, the change log — lived inside `handleMessage`'s `tools/call` case.
 * A second caller of the same handlers is a second place for those checks to be
 * forgotten, and the one that gets forgotten is the one nobody notices until it
 * matters.
 *
 * So: admin check, scope check, the tool, then the change log. In that order,
 * in one function, and `handler.ts` wraps what comes back in the protocol's
 * shapes rather than deciding anything.
 *
 * It returns a refusal rather than throwing one. A refusal is something the
 * model should read and act on ("that tool isn't served on this connection,
 * here is how your person widens it"), and an exception is something that went
 * wrong — conflating them makes both harder to handle.
 */
export type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; message: string };

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<DispatchResult> {
  const tool: McpTool | undefined = toolsByName.get(name);
  if (!tool) return { ok: false, message: `Unknown tool: ${name}` };

  if (tool.adminOnly && !isAdmin(ctx.user)) {
    return { ok: false, message: "that tool is only available to admins." };
  }

  const refusal = outOfScope(name, ctx.user, ctx.scope);
  if (refusal) return { ok: false, message: refusal };

  const result = await tool.handler(args, ctx);

  // The change log, written in ONE place for every tool that is not read-only.
  // Driven off `annotations.readOnlyHint`, which every tool already declares,
  // so a tool added next year is logged without anybody remembering to log it —
  // which is the whole reason it is here and not at two hundred call sites in
  // the data layer.
  //
  // Awaited, so a reply cannot outrun the row it describes, but never fatal:
  // recordWrite swallows its own failures rather than turning a successful tool
  // call into an error the model sees.
  if (tool.annotations.readOnlyHint !== true) {
    await recordWrite({
      userId: ctx.userId,
      connectionId: ctx.connectionId,
      connectionName: ctx.connectionName,
      tool: name,
      summary: tool.title,
      recordId: subjectIdIn(args),
    });
  }

  return { ok: true, result };
}

/**
 * The id a call was about, for the change log, guessed from the arguments.
 *
 * Every tool here that touches one record names it `id`, or `<noun>_id` for the
 * ones that take two. That covers the writes worth logging an id for; anything
 * bulk, or anything that created something, logs an empty id and stays a line
 * for the eye rather than an undo point.
 *
 * Deliberately NOT a per-tool map. A map would be a second place to remember a
 * tool exists, which is exactly what driving this off the read-only hint avoids.
 */
export function subjectIdIn(args: Record<string, unknown>): string {
  for (const key of [
    "id",
    "resume_id",
    "role_id",
    "application_id",
    "interview_id",
    "contact_id",
    "company_id",
  ]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
