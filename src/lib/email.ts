import { emailIsConfigured, getSettings, type InstanceSettings } from "@/lib/settings";
import { recordSystemEvent } from "@/lib/data/system";

/**
 * Resend over its REST API. No SDK: it is one POST, and skipping the package
 * keeps the deploy smaller and the dependency surface smaller.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  settings?: InstanceSettings;
}): Promise<SendResult> {
  const settings = input.settings ?? (await getSettings());

  if (!emailIsConfigured(settings)) {
    return {
      ok: false,
      error: "Email is not configured. Add a Resend API key and a from address in Admin → Email.",
    };
  }

  const from = settings.resendFromName
    ? `${settings.resendFromName} <${settings.resendFromEmail}>`
    : settings.resendFromEmail;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!response.ok) {
      // Resend puts the useful part in `message`; fall back to the status.
      const error = body.message || `Resend returned ${response.status}`;
      await recordSystemEvent({ source: "email.send", message: error, userEmail: input.to });
      return { ok: false, error };
    }
    await recordSystemEvent({
      level: "INFO",
      source: "email.send",
      message: input.subject,
      userEmail: input.to,
    });
    return { ok: true, id: body.id ?? "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordSystemEvent({ source: "email.send", message, userEmail: input.to });
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// The look
//
// An email is the only surface of this product that cannot read globals.css.
// No custom properties, no stylesheet, no cascade worth trusting — so the
// palette is repeated here as hex, converted once from the oklch tokens, and
// the layout is built the way mail is built rather than the way the app is.
//
// Three rules hold the design together:
//
// 1. TABLES CARRY THE LAYOUT. Outlook on Windows renders through Word, which
//    has no `max-width`, so a centred div becomes a full-bleed one and the
//    whole thing falls apart on the one client a hiring manager is most likely
//    to be reading it in. This supersedes the older note here that said the
//    templates were table-free: table-free was the thing that broke the client
//    it was meant to protect.
// 2. COLOUR STILL MEANS SOMETHING. Same rule as the interface: near-monochrome
//    surface, type does the hierarchy, and the one blue is the primary action
//    and links. There is no email-only accent.
// 3. NOTHING IS FETCHED. The mark is drawn out of a table cell and three
//    coloured strips rather than loaded as an image, so it survives blocked
//    images, and no font is pulled from Google — the same reason the company
//    logo switch exists, applied to mail.
// ---------------------------------------------------------------------------

/**
 * The tokens from globals.css, converted to hex because mail clients want hex.
 * If a value here drifts from its counterpart in `:root` or `.dark`, the emails
 * stop looking like the app — which is the only reason to touch this block.
 */
const C = {
  page: "#f2f2f4", // --canvas
  card: "#ffffff", // --card
  inset: "#f6f6f8", // --inset, a shade lighter so it reads on white
  ink: "#101214", // --foreground
  muted: "#626569", // --muted-foreground
  faint: "#919499", // --faint
  border: "#e4e5e8", // --border
  primary: "#0c71d1", // --primary
  onPrimary: "#ffffff", // --primary-foreground
} as const;

const D = {
  page: "#0d0e10",
  card: "#18191b",
  inset: "#1f2023",
  ink: "#f4f4f6",
  muted: "#96989d",
  faint: "#75787d",
  border: "#2d2e30",
  primary: "#4ea1f5", // lifted: the light-theme blue disappears on a dark card
  onPrimary: "#0d0e10",
} as const;

/**
 * Inter first for the handful of people who have it installed, then the system
 * stack everyone else lands on. Deliberately not loaded from Google: an email
 * that fetches a font tells a third party the moment it was opened, and this
 * product asks before doing that anywhere else.
 */
const FONT =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const WIDTH = 552;

/**
 * The mark, in HTML. Same 64-unit grid as `hired-mark.tsx` — bar height 7,
 * gap 4.5, x 16, widths 13/22.5/32, radius 15 — scaled to a 40px tile and
 * rounded to whole pixels, because half a pixel is a blurry bar in mail.
 *
 * Outlook drops the corner radius and gets a square tile with square bars.
 * That is still the mark; it is not still the mark if it is a broken image
 * icon, which is what an <img> would be for everyone with images off.
 */
function mark() {
  const bar = (w: number, first = false) =>
    `<tr><td style="padding:${first ? 0 : 3}px 0 0 0;line-height:0;font-size:0;">
       <div style="width:${w}px;height:4px;background:${C.card};border-radius:1px;font-size:0;line-height:0;" class="cut">&nbsp;</div>
     </td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="40" style="width:40px;background:${C.ink};border-radius:9px;" class="tile" bgcolor="${C.ink}">
      <tr><td style="padding:11px 0 11px 10px;" align="left">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          ${bar(8, true)}${bar(14)}${bar(20)}
        </table>
      </td></tr>
    </table>`;
}

/** The hidden line the inbox shows next to the subject. Worth writing by hand. */
function preheader(text: string) {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">${escapeHtml(text)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`;
}

/**
 * The frame every email shares: masthead, one card, footer.
 *
 * `preview` is the inbox line. `footer` is the small print under the card —
 * the sentence that says what happens next, or what to do if this wasn't for
 * you. Both are required because an email without either is the kind of email
 * that gets reported as spam.
 */
function shell(input: {
  instanceName: string;
  title: string;
  preview: string;
  body: string;
  footer: string;
}) {
  return `<!doctype html>
<html lang="en" dir="ltr" style="background:${C.page};">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  /* Clients that honour the media query get the app's dark theme. The ones
     that don't keep the inline light values, and the ones that force their own
     inversion (Gmail, mostly) land somewhere close enough because the surface
     is grey either way. */
  @media (prefers-color-scheme: dark) {
    html, body, .page { background:${D.page} !important; }
    .card { background:${D.card} !important; border-color:${D.border} !important; }
    .inset { background:${D.inset} !important; border-color:${D.border} !important; }
    .ink, .ink a { color:${D.ink} !important; }
    .muted { color:${D.muted} !important; }
    .faint { color:${D.faint} !important; }
    .rule { border-color:${D.border} !important; background:${D.border} !important; }
    .link, .link a { color:${D.primary} !important; }
    .btn { background:${D.primary} !important; }
    .btn a { color:${D.onPrimary} !important; }
    .tile { background:${D.ink} !important; }
    .cut { background:${D.page} !important; }
    .dot { background:${D.primary} !important; }
  }
  @media only screen and (max-width:600px) {
    .pad { padding:24px !important; }
  }
  a { color:${C.primary}; }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${C.page};font-family:${FONT};-webkit-font-smoothing:antialiased;" class="page" bgcolor="${C.page}">
${preheader(input.preview)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.page};" class="page" bgcolor="${C.page}">
<tr><td align="center" style="padding:36px 16px 44px;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}" align="center"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:${WIDTH}px;margin:0 auto;">

  <!-- masthead -->
  <tr><td style="padding:0 4px 18px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td valign="middle" width="40">${mark()}</td>
        <td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:16px;font-weight:600;letter-spacing:-0.015em;color:${C.ink};" class="ink">${escapeHtml(input.instanceName)}</td>
      </tr>
    </table>
  </td></tr>

  <!-- card -->
  <tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:14px;" class="card" bgcolor="${C.card}">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td class="pad" style="padding:32px;font-family:${FONT};">
        <h1 style="margin:0 0 16px;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:${C.ink};" class="ink">${escapeHtml(input.title)}</h1>
        ${input.body}
      </td></tr>
    </table>
  </td></tr>

  <!-- footer -->
  <tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.faint};" class="faint">
    ${input.footer}
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// --- Pieces the templates are built from ----------------------------------
// Small enough to read at a glance, which is the point: a template below
// should be its words, not its markup.

/** A paragraph. `last` drops the bottom margin where something follows it. */
function p(html: string, opts?: { muted?: boolean; last?: boolean }) {
  const color = opts?.muted ? C.muted : C.ink;
  const cls = opts?.muted ? "muted" : "ink";
  return `<p style="margin:0 0 ${opts?.last ? 0 : 14}px;font-family:${FONT};font-size:15px;line-height:1.65;color:${color};" class="${cls}">${html}</p>`;
}

/** The one primary action. A cell carries the fill so Outlook keeps the padding. */
function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
      <tr><td align="center" bgcolor="${C.primary}" style="background:${C.primary};border-radius:9px;" class="btn">
        <a href="${escapeAttr(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${C.onPrimary};text-decoration:none;border-radius:9px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

/** Every button needs this under it: half of mail clients eat the button. */
function fallbackLink(href: string) {
  return `<p style="margin:20px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.6;color:${C.faint};" class="faint">
      Or paste this into your browser:<br>
      <a href="${escapeAttr(href)}" style="color:${C.primary};word-break:break-all;text-decoration:none;" class="link">${escapeHtml(href)}</a>
    </p>`;
}

/** A recessed block of label/value pairs — the app's inset surface, in mail. */
function facts(rows: [string, string][]) {
  const cells = rows
    .map(
      ([label, value], i) =>
        `<tr><td style="padding:${i === 0 ? 0 : 14}px 0 0;font-family:${FONT};">
           <div style="font-size:11.5px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${C.faint};" class="faint">${escapeHtml(label)}</div>
           <div style="margin-top:3px;font-size:15px;line-height:1.5;color:${C.ink};" class="ink">${escapeHtml(value)}</div>
         </td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:2px 0 18px;background:${C.inset};border:1px solid ${C.border};border-radius:11px;" class="inset" bgcolor="${C.inset}">
      <tr><td style="padding:18px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}</table></td></tr>
    </table>`;
}

/** A small heading inside the card. Never an <h2>: the h1 is the only title. */
function eyebrow(text: string) {
  return `<div style="margin:0 0 12px;font-family:${FONT};font-size:11.5px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${C.faint};" class="faint">${escapeHtml(text)}</div>`;
}

/** A hairline. Border on a cell, because a 1px div collapses in Outlook. */
function rule() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0;"><tr><td style="height:1px;line-height:1px;font-size:0;background:${C.border};" class="rule">&nbsp;</td></tr></table>`;
}

/** What the product is, in three lines. The three areas, in their own words. */
function areas() {
  const items: [string, string][] = [
    ["Me", "Everything you've done, kept in one place instead of six resumes."],
    ["Resumes", "Documents assembled from that material, tailored per posting."],
    ["Pipeline", "Where every application stands and who you owe a reply."],
  ];
  return items
    .map(
      ([name, line], i) =>
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:${i === 0 ? 0 : 12}px 0 0;"><tr>
           <td width="6" valign="top" style="padding:8px 0 0;line-height:0;font-size:0;"><div style="width:5px;height:5px;border-radius:3px;background:${C.primary};font-size:0;line-height:0;" class="dot">&nbsp;</div></td>
           <td style="padding-left:11px;font-family:${FONT};font-size:14.5px;line-height:1.6;color:${C.muted};" class="muted">
             <strong style="color:${C.ink};font-weight:600;" class="ink">${name}</strong> — ${line}
           </td>
         </tr></table>`,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// The templates
// ---------------------------------------------------------------------------

export function inviteEmail(input: {
  instanceName: string;
  inviterName: string;
  acceptUrl: string;
  expiresInDays: number;
}) {
  const subject = `${input.inviterName} invited you to ${input.instanceName}`;
  const html = shell({
    instanceName: input.instanceName,
    title: "You've been invited",
    preview: `Pick a password and ${input.instanceName} is yours. The link is good for ${input.expiresInDays} days.`,
    body: `${p(
      `<strong style="font-weight:600;">${escapeHtml(input.inviterName)}</strong> has invited you to join
       <strong style="font-weight:600;">${escapeHtml(input.instanceName)}</strong> — a place to keep everything
       about your career in one spot, build resumes out of it, and track where you've applied.`,
    )}
    ${p("Pick a password and you're in. It takes about a minute.", { muted: true, last: true })}
    ${button(input.acceptUrl, "Accept invitation")}
    ${fallbackLink(input.acceptUrl)}
    ${rule()}
    ${eyebrow("What's inside")}
    ${areas()}`,
    footer: `This invitation expires in ${input.expiresInDays} days and nothing happens until you accept it. If you weren't expecting it, ignore this email.`,
  });

  const text = `${input.inviterName} invited you to join ${input.instanceName} — a place to keep
everything about your career in one spot, build resumes out of it, and track
where you've applied.

Accept your invitation: ${input.acceptUrl}

The link expires in ${input.expiresInDays} days. If you weren't expecting it, ignore this email.`;

  return { subject, html, text };
}

/**
 * The one email that goes to the instance owner rather than to a user: someone
 * asked for access from the marketing site. It exists so the owner doesn't have
 * to poll an admin screen to find out that a stranger is waiting.
 */
export function waitlistNoticeEmail(input: {
  instanceName: string;
  email: string;
  name: string;
  context: string;
  source: string;
  total: number;
  adminUrl: string;
}) {
  const who = input.name ? `${input.name} (${input.email})` : input.email;
  const subject = `${input.instanceName}: ${who} wants access`;

  const rows = [
    ["Email", input.email],
    input.name ? ["Name", input.name] : null,
    input.context ? ["Looking for", input.context] : null,
    input.source ? ["From", input.source] : null,
  ].filter(Boolean) as [string, string][];

  const waiting = `${input.total} ${input.total === 1 ? "person is" : "people are"} on the list.`;

  const html = shell({
    instanceName: input.instanceName,
    title: "Someone asked for access",
    preview: `${who} — ${waiting}`,
    body: `${p("They filled in the form on your site. Nothing has been given to them yet.", { muted: true })}
    ${facts(rows)}
    ${p(waiting, { muted: true, last: true })}
    ${input.adminUrl ? button(input.adminUrl, "Open the waitlist") : ""}`,
    footer: "Invite them from Admin → People → Waiting for access when you're ready.",
  });

  const text = `${who} asked for access to ${input.instanceName}.

${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}

${waiting}${input.adminUrl ? `\n\nInvite them: ${input.adminUrl}` : ""}

Nobody has been given access yet.`;

  return { subject, html, text };
}

export function testEmail(instanceName: string) {
  return {
    subject: `${instanceName}: email is working`,
    html: shell({
      instanceName,
      title: "Email is working",
      preview: `${instanceName} can send mail through Resend.`,
      body: `${p(
        `If you're reading this, <strong style="font-weight:600;">${escapeHtml(instanceName)}</strong> can
         send mail through Resend, and this is the address invitations will come from.`,
      )}
      ${p("Nothing else is needed. Invite someone from Admin → People.", { muted: true, last: true })}`,
      footer: "Sent from Admin → Configuration → Email on your instance.",
    }),
    text: `Email is working. ${instanceName} can send mail through Resend, and this is the
address invitations will come from.

Sent from Admin → Configuration → Email on your instance.`,
  };
}

// ---------------------------------------------------------------------------
// Previewing them
//
// Every one of these is designed, and a design you cannot look at is a design
// nobody checks. `admin_send_test_email` takes a template key from this list
// and sends that one, filled with obvious placeholder material, so the invite
// can be proofread in a real inbox without minting a real invitation — the
// token in a real invite is a credential, and "let me see how it looks" is not
// a reason to hand one out.
// ---------------------------------------------------------------------------

export type EmailTemplateKey = "test" | "invite" | "waitlist";

export const EMAIL_TEMPLATES: {
  key: EmailTemplateKey;
  label: string;
  render: (settings: InstanceSettings) => { subject: string; html: string; text: string };
}[] = [
  {
    key: "test",
    label: "Test — email is working",
    render: (settings) => testEmail(settings.instanceName),
  },
  {
    key: "invite",
    label: "Sample invitation",
    render: (settings) => {
      const base = (settings.publicUrl || "https://example.com").replace(/\/$/, "");
      const sample = inviteEmail({
        instanceName: settings.instanceName,
        inviterName: "A sample inviter",
        // Deliberately not a real token: this link goes nowhere on purpose.
        acceptUrl: `${base}/invite/sample-preview-link`,
        expiresInDays: 14,
      });
      return { ...sample, subject: `[Sample] ${sample.subject}` };
    },
  },
  {
    key: "waitlist",
    label: "Sample waitlist notice",
    render: (settings) => {
      const base = (settings.publicUrl || "").replace(/\/$/, "");
      const sample = waitlistNoticeEmail({
        instanceName: settings.instanceName,
        email: "sample@example.com",
        name: "A sample person",
        context: "Looking for a senior backend role",
        source: "hired.tools",
        total: 1,
        adminUrl: base ? `${base}/admin` : "",
      });
      return { ...sample, subject: `[Sample] ${sample.subject}` };
    },
  },
];

/** Falls back to the test email, so a bad key sends something rather than nothing. */
export function renderEmailTemplate(key: string | undefined, settings: InstanceSettings) {
  const found = EMAIL_TEMPLATES.find((t) => t.key === key);
  return (found ?? EMAIL_TEMPLATES[0]).render(settings);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** URLs land in href, where a stray quote would end the attribute. */
function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
