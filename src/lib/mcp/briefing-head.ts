import { listGuardrails } from "@/lib/data/me";

/**
 * The head of the briefing every client gets on connect: who you are connected
 * as, the person's standing rules, and the rules that are never optional.
 *
 * It lives here rather than in handler.ts so that two other readers can ask the
 * same question the handler answers — "which of my standing rules actually
 * reach a client?" — without importing the transport. `list_notes` reports it
 * per rule and the Notes screen shows it, and both have to agree with what the
 * briefing really sends, so there is one piece of arithmetic and three callers.
 * handler.ts explains why the head is budgeted at all.
 *
 * Takes a userId first like the data layer, because it reads one person's
 * notes and nothing else.
 */

/** Claude Code cuts a server's instructions at 2KB. The head has to survive that. */
export const HEAD_BUDGET = 2000;

/**
 * The four rules whose absence produces a wrong document or an act nobody can
 * undo. Everything else is in the tail.
 */
export const CRITICAL_RULES = `
Rules that are never optional:
- Never invent experience, employers, dates or metrics. Everything on a resume must trace back to
  something in Me. If evidence is missing, say so and ask.
- update_resume and update_role REPLACE what you send. Read first, modify, then write back whole.
  When they tell you something new about a job already on file, append_role_background adds
  instead of overwriting.
- Four acts cannot be undone: delete_archived and empty_archive destroy what is in the archive,
  merge_companies folds one employer into another for good, and admin_delete_user removes an
  account and everything it owns. Say what will go and get a plain yes before any of them.
  Deleting a role, highlight, note, resume, letter, offer, task, tag, saved view or checklist
line is also permanent.
- Connection URLs are credentials with full read and write over this workspace. Never repeat one
  anywhere it will be stored.`;

export function identityFor(user: { name: string | null; email: string }) {
  return `Hired is ${user.name || user.email}'s career knowledge base, resume builder and job-search CRM.
You are connected as them; every tool reads and writes only their data. search_me is the first
tool to reach for when the question is about their experience.`;
}

/**
 * What is left for standing rules once the fixed halves are measured.
 *
 * Derived rather than a constant: a constant drifted the moment CRITICAL_RULES
 * grew by a sentence — the head was 992 characters, then 1,131, and an account
 * with seventeen rules on file went 24 over the cap without anything in the
 * diff looking like it touched the budget. The name is in there too, and a long
 * one costs its own rules room, which is the right way round.
 */
export function rulesAllowance(user: { name: string | null; email: string }) {
  return HEAD_BUDGET - identityFor(user).length - CRITICAL_RULES.length - 1;
}

const RULES_HEADING = `\n\nTHEIR STANDING RULES — these override any inference you would otherwise make. They are not
preferences. Breaking one produces a document that reads as true and is not.`;

/**
 * Reserved whether or not anything is dropped, and sized against the largest
 * number that could be, so the section fits its budget in every case rather
 * than only in the ones where nothing overflows.
 */
const overflowNotice = (n: number) =>
  `\n• (${n} more rules are on file and are NOT in this briefing — call list_notes with kind ` +
  `GUARDRAIL and read them before writing anything.)`;

type Rule = { id: string; title: string; body: string };

/** How one rule is written into the briefing. */
export function ruleLine(rule: Pick<Rule, "title" | "body">) {
  return `\n• ${rule.title}${rule.body.trim() ? ` — ${rule.body.trim()}` : ""}`;
}

/**
 * Which rules fit, in order, and the text they make. Pure.
 *
 * First come, first kept: a rule that does not fit is skipped and the next one
 * is still tried, so one very long rule costs only itself rather than every
 * rule filed after it.
 */
export function fitRules(rules: Rule[], allowance: number) {
  if (rules.length === 0) return { text: "", kept: [] as string[], dropped: [] as string[], budget: 0, used: 0 };
  const budget = allowance - RULES_HEADING.length - overflowNotice(rules.length).length;

  const lines: string[] = [];
  const kept: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const rule of rules) {
    const line = ruleLine(rule);
    if (used + line.length > budget) {
      dropped.push(rule.id);
      continue;
    }
    lines.push(line);
    kept.push(rule.id);
    used += line.length;
  }
  if (dropped.length > 0) lines.push(overflowNotice(dropped.length));
  return { text: `${RULES_HEADING}${lines.join("")}`, kept, dropped, budget, used };
}

/**
 * The person's own rules, and the reason they are the first thing in the block.
 *
 * "Never invent experience, employers, dates or metrics" does not catch the
 * failure that actually happens. Tailoring to a job req quietly *upgrades*
 * facts — a distribution credit becomes a hire, an unsettled follower count
 * becomes a cited one — and none of it feels like invention to whoever is
 * drafting, because every upgrade maps to a stated responsibility.
 *
 * Guardrails are Note rows, so they could in principle be found with search_me.
 * In practice nobody searches "follower count" before writing a scope bullet,
 * so a rule that has to be looked up is a rule that is absent at the moment it
 * matters. This block is the only place a constraint is guaranteed to be in
 * context — which is exactly why it has to survive a 2KB cut.
 */
export async function standingRulesFor(userId: string, allowance: number) {
  const guardrails = await listGuardrails(userId).catch(() => []);
  const fit = fitRules(guardrails, allowance);
  if (fit.dropped.length > 0) {
    // Silently truncating someone's guardrails is the worst failure available
    // here, so it is at least visible in the server log and admitted in the
    // briefing itself.
    console.warn(
      `[mcp] standing rules truncated for user ${userId}: ${fit.dropped.length} of ${guardrails.length} omitted past ${fit.budget} chars`,
    );
  }
  return fit.text;
}

/**
 * For a person looking at their rules: which of them every client actually
 * receives, and how much room is left.
 *
 * `inBriefing: false` does not mean the rule is ignored — the briefing tells
 * the client that more rules exist and to fetch them — but it does mean the
 * rule depends on a client doing as it is told, rather than being in front of
 * it from the first message. That is the difference worth showing.
 */
export async function standingRulesFit(
  userId: string,
  user: { name: string | null; email: string },
) {
  const guardrails = await listGuardrails(userId);
  const fit = fitRules(guardrails, rulesAllowance(user));
  const kept = new Set(fit.kept);
  return {
    budget: Math.max(fit.budget, 0),
    used: fit.used,
    rules: guardrails.map((rule) => ({
      id: rule.id,
      chars: ruleLine(rule).length,
      inBriefing: kept.has(rule.id),
    })),
  };
}
