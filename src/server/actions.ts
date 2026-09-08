"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ActivityType, NoteKind, Stage, TagKind, UserRole } from "@prisma/client";
import * as me from "@/lib/data/me";
import * as resumes from "@/lib/data/resumes";
import * as pipeline from "@/lib/data/pipeline";
import * as tags from "@/lib/data/tags";
import { STAGE_LABEL } from "@/lib/data/pipeline";
import * as views from "@/lib/data/views";
import * as pipelineShare from "@/lib/data/pipeline-share";
import * as users from "@/lib/data/users";
import * as waitlist from "@/lib/data/waitlist";
import * as connections from "@/lib/data/connections";
import * as accounts from "@/lib/data/accounts";
import * as onboarding from "@/lib/data/onboarding";
import {
  authenticate,
  claimInstance,
  endSession,
  instanceNeedsSetup,
  requireAdmin,
  requireUser,
  setupKeyMatches,
  startSession,
} from "@/lib/auth";
import { deleteVariable, getSettings, setVariables } from "@/lib/settings";
import { unlinkGoogleFromUser } from "@/lib/google";
import { renderEmailTemplate, sendEmail } from "@/lib/email";
import { syncAllBilling } from "@/lib/billing";
import { loadPosting } from "@/lib/posting";
import { dateRange } from "@/lib/utils";
import {
  checkLoginAllowed,
  clearLoginFailures,
  clientIp,
  recordLoginFailure,
  sweepThrottles,
} from "@/lib/login-throttle";
import { listAudit, recordAudit } from "@/lib/data/audit";
import { recordSystemEvent, sweepSystemEvents } from "@/lib/data/system";
import * as archive from "@/lib/data/archive";
import type { PipelineView } from "@/lib/pipeline-fields";
import type { ColumnList } from "@/lib/column-widths";
import { sweepArchive } from "@/lib/data/archive";

/**
 * Every action resolves the caller from their session cookie. No action ever
 * accepts a userId from the client, so a crafted request cannot act as somebody
 * else no matter what it sends.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function setupAction(_prev: { error?: string } | undefined, formData: FormData) {
  if (!(await instanceNeedsSetup())) return { error: "This instance has already been set up." };

  const setupKey = String(formData.get("setupKey") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!setupKeyMatches(setupKey)) return { error: "That setup key doesn't match APP_PASSWORD." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 10) return { error: "Use a password of at least 10 characters." };

  const user = await claimInstance({ email, name, password });
  await startSession(user.id);
  redirect("/");
}

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ip = clientIp(await headers());

  // Checked before the password is even looked at, so a locked account costs an
  // attacker a database read rather than a scrypt verification.
  const verdict = await checkLoginAllowed(email, ip);
  if (!verdict.allowed) {
    const minutes = Math.ceil(verdict.retryAfterSeconds / 60);
    return {
      error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const user = await authenticate(email, password);
  if (!user) {
    await recordLoginFailure(email, ip);
    // The same sentence whether the address exists, the password is wrong or
    // the account is suspended. Three different messages is a tool for
    // discovering which addresses are real.
    return { error: "That email and password don't match." };
  }

  await clearLoginFailures(email, ip);
  // Absent means the box was unticked: a few hours, and gone when the browser
  // closes. The checkbox ships ticked, so the default stays a month.
  await startSession(user.id, { remember: formData.get("remember") !== null });
  // Cheap, and it keeps the tables from growing on a busy instance. Deliberately
  // not awaited-and-blocking on failure: a failed sweep must not fail a login.
  void sweepThrottles().catch(() => {});
  void sweepSystemEvents().catch(() => {});
  void sweepArchive().catch(() => {});
  redirect("/");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function acceptInviteAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
) {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "Use a password of at least 10 characters." };

  try {
    const user = await users.acceptInvite({ token, name, password });
    await startSession(user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not accept that invitation." };
  }
  redirect("/");
}

export async function changeOwnPasswordAction(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData,
) {
  const user = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  if (next.length < 10) return { error: "Use a password of at least 10 characters." };
  if (!(await authenticate(user.email, current))) return { error: "Your current password is wrong." };

  await users.changePassword(user.id, next);
  await startSession(user.id); // keep this device signed in
  return { ok: true };
}

export async function updateOwnAccountAction(patch: { name?: string; email?: string }) {
  const user = await requireUser();
  await users.updateOwnAccount(user.id, patch);
  revalidatePath("/settings");
}

// ---------------------------------------------------------------------------
// Sharing a resume
// ---------------------------------------------------------------------------

async function currentBaseUrl() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function publishResumeAction(id: string) {
  const user = await requireUser();
  const resume = await resumes.publishResume(user.id, id);
  revalidatePath(`/resumes/${id}`);
  revalidatePath("/me");
  return { url: `${await currentBaseUrl()}/r/${resume.slug}` };
}

export async function unpublishResumeAction(id: string) {
  const user = await requireUser();
  await resumes.unpublishResume(user.id, id);
  revalidatePath(`/resumes/${id}`);
  revalidatePath("/me");
}

// ---------------------------------------------------------------------------
// MCP connections
// ---------------------------------------------------------------------------

export async function createConnectionAction(input: { name?: string; client?: string }) {
  const user = await requireUser();
  const connection = await connections.createConnection(user.id, input);
  revalidatePath("/settings");
  return { id: connection.id, token: connection.token };
}

export async function renameConnectionAction(id: string, name: string) {
  const user = await requireUser();
  await connections.renameConnection(user.id, id, name);
  revalidatePath("/settings");
}

export async function rotateConnectionAction(id: string) {
  const user = await requireUser();
  const token = await connections.rotateConnection(user.id, id);
  revalidatePath("/settings");
  return token;
}

export async function deleteConnectionAction(id: string) {
  const user = await requireUser();
  await connections.deleteConnection(user.id, id);
  revalidatePath("/settings");
}

/**
 * Calls our own MCP endpoint the way a client would, over real HTTP, and
 * reports what came back. Proves the whole path — routing, host headers, token
 * lookup — rather than just asserting the token exists in the database.
 */
export async function testConnectionAction(id: string) {
  const user = await requireUser();
  const all = await connections.listConnections(user.id);
  const connection = all.find((item) => item.id === id);
  if (!connection) return { ok: false as const, error: "No connection with that id." };

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  try {
    const response = await fetch(`${proto}://${host}/api/mcp/${connection.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "hired-selftest" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false as const, error: `Server answered ${response.status}.` };
    }
    const payload = (await response.json()) as { result?: { tools?: unknown[] } };
    const toolCount = payload.result?.tools?.length ?? 0;
    if (!toolCount) return { ok: false as const, error: "Connected, but no tools came back." };
    return { ok: true as const, toolCount };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not reach the endpoint.",
    };
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function inviteUserAction(input: { email: string; role: UserRole }) {
  const actor = await requireAdmin();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  try {
    const result = await users.createInvite({
      actor,
      email: input.email,
      role: input.role,
      baseUrl: `${proto}://${host}`,
    });
    revalidatePath("/settings/admin");
    return {
      ok: true as const,
      acceptUrl: result.acceptUrl,
      emailSent: result.emailSent,
      emailError: result.emailError,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not invite." };
  }
}

export async function revokeInviteAction(id: string) {
  const actor = await requireAdmin();
  await users.revokeInvite(actor, id);
  revalidatePath("/settings/admin");
}

/**
 * Invite someone off the waitlist. Same shape as inviteUserAction because it
 * is the same job with the address already chosen — the request row supplies
 * the email, so this can't be used to invite an arbitrary person.
 */
export async function inviteFromWaitlistAction(input: { id: string; role: UserRole }) {
  const actor = await requireAdmin();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  try {
    const result = await waitlist.inviteFromWaitlist({
      actor,
      id: input.id,
      role: input.role,
      baseUrl: `${proto}://${host}`,
    });
    revalidatePath("/settings/admin");
    return {
      ok: true as const,
      acceptUrl: result.acceptUrl,
      emailSent: result.emailSent,
      emailError: result.emailError,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not invite." };
  }
}

export async function removeWaitlistSignupAction(id: string) {
  await requireAdmin();
  await waitlist.removeWaitlistSignup(id);
  revalidatePath("/settings/admin");
}

export async function setUserRoleAction(userId: string, role: UserRole) {
  const actor = await requireAdmin();
  try {
    await users.setUserRole(actor, userId, role);
    revalidatePath("/settings/admin");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update." };
  }
}

export async function setUserActiveAction(userId: string, isActive: boolean) {
  const actor = await requireAdmin();
  try {
    await users.setUserActive(actor, userId, isActive);
    revalidatePath("/settings/admin");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update." };
  }
}

/**
 * Reset a member's password to a generated one and hand it back once.
 *
 * The password is returned to the admin who asked rather than emailed, because
 * on a self-hosted instance email may not be configured at all — and an admin
 * reading it off the screen to a customer they are already on a call with is
 * the actual support flow.
 */
export async function adminResetPasswordAction(userId: string) {
  const actor = await requireAdmin();
  try {
    const result = await users.adminResetPassword(actor, userId);
    revalidatePath("/settings/admin");
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not reset." };
  }
}

export async function listAuditAction(limit = 100) {
  await requireAdmin();
  const rows = await listAudit({ limit });
  return rows.map((row) => ({
    id: row.id,
    actorEmail: row.actorEmail,
    action: row.action,
    targetEmail: row.targetEmail,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function deleteUserAction(userId: string) {
  const actor = await requireAdmin();
  try {
    await users.deleteUser(actor, userId);
    revalidatePath("/settings/admin");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not delete." };
  }
}

/**
 * Every settings write from the browser, by key. Configuration is one screen
 * of editable rows now rather than three typed forms, so this is the only
 * shape it needs — and an unknown key is created, which is how a setting
 * exists before it has a section of its own.
 */
/**
 * Detach Google from your own account. Linking is a redirect through Google
 * (see /api/auth/google?link=1), so only the undo needs an action.
 */
export async function unlinkGoogleAction() {
  const user = await requireUser();
  const result = await unlinkGoogleFromUser(user.id);
  revalidatePath("/settings");
  return result;
}

// ---------------------------------------------------------------------------
// Mail and calendar accounts
// ---------------------------------------------------------------------------

/**
 * Google and Microsoft connect by a redirect through their consent screens
 * (/api/auth/google?data=1, /api/auth/microsoft), not an action. IMAP is a
 * form, so it is one. Disconnecting revokes where the provider allows it and
 * deletes the row.
 */
export async function connectImapAccountAction(input: accounts.ImapConnectInput) {
  const user = await requireUser();
  try {
    const account = await accounts.connectImapAccount(user.id, input);
    revalidatePath("/settings");
    return { ok: true as const, account: serialiseAccount(account) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function testAccountAction(accountId: string) {
  const user = await requireUser();
  try {
    const result = await accounts.testAccount(user.id, accountId);
    revalidatePath("/settings");
    return { ok: true as const, mail: result.mail, calendar: result.calendar };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function renameAccountAction(accountId: string, label: string) {
  const user = await requireUser();
  await accounts.renameLinkedAccount(user.id, accountId, label);
  revalidatePath("/settings");
}

export async function disconnectAccountAction(accountId: string) {
  const user = await requireUser();
  await accounts.disconnectAccount(user.id, accountId);
  revalidatePath("/settings");
  return { ok: true as const };
}

function serialiseAccount(account: accounts.LinkedAccountView) {
  return {
    ...account,
    connectedAt: account.connectedAt.toISOString(),
    lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
    lastErrorAt: account.lastErrorAt?.toISOString() ?? null,
  };
}

/**
 * The panels on a contact, company, application or resume. Fetched after
 * the page renders, because it is a round trip to Google and the page should
 * not wait on it. Dates go out as ISO strings so the client can format them.
 */
export async function correspondenceAction(
  subject: accounts.CorrespondenceSubject,
): Promise<
  | { ok: true; correspondence: ReturnType<typeof serialiseCorrespondence> }
  | { ok: false; error: string; notConnected: boolean }
> {
  const user = await requireUser();
  try {
    const result = await accounts.listCorrespondence(user.id, subject);
    return { ok: true, correspondence: serialiseCorrespondence(result) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      notConnected: error instanceof accounts.AccountNotConnectedError,
    };
  }
}

function serialiseCorrespondence(result: accounts.Correspondence) {
  return {
    subject: result.subject,
    terms: result.terms,
    notes: result.notes,
    warnings: result.warnings,
    mail:
      result.mail?.map((thread) => ({
        ...thread,
        firstMessageAt: thread.firstMessageAt.toISOString(),
        lastMessageAt: thread.lastMessageAt.toISOString(),
      })) ?? null,
    calendar:
      result.calendar?.map((event) => ({
        ...event,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
      })) ?? null,
  };
}

export async function emailThreadAction(threadId: string) {
  const user = await requireUser();
  try {
    const thread = await accounts.getEmailThread(user.id, threadId);
    return {
      ok: true as const,
      thread: {
        ...thread,
        messages: thread.messages.map((message) => ({ ...message, date: message.date.toISOString() })),
      },
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveVariablesAction(patch: Record<string, string>) {
  const actor = await requireAdmin();
  try {
    const changed = await setVariables(actor, patch);
    revalidateSettings();
    return { ok: true as const, changed };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not save." };
  }
}

/** Reset a declared variable to its default, or remove a custom one. */
export async function deleteVariableAction(key: string) {
  const actor = await requireAdmin();
  try {
    const result = await deleteVariable(actor, key);
    revalidateSettings();
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not clear." };
  }
}

/**
 * A settings change can reach anywhere — the instance name is on the sign-in
 * page, the logo switch is on every pipeline screen — so revalidate the whole
 * tree rather than guessing which routes read what.
 */
function revalidateSettings() {
  revalidatePath("/", "layout");
}

/**
 * Fetch a posting URL and hand back what the page says, for the new-application
 * dialog to prefill. Deliberately creates nothing: in the UI a person reviews
 * the fields before tracking the job, so the parse and the create stay
 * separate. (The capture_job_posting tool is the one-move version for
 * assistants.)
 */
export async function parsePostingAction(url: string) {
  await requireUser();
  try {
    return { ok: true as const, parsed: await loadPosting(url) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not fetch that." };
  }
}

export async function syncBillingAction(email?: string) {
  await requireAdmin();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  try {
    const results = await syncAllBilling(`${proto}://${host}`, email?.trim() || undefined);
    revalidatePath("/settings/admin");
    return { ok: true as const, results };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Sync failed." };
  }
}

export async function sendTestEmailAction(to?: string, template?: string) {
  const actor = await requireAdmin();
  const settings = await getSettings();
  const result = await sendEmail({
    to: to?.trim() || actor.email,
    ...renderEmailTemplate(template, settings),
    settings,
  });
  return result.ok
    ? { ok: true as const, to: to?.trim() || actor.email }
    : { ok: false as const, error: result.error };
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

export async function saveProfileAction(patch: me.ProfilePatch) {
  const user = await requireUser();
  await me.updateProfile(user.id, patch);
  revalidatePath("/me");
  revalidatePath("/");
}

/**
 * Set the calendar this person's dates are read against, or clear it back to
 * the server's own with an empty string.
 *
 * `seeded` marks the browser filling it in for somebody who has never set one,
 * which must not overwrite a zone a person actually chose — the effect that
 * calls it runs on a machine that may be in a different place from the one
 * they are searching for work in.
 */
export async function setTimeZoneAction(timeZone: string, options?: { seeded?: boolean }) {
  const user = await requireUser();
  if (options?.seeded && (await me.timeZoneOf(user.id))) return { timeZone: "", skipped: true };
  const result = await me.setTimeZone(user.id, timeZone);
  // Every screen shows a date, so every screen is stale.
  revalidatePath("/", "layout");
  return { ...result, skipped: false };
}

/**
 * Store a headshot, or clear it with an empty string.
 *
 * The browser has already cropped and downscaled by the time this runs, so what
 * arrives is a small data URI; the size and type rules still live in the data
 * layer, because `set_profile_photo` posts here through the same function and
 * neither door should be the lenient one.
 */
export async function setProfilePhotoAction(input: string) {
  const user = await requireUser();
  const result = await me.setProfilePhoto(user.id, input);
  revalidatePath("/settings");
  revalidatePath("/me");
  revalidatePath("/me");
  revalidatePath("/");
  return result;
}

export async function createRoleAction(input: me.RoleInput) {
  const user = await requireUser();
  const role = await me.createRole(user.id, input);
  revalidatePath("/me");
  return role.id;
}

export async function updateRoleAction(id: string, patch: Partial<me.RoleInput>) {
  const user = await requireUser();
  await me.updateRole(user.id, id, patch);
  revalidatePath("/me");
  revalidatePath(`/me/${id}`);
}

export async function deleteRoleAction(id: string) {
  const user = await requireUser();
  await me.deleteRole(user.id, id);
  revalidatePath("/me");
  redirect("/me");
}

export async function createHighlightAction(input: me.HighlightInput) {
  const user = await requireUser();
  const highlight = await me.createHighlight(user.id, input);
  revalidatePath("/me");
  if (input.roleId) revalidatePath(`/me/${input.roleId}`);
  return highlight;
}

export async function updateHighlightAction(
  id: string,
  patch: Partial<me.HighlightInput> & { archived?: boolean },
) {
  const user = await requireUser();
  await me.updateHighlight(user.id, id, patch);
  revalidatePath("/me");
}

export async function deleteHighlightAction(id: string) {
  const user = await requireUser();
  await me.deleteHighlight(user.id, id);
  revalidatePath("/me");
}

export async function createNoteAction(input: { title: string; body?: string; tags?: string[] }) {
  const user = await requireUser();
  const note = await me.createNote(user.id, input);
  revalidatePath("/me");
  return note.id;
}

export async function updateNoteAction(
  id: string,
  patch: Partial<{ title: string; body: string; tags: string[]; pinned: boolean; kind: NoteKind }>,
) {
  const user = await requireUser();
  await me.updateNote(user.id, id, patch);
  revalidatePath("/me");
}

export async function deleteNoteAction(id: string) {
  const user = await requireUser();
  await me.deleteNote(user.id, id);
  revalidatePath("/me");
}

export async function createEducationAction(input: { school: string }) {
  const user = await requireUser();
  await me.createEducation(user.id, input);
  revalidatePath("/me");
}

export async function updateEducationAction(id: string, patch: Record<string, unknown>) {
  const user = await requireUser();
  await me.updateEducation(user.id, id, patch);
  revalidatePath("/me");
}

export async function deleteEducationAction(id: string) {
  const user = await requireUser();
  await me.deleteEducation(user.id, id);
  revalidatePath("/me");
}

export async function createProjectAction(input: { name: string }) {
  const user = await requireUser();
  await me.createProject(user.id, input);
  revalidatePath("/me");
}

export async function updateProjectAction(id: string, patch: Record<string, unknown>) {
  const user = await requireUser();
  await me.updateProject(user.id, id, patch);
  revalidatePath("/me");
}

export async function deleteProjectAction(id: string) {
  const user = await requireUser();
  await me.deleteProject(user.id, id);
  revalidatePath("/me");
}

export async function createSkillGroupAction(input: { name: string; skills?: string[] }) {
  const user = await requireUser();
  await me.createSkillGroup(user.id, input);
  revalidatePath("/me");
}

export async function updateSkillGroupAction(id: string, patch: { name?: string; skills?: string[] }) {
  const user = await requireUser();
  await me.updateSkillGroup(user.id, id, patch);
  revalidatePath("/me");
}

export async function deleteSkillGroupAction(id: string) {
  const user = await requireUser();
  await me.deleteSkillGroup(user.id, id);
  revalidatePath("/me");
}

export async function createCertificationAction(input: {
  name: string;
  issuer?: string;
  date?: string;
  url?: string;
}) {
  const user = await requireUser();
  await me.createCertification(user.id, input);
  revalidatePath("/me");
}

export async function deleteCertificationAction(id: string) {
  const user = await requireUser();
  await me.deleteCertification(user.id, id);
  revalidatePath("/me");
}

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

export async function createResumeAction(input: resumes.ResumeMeta & { seedFromMe?: boolean }) {
  const user = await requireUser();
  const resume = await resumes.createResume(user.id, input);
  revalidatePath("/me");
  return resume.id;
}

export async function updateResumeAction(id: string, patch: resumes.ResumeMeta & { data?: unknown }) {
  const user = await requireUser();
  await resumes.updateResume(user.id, id, patch);
  revalidatePath("/me");
  revalidatePath(`/resumes/${id}`);
}

/**
 * Everything the command palette can jump to or act on.
 *
 * Fetched when the palette opens rather than shipped with every page. It used
 * to be assembled in src/app/(app)/layout.tsx, which meant three content
 * queries on every single navigation — and, worse, three hand-written
 * `where: { userId }` clauses outside src/lib/data/, the one place in the app
 * that bypassed the compile-time tenant guarantee.
 */
export async function paletteIndexAction() {
  const user = await requireUser();
  const [roles, resumeList, applications, companies, contacts] = await Promise.all([
    me.listRoles(user.id),
    resumes.listResumes(user.id),
    // includeClosed, because the layout's version had no stage filter and
    // "what did that rejected Stripe role pay" is a thing people look up.
    pipeline.listApplications(user.id, { includeClosed: true }),
    pipeline.listCompanies(user.id),
    pipeline.listContacts(user.id),
  ]);
  return {
    roles: roles.slice(0, 40).map((role) => ({
      id: role.id,
      label: `${role.title} · ${role.company}`,
      sub: dateRange(role.startDate, role.endDate, role.isCurrent),
    })),
    resumes: resumeList.slice(0, 40).map((resume) => ({
      id: resume.id,
      label: resume.name,
      sub: resume.targetCompany || resume.targetRole || "",
    })),
    applications: [...applications]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 60)
      .map((application) => ({
        id: application.id,
        label: `${application.company.name} · ${application.roleTitle}`,
        // STAGE_LABEL, not stage.toLowerCase(): the palette was the one
        // surface that said "screen" where everything else says "Screening".
        sub: STAGE_LABEL[application.stage],
        stage: application.stage,
        company: application.company.name,
        roleTitle: application.roleTitle,
        jobUrl: application.jobUrl,
      })),
    companies: companies.slice(0, 60).map((company) => ({
      id: company.id,
      label: company.name,
      // Industry and location are tags now, so the subtitle reads whichever
      // of them the company actually wears rather than two named columns.
      sub: company.tags
        .filter((tag) => tag.kind === "INDUSTRY" || tag.kind === "LOCATION")
        .map((tag) => tag.name)
        .slice(0, 2)
        .join(" · "),
    })),
    contacts: contacts.slice(0, 60).map((contact) => ({
      id: contact.id,
      label: contact.name,
      sub: [contact.title, contact.companies[0]?.name].filter(Boolean).join(" · "),
    })),
  };
}

/**
 * Bring a career in from a pasted document.
 *
 * The draft arrives from the browser because the parse happens there: it is
 * pure, and the person corrects it on screen before anything is written. The
 * filing itself is importResume — the same call an assistant makes — so the
 * two doors cannot drift.
 *
 * The raw text is filed as a note here rather than inside importResume: the
 * assistant reading a document keeps its own copy of what it read, and this is
 * the browser path making sure the paste is not the only place it existed.
 */
export async function importResumeAction(draft: me.ResumeImport, sourceText?: string) {
  const user = await requireUser();
  const report = await me.importResume(user.id, draft);
  const raw = sourceText?.trim();
  if (raw) {
    const existing = await me.listNotes(user.id);
    if (!existing.some((note) => note.body.trim() === raw)) {
      await me.createNote(user.id, {
        title: `Imported resume — ${new Date().toISOString().slice(0, 10)}`,
        body: raw,
        tags: ["imported"],
      });
    }
  }
  revalidatePath("/me");
  revalidatePath("/");
  return report;
}

/**
 * What backs each claim in a document, and where the document went.
 *
 * Read on demand rather than with the page: the editor flushes its autosave
 * before asking, because evidence for a document you are still typing is
 * evidence for a document that does not exist yet. The diff is not here — the
 * compare-to-base view computes that live in the browser.
 */
export async function resumeEvidenceAction(id: string) {
  const user = await requireUser();
  return resumes.traceResumeEvidence(user.id, id);
}

/**
 * The button on an application: a copy of the base, named for this job and
 * attached to it, with the editor open on the other side.
 */
export async function tailorResumeForApplicationAction(applicationId: string) {
  const user = await requireUser();
  const result = await resumes.createResumeForApplication(user.id, applicationId);
  revalidatePath("/me");
  revalidatePath("/applications");
  revalidatePath(`/applications/${applicationId}`);
  return {
    id: result.resume.id,
    name: result.resume.name,
    basedOn: result.basedOn?.name ?? null,
    seededFromMe: result.seededFromMe,
  };
}

export async function setResumeBaseAction(id: string, baseId: string | null) {
  const user = await requireUser();
  await resumes.setResumeBase(user.id, id, baseId);
  revalidatePath("/me");
  revalidatePath(`/resumes/${id}`);
}

export async function deleteResumeAction(id: string, redirectAfter = true) {
  const user = await requireUser();
  await resumes.deleteResume(user.id, id);
  revalidatePath("/me");
  // The editor needs somewhere to go after its document is gone; the grid is
  // already standing where it wants to be, search and sort included.
  if (redirectAfter) redirect("/me?tab=resumes");
}

export async function duplicateResumeAction(id: string, name?: string) {
  const user = await requireUser();
  const copy = await resumes.duplicateResume(user.id, id, name);
  revalidatePath("/me");
  return copy.id;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

// --- tags -------------------------------------------------------------------

/**
 * The four screens a tag can show on. A tag is a label, and a label the person
 * just renamed should not still read the old way on the page they came from.
 */
function revalidateTags() {
  revalidatePath("/");
  revalidatePath("/applications");
  revalidatePath("/crm/companies");
  revalidatePath("/crm/contacts");
}

const asOption = (tag: {
  id: string;
  name: string;
  color: string;
  kind: TagKind;
  _count: { applications: number; companies: number; contacts: number };
}) => ({
  id: tag.id,
  name: tag.name,
  color: tag.color,
  kind: tag.kind,
  count: tag._count.applications + tag._count.companies + tag._count.contacts,
});

export async function listTagsAction(kind: TagKind) {
  const user = await requireUser();
  return (await tags.listTags(user.id, kind)).map(asOption);
}

export async function seedTagsAction(kind: TagKind) {
  const user = await requireUser();
  const seeded = await tags.seedTags(user.id, kind);
  revalidateTags();
  return seeded.map(asOption);
}

export async function createTagAction(input: { kind: TagKind; name: string; color?: string }) {
  const user = await requireUser();
  const tag = await tags.createTag(user.id, input);
  revalidateTags();
  return asOption(tag);
}

export async function updateTagAction(id: string, patch: { name?: string; color?: string }) {
  const user = await requireUser();
  const tag = await tags.updateTag(user.id, id, patch);
  revalidateTags();
  return asOption(tag);
}

export async function deleteTagAction(id: string) {
  const user = await requireUser();
  const result = await tags.deleteTag(user.id, id);
  revalidateTags();
  return result;
}

export async function createApplicationAction(input: pipeline.ApplicationInput) {
  const user = await requireUser();
  const application = await pipeline.createApplication(user.id, input);
  revalidatePath("/applications");
  revalidatePath("/");
  return application.id;
}

export async function updateApplicationAction(
  id: string,
  patch: Partial<pipeline.ApplicationInput>,
) {
  const user = await requireUser();
  await pipeline.updateApplication(user.id, id, patch);
  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
  revalidatePath("/");
}

export async function moveApplicationsStageAction(ids: string[], stage: Stage) {
  const user = await requireUser();
  const result = await pipeline.moveApplicationsStage(user.id, ids, stage);
  revalidatePath("/applications");
  revalidatePath("/");
  return result;
}

export async function moveStageAction(id: string, stage: Stage) {
  const user = await requireUser();
  await pipeline.moveApplicationStage(user.id, id, stage);
  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
  revalidatePath("/");
}

/** Archives, now. The name stays because the button still says Delete. */
export async function deleteApplicationAction(id: string) {
  const user = await requireUser();
  const result = await pipeline.deleteApplication(user.id, id);
  void archive.purgeExpiredFor(user.id).catch(() => {});
  revalidateEverywhere();
  return result;
}

export async function addActivityAction(input: {
  applicationId?: string;
  contactId?: string;
  type?: ActivityType;
  body: string;
}) {
  const user = await requireUser();
  await pipeline.addActivity(user.id, input);
  if (input.applicationId) revalidatePath(`/applications/${input.applicationId}`);
  if (input.contactId) revalidatePath(`/crm/contacts/${input.contactId}`);
  revalidatePath("/");
}

export async function createTaskAction(
  input: {
    title: string;
    detail?: string;
    dueAt?: string | null;
  } & pipeline.TaskSubjectInput,
) {
  const user = await requireUser();
  await pipeline.createTask(user.id, input);
  revalidatePath("/");
  // The subject's own screen shows its tasks, so it has to be refreshed too.
  revalidateSubject(input);
}

export async function updateTaskAction(
  id: string,
  patch: { title?: string; detail?: string; dueAt?: string | null } & pipeline.TaskSubjectInput,
) {
  const user = await requireUser();
  await pipeline.updateTask(user.id, id, patch);
  revalidatePath("/");
  revalidateSubject(patch);
}

/** The detail page of whatever a task was just hung on, if it has one. */
function revalidateSubject(input: pipeline.TaskSubjectInput) {
  if (input.applicationId) revalidatePath(`/applications/${input.applicationId}`);
  if (input.companyId) revalidatePath(`/crm/companies/${input.companyId}`);
  if (input.contactId) revalidatePath(`/crm/contacts/${input.contactId}`);
  if (input.resumeId) revalidatePath(`/resumes/${input.resumeId}`);
  if (input.roleId) revalidatePath(`/me/${input.roleId}`);
  if (input.noteId) revalidatePath("/me");
}

export async function toggleTaskAction(id: string, done: boolean) {
  const user = await requireUser();
  await pipeline.setTaskDone(user.id, id, done);
  revalidatePath("/");
  revalidatePath("/applications");
}

export async function deleteTaskAction(id: string) {
  const user = await requireUser();
  await pipeline.deleteTask(user.id, id);
  revalidatePath("/");
}

/**
 * When to next get in touch with someone.
 *
 * Lives here rather than on the contact record, which is where it used to be:
 * a date box halfway down a page you opened to read is not where you schedule
 * anything. Empty string clears it.
 */
export async function scheduleContactPingAction(id: string, date: string) {
  const user = await requireUser();
  await pipeline.updateContact(user.id, id, { nextFollowUpAt: date || null });
  revalidatePath("/");
  revalidatePath("/crm/contacts");
  revalidatePath(`/crm/contacts/${id}`);
}

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

/** Everywhere a record could have been showing before it moved. */
function revalidateEverywhere() {
  revalidatePath("/");
  revalidatePath("/archive");
  revalidatePath("/applications");
  revalidatePath("/crm/companies");
  revalidatePath("/crm/contacts");
}

export async function archiveRecordsAction(kind: archive.ArchiveKind, ids: string[]) {
  const user = await requireUser();
  const result = await archive.archiveRecords(user.id, kind, ids);
  // The act that fills the bin is the act that should trim it, which is what
  // bounds it on an instance nobody restarts and nobody signs out of.
  void archive.purgeExpiredFor(user.id).catch(() => {});
  revalidateEverywhere();
  return result;
}

export async function restoreRecordsAction(kind: archive.ArchiveKind, ids: string[]) {
  const user = await requireUser();
  const result = await archive.restoreRecords(user.id, kind, ids);
  revalidateEverywhere();
  return result;
}

export async function deleteArchivedAction(kind: archive.ArchiveKind, ids: string[]) {
  const user = await requireUser();
  const result = await archive.deleteArchived(user.id, kind, ids);
  revalidateEverywhere();
  return result;
}

/**
 * No expectCount here, unlike the tool.
 *
 * The dialog states the number and the click IS the confirmation. The count
 * guard exists for the assistant, which has no dialog and can only be stopped
 * by being made to say back what it read.
 */
export async function emptyArchiveAction(kind?: archive.ArchiveKind) {
  const user = await requireUser();
  const result = await archive.emptyArchive(user.id, kind ? { kind } : undefined);
  revalidateEverywhere();
  return result;
}

// ---------------------------------------------------------------------------
// Bulk changes from the CRM lists
// ---------------------------------------------------------------------------

export async function tagCompaniesAction(
  ids: string[],
  change: { add?: string[]; remove?: string[] },
) {
  const user = await requireUser();
  const result = await pipeline.tagCompanies(user.id, ids, change);
  revalidatePath("/crm/companies");
  revalidatePath("/applications");
  return result;
}

export async function tagContactsAction(
  ids: string[],
  change: { add?: string[]; remove?: string[] },
) {
  const user = await requireUser();
  const result = await pipeline.tagContacts(user.id, ids, change);
  revalidatePath("/crm/contacts");
  return result;
}

export async function scheduleContactPingsAction(ids: string[], date: string) {
  const user = await requireUser();
  const result = await pipeline.scheduleContactPings(user.id, ids, date);
  revalidatePath("/crm/contacts");
  revalidatePath("/");
  return result;
}

/**
 * Which optional fields a pipeline view draws.
 *
 * The view is positional and typed, not a key in a patch bag: a mistyped one
 * would otherwise be silently dropped and reported as saved.
 */
export async function setPipelineFieldsAction(view: PipelineView, fields: string[]) {
  const user = await requireUser();
  const result = await me.setPipelineFields(user.id, view, fields);
  revalidatePath("/applications");
  return result;
}

/**
 * Save a column width after a drag.
 *
 * No revalidatePath: the table already has the new width on screen — it has
 * been rendering it since the pointer moved — so refreshing the route would
 * repaint the whole list to arrive at the layout it is already showing.
 */
export async function setColumnWidthsAction(
  list: ColumnList,
  widths: Record<string, number>,
  options?: { reset?: boolean },
) {
  const user = await requireUser();
  return me.setColumnWidths(user.id, list, widths, options);
}

export async function createContactAction(input: {
  name: string;
  title?: string;
  email?: string;
  relationship?: string;
  company?: string;
  applicationId?: string | null;
}) {
  const user = await requireUser();
  await pipeline.createContact(user.id, input);
  if (input.applicationId) revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath("/applications");
}

export async function deleteContactAction(id: string, applicationId?: string) {
  const user = await requireUser();
  await pipeline.deleteContact(user.id, id);
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
}

/**
 * Attach a person already on file to an application, or detach them (null).
 * Detaching keeps the person — removing someone from an application must never
 * delete them from the CRM.
 */
export async function setContactApplicationAction(id: string, applicationId: string | null) {
  const user = await requireUser();
  await pipeline.updateContact(user.id, id, { applicationId });
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/applications");
  revalidatePath("/crm/contacts");
}

/**
 * Candidates for "attach someone you already know" on an application: every
 * contact except those already on it, with enough context to pick the right
 * Sarah. Someone attached to a different application is offered too — people
 * move between threads — but says where they currently are.
 */
export async function listContactsForAttachAction(applicationId: string) {
  const user = await requireUser();
  const contacts = await pipeline.listContacts(user.id);
  return contacts
    .filter((contact) => contact.applicationId !== applicationId)
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      title: contact.title,
      company: contact.companies.map((company) => company.name).join(", "),
      attachedTo: contact.application ? contact.application.roleTitle : null,
    }));
}

export async function snoozeFollowUpAction(id: string, days: number) {
  const user = await requireUser();
  await pipeline.snoozeFollowUp(user.id, id, days);
  revalidatePath("/");
  revalidatePath("/applications");
}

export async function snoozeContactFollowUpAction(id: string, days: number) {
  const user = await requireUser();
  await pipeline.snoozeContactFollowUp(user.id, id, days);
  revalidatePath("/");
  revalidatePath("/crm/contacts");
}

/**
 * Chased it — the other half of the chase list, and the honest one.
 * Writes the touch and moves the date; snoozing only moves the date.
 */
export async function logFollowUpAction(id: string, body?: string, days?: number) {
  const user = await requireUser();
  await pipeline.logFollowUp(user.id, { applicationId: id, body, days });
  revalidatePath("/");
  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
}

export async function logContactFollowUpAction(id: string, body?: string, days?: number) {
  const user = await requireUser();
  await pipeline.logFollowUp(user.id, { contactId: id, body, days });
  revalidatePath("/");
  revalidatePath("/crm/contacts");
  revalidatePath(`/crm/contacts/${id}`);
}

/**
 * Read one typed line against the open pipeline. Writes nothing: the person
 * confirms what it found, because a wrong guess written silently is worse
 * than no guess at all.
 */
export async function readQuickLogAction(text: string) {
  const user = await requireUser();
  return pipeline.readQuickLogAgainstPipeline(user.id, text);
}

/**
 * Commit what they confirmed: one activity, and the stage move if they took
 * the suggestion. Two writes, because they are two facts — what happened, and
 * where it leaves the application.
 */
export async function commitQuickLogAction(input: {
  applicationId: string;
  body: string;
  type: ActivityType;
  stage?: Stage | null;
}) {
  const user = await requireUser();
  if (input.stage) {
    await pipeline.moveApplicationStage(user.id, input.applicationId, input.stage, input.body);
  } else {
    await pipeline.addActivity(user.id, {
      applicationId: input.applicationId,
      type: input.type,
      body: input.body,
    });
  }
  revalidatePath("/");
  revalidatePath("/applications");
  revalidatePath(`/applications/${input.applicationId}`);
}

// ---------------------------------------------------------------------------
// CRM — companies and the people at them
// ---------------------------------------------------------------------------

export async function saveCompanyAction(
  id: string,
  patch: {
    name?: string;
    website?: string;
    notes?: string;
    industry?: string[];
    industryIds?: string[];
    size?: string[];
    sizeIds?: string[];
    location?: string[];
    locationIds?: string[];
    tags?: string[];
    tagIds?: string[];
  },
) {
  const user = await requireUser();
  const company = await pipeline.updateCompany(user.id, id, patch);
  revalidatePath(`/crm/companies/${id}`);
  revalidatePath("/crm/companies");
  // The website is where the logo comes from, so the pipeline changes too.
  revalidatePath("/applications");
  return { name: company.name };
}

export async function createCompanyAction(input: { name: string; website?: string }) {
  const user = await requireUser();
  const company = await pipeline.createCompany(user.id, input);
  revalidatePath("/crm/companies");
  return { id: company.id };
}

/** What a merge would do. Writes nothing, so nothing is revalidated. */
export async function previewCompanyMergeAction(keepId: string, mergeId: string) {
  const user = await requireUser();
  return pipeline.previewCompanyMerge(user.id, keepId, mergeId);
}

export async function mergeCompaniesAction(keepId: string, mergeId: string) {
  const user = await requireUser();
  const survivor = await pipeline.mergeCompanies(user.id, keepId, mergeId);
  revalidatePath("/crm/companies");
  revalidatePath(`/crm/companies/${keepId}`);
  revalidatePath("/crm/contacts");
  // The board carries the company's name and logo on every card it moved.
  revalidatePath("/applications");
  revalidatePath("/");
  return { id: survivor.id, name: survivor.name, merged: survivor.merged };
}

/** Archives, now. The name stays because the button still says Delete. */
export async function deleteCompanyAction(id: string) {
  const user = await requireUser();
  const result = await pipeline.deleteCompany(user.id, id);
  void archive.purgeExpiredFor(user.id).catch(() => {});
  revalidateEverywhere();
  return result;
}

export async function saveContactAction(
  id: string,
  patch: {
    name?: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    twitter?: string;
    instagram?: string;
    github?: string;
    website?: string;
    otherLinks?: string[];
    relationship?: string;
    notes?: string;
    /** Replaces the whole set. Ids, because the picker has already made them. */
    tagIds?: string[];
    /** "yyyy-mm-dd" from a date input; empty string clears the date. */
    nextFollowUpAt?: string;
  },
) {
  const user = await requireUser();
  const { nextFollowUpAt, ...rest } = patch;
  await pipeline.updateContact(user.id, id, {
    ...rest,
    ...(nextFollowUpAt !== undefined ? { nextFollowUpAt: nextFollowUpAt || null } : {}),
  });
  revalidatePath(`/crm/contacts/${id}`);
  revalidatePath("/crm/contacts");
}

/**
 * Everywhere this person represents, as a set.
 *
 * Replaces rather than adds, because that is what the data layer does and one
 * rule is easier to hold than two — the chips send the list they end up with.
 * `create` is the picker's "Create X" row: a name gets a company before it can
 * get an id, and doing it here keeps the client from needing a second call.
 * Returns the new set so the chips can settle without a round trip.
 */
export async function setContactCompaniesAction(id: string, companyIds: string[], create?: string) {
  const user = await requireUser();
  const ids = [...companyIds];
  if (create?.trim()) {
    const company = await pipeline.upsertCompanyByName(user.id, create);
    if (!ids.includes(company.id)) ids.push(company.id);
  }
  const contact = await pipeline.updateContact(user.id, id, { companyIds: ids });
  revalidatePath(`/crm/contacts/${id}`);
  revalidatePath("/crm/contacts");
  revalidatePath("/crm/companies");
  return contact.companies.map((company) => ({
    id: company.id,
    name: company.name,
    website: company.website,
  }));
}

/** Archives, now. The name stays because the button still says Delete. */
export async function deleteCrmContactAction(id: string) {
  const user = await requireUser();
  const result = await pipeline.deleteContact(user.id, id);
  void archive.purgeExpiredFor(user.id).catch(() => {});
  revalidateEverywhere();
  return result;
}

/**
 * The application behind a card, for the side panel.
 *
 * The panel opens over the board rather than navigating, so it has to fetch
 * what the full page would have been given at render time. Same data function,
 * same ownership check — the id is all that crosses from the client.
 */
export async function getApplicationForPanelAction(id: string) {
  const user = await requireUser();
  const [application, resumeList, tagOptions, companies, settings, googleConnection, fieldValues] =
    await Promise.all([
      pipeline.getApplication(user.id, id),
      resumes.listResumeNames(user.id),
      tags.listTags(user.id, "APPLICATION"),
      pipeline.listCompanies(user.id),
      getSettings(),
      accounts.accountAccess(user.id),
      pipeline.applicationFieldValues(user.id),
    ]);
  if (!application) throw new Error("That application is gone.");
  // Only when one is attached — the document carries the owner's photo as a
  // data URI, and the panel is opened far more often than a resume is read.
  const attached = application.resumeId
    ? await resumes.getResume(user.id, application.resumeId)
    : null;
  return {
    application: {
      id: application.id,
      company: application.company.name,
      companyId: application.companyId,
      roleTitle: application.roleTitle,
      stage: application.stage,
      jobUrl: application.jobUrl,
      jobDescription: application.jobDescription,
      location: application.location,
      workMode: application.workMode,
      salaryRange: application.salaryRange,
      tags: application.tags,
      notes: application.notes,
      appliedAt: application.appliedAt?.toISOString() ?? null,
      nextFollowUpAt: application.nextFollowUpAt?.toISOString() ?? null,
      resumeId: application.resumeId,
    },
    activities: application.activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      body: activity.body,
      occurredAt: activity.occurredAt.toISOString(),
    })),
    contacts: application.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      linkedin: contact.linkedin,
      relationship: contact.relationship,
    })),
    tasks: application.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      done: task.done,
      dueAt: task.dueAt?.toISOString() ?? null,
    })),
    resumes: resumeList.map((resume) => ({ id: resume.id, name: resume.name })),
    tagOptions: tagOptions.map(asOption),
    fieldValues,
    company: {
      id: application.companyId,
      name: application.company.name,
      website: application.company.website,
    },
    companies: companies.map((item) => ({
      id: item.id,
      name: item.name,
      website: item.website,
    })),
    resumePreview: attached
      ? {
          id: attached.id,
          name: attached.name,
          doc: attached.doc,
          settings: {
            template: attached.template,
            accent: attached.accent,
            fontFamily: attached.fontFamily,
            fontSize: attached.fontSize,
            lineHeight: attached.lineHeight,
            pageMargin: attached.pageMargin,
            photo: attached.showPhoto ? attached.photo : "",
          },
        }
      : null,
    logos: settings.companyLogos,
    googleAccess: googleConnection,
  };
}

// --- sharing the pipeline read-only -----------------------------------------

export async function sharePipelineAction(includeClosed?: boolean) {
  const user = await requireUser();
  const share = await pipelineShare.sharePipeline(user.id, { includeClosed });
  revalidatePath("/applications");
  return { slug: share.slug, includeClosed: share.includeClosed, url: `${await currentBaseUrl()}/p/${share.slug}` };
}

export async function unsharePipelineAction() {
  const user = await requireUser();
  await pipelineShare.unsharePipeline(user.id);
  revalidatePath("/applications");
}

// --- saved pipeline views ---------------------------------------------------

export async function saveViewAction(name: string, query: string) {
  const user = await requireUser();
  const view = await views.saveView(user.id, name, query);
  revalidatePath("/applications");
  return view;
}

export async function deleteSavedViewAction(id: string) {
  const user = await requireUser();
  await views.deleteSavedView(user.id, id);
  revalidatePath("/applications");
}

// --- the audit log ----------------------------------------------------------

/**
 * A page of the audit log, filtered.
 *
 * The Log tab pages through the server rather than filtering rows already in
 * the browser, because the log outlives everything else on an instance: cutting
 * a page and then filtering it shows you the wrong hundred rows.
 */
export async function loadAuditAction(input: {
  group?: string;
  search?: string;
  offset?: number;
  limit?: number;
}) {
  await requireAdmin();
  const limit = Math.min(input.limit ?? 100, 200);
  const rows = await listAudit({
    group: input.group,
    search: input.search,
    offset: input.offset ?? 0,
    limit,
  });
  return {
    rows: rows.map((row) => ({
      id: row.id,
      actorEmail: row.actorEmail,
      action: row.action,
      targetEmail: row.targetEmail,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
    })),
    // Fewer than asked for means this was the last page. One boolean beats a
    // count query the tab would run on every keystroke.
    more: rows.length === limit,
  };
}

// --- errors -----------------------------------------------------------------

/**
 * Called by the error boundary when a screen throws.
 *
 * Next logs the real error to stdout and hands the browser only a `digest`, so
 * without this an admin has no way to see that anything happened. Requires a
 * session, so it is not an open write endpoint, and takes nothing from the
 * client but the digest and the path — never the message, which the browser
 * cannot be trusted to have not made up.
 */
export async function reportRenderErrorAction(input: { digest?: string; path?: string }) {
  const user = await requireUser();
  await recordSystemEvent({
    source: "app",
    message: `A screen failed to render${input.path ? `: ${input.path}` : "."}`,
    detail: input.digest ? `digest ${input.digest}` : "",
    userEmail: user.email,
  });
}

// --- the welcome tour --------------------------------------------------------

/**
 * Put the tour away, or ask for it back.
 *
 * Two names for one write, because they are two different intentions and a
 * boolean at the call site reads as neither. Finishing and skipping both count
 * as seen — see setTourSeen for why.
 *
 * `setTourSeen(userId, true)` has no tool beside it, and that is the direct
 * manipulation exception rather than a gap: it is a person closing a dialog in
 * their own browser, and there is nothing for an assistant to do with it.
 * Asking for the tour BACK is a real request somebody makes out loud, so that
 * half is `restart_tour`.
 */
export async function completeTourAction() {
  const user = await requireUser();
  await onboarding.setTourSeen(user.id, true);
}

export async function restartTourAction() {
  const user = await requireUser();
  await onboarding.setTourSeen(user.id, false);
  // The tour mounts from the layout, which every screen renders.
  revalidatePath("/", "layout");
}
