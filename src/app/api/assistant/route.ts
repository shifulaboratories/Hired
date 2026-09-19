import { getCurrentUser } from "@/lib/auth";
import { baseUrlFrom } from "@/lib/request-url";
import { getSettings, assistantIsConfigured } from "@/lib/settings";
import { runAssistantTurn, type AssistantEvent } from "@/lib/assistant/run";
import { messagesToday } from "@/lib/data/assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A tool loop with twelve steps in it is not a two-second request.
export const maxDuration = 300;

/**
 * The built-in assistant's one address.
 *
 * POST only, and the answer streams back as SSE — the same hand-rolled
 * ReadableStream the MCP transport uses, for the same reason: Next route
 * handlers speak the Web Request/Response API and there is nothing to install.
 *
 * The caller is resolved from their session cookie with getCurrentUser() rather
 * than requireUser(), which REDIRECTS. A redirect inside a fetch that expects
 * an event stream is a broken stream rather than a 401, and the drawer would
 * show a parse error instead of "sign in again".
 *
 * Four answers, and only the last one is a stream:
 *   no session  -> 401 JSON
 *   no API key  -> 503 JSON naming where an admin adds one
 *   over the cap-> 429 JSON naming the cap
 *   otherwise   -> 200 text/event-stream
 * The first three are JSON on purpose: they are about the request, not about
 * the conversation, and the drawer shows them without opening a thread.
 */

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Sign in again — your session has expired." }, 401);

  const settings = await getSettings();
  if (!assistantIsConfigured(settings)) {
    return json(
      {
        error:
          "The built-in assistant is not configured. An admin adds a key under Settings → Admin → Configuration → Assistant. Connecting Claude or another MCP client works without one.",
      },
      503,
    );
  }

  let body: {
    message?: unknown;
    threadId?: unknown;
    page?: unknown;
    approve?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "That was not JSON." }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const answer =
    body.approve && typeof body.approve === "object" && body.approve !== null
      ? (body.approve as { toolUseId?: unknown; decline?: unknown })
      : null;
  const approve =
    answer && typeof answer.toolUseId === "string"
      ? { toolUseId: answer.toolUseId, decline: answer.decline === true }
      : undefined;
  if (!message && !approve) return json({ error: "Nothing to send." }, 400);

  // Checked here as well as inside the run, because a refusal the person can
  // read beats a stream that opens and immediately says no.
  //
  // NOT on an approval. Hitting the cap between asking and pressing the button
  // would otherwise strand an irreversible act somebody has already agreed to,
  // with no way to finish it and no way to take it back — and approving sends
  // no new message, so it costs nothing against a cap counted in messages.
  const cap = settings.assistantDailyMessages;
  if (cap > 0 && !approve) {
    const today = await messagesToday(user.id);
    if (today >= cap) {
      return json(
        {
          error: `That is ${today} of ${cap} messages today. The count starts again at midnight where you are.`,
        },
        429,
      );
    }
  }

  const turn = runAssistantTurn({
    user,
    threadId: typeof body.threadId === "string" && body.threadId ? body.threadId : null,
    message,
    page: typeof body.page === "string" ? body.page.slice(0, 200) : undefined,
    baseUrl: baseUrlFrom(request.headers, request.url),
    approve,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AssistantEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of turn) send(event);
      } catch (error) {
        // Anything the generator did not catch. The person gets a sentence
        // rather than a stream that stops for no stated reason.
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // They closed the drawer or navigated away. Returning from the generator
      // is what stops the loop; the turn so far is already on file, because
      // every message is persisted as it is produced rather than at the end.
      void turn.return(undefined as never);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer event streams into uselessness otherwise.
      "X-Accel-Buffering": "no",
    },
  });
}
