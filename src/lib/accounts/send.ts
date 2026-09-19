import { PROVIDER_TIMEOUT_MS } from "@/lib/accounts/types";

/**
 * Putting one message in somebody's own outbox.
 *
 * Read the header of src/lib/data/outbound.ts before this file: every guardrail
 * that matters is there, and this is only the wire. Nothing here decides
 * whether a message may be sent — it takes an access token and a message and
 * either the provider accepted it or it did not.
 *
 * Hand-written over fetch for the reason google.ts gives: the surface this app
 * uses is a handful of requests, and the official client is several megabytes
 * that would own the shape of every response.
 *
 * IMAP ACCOUNTS CANNOT SEND. LinkedAccount carries imapHost and imapPassword
 * and no SMTP columns at all, and adding four more credential columns is a
 * larger change than this needs. The data layer refuses such an account by name.
 */

export type OutgoingMessage = {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  subject: string;
  /** Plain text. This app sends no HTML on a member's behalf. */
  text: string;
};

export type SendOutcome = { ok: true; messageId: string } | { ok: false; error: string };

export const GOOGLE_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const MICROSOFT_SEND_SCOPE = "Mail.Send";

/** A header value with no way to inject a second header. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * RFC 2047 encoding for a header that has anything outside ASCII in it.
 *
 * A name like "Renée Søndergaard" in a raw Subject or To header is either
 * mangled or rejected, depending on the provider.
 */
function encodeHeader(value: string): string {
  const safe = headerSafe(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function address(email: string, name: string): string {
  const clean = headerSafe(email);
  if (!name.trim()) return clean;
  return `${encodeHeader(name)} <${clean}>`;
}

/** The message as a mail server expects it. Plain text, UTF-8, base64 body. */
export function rfc5322(message: OutgoingMessage): string {
  const headers = [
    `From: ${address(message.fromEmail, message.fromName)}`,
    `To: ${address(message.toEmail, message.toName)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  // Base64 rather than 8bit: it removes every question about line length,
  // trailing whitespace and bare newlines in one go.
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendViaGoogle(
  accessToken: string,
  message: OutgoingMessage,
): Promise<SendOutcome> {
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(rfc5322(message)) }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = (body.error ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        error:
          typeof error.message === "string"
            ? error.message
            : `Gmail refused it (HTTP ${response.status}).`,
      };
    }
    return { ok: true, messageId: typeof body.id === "string" ? body.id : "" };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

export async function sendViaMicrosoft(
  accessToken: string,
  message: OutgoingMessage,
): Promise<SendOutcome> {
  try {
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: headerSafe(message.subject),
          body: { contentType: "Text", content: message.text },
          toRecipients: [
            {
              emailAddress: {
                address: headerSafe(message.toEmail),
                name: headerSafe(message.toName) || undefined,
              },
            },
          ],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = (body.error ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        error:
          typeof error.message === "string"
            ? error.message
            : `Microsoft refused it (HTTP ${response.status}).`,
      };
    }
    // Graph's sendMail answers 202 with no body, so there is no id to keep.
    return { ok: true, messageId: "" };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

function reason(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "The provider did not answer in time.";
    return error.message;
  }
  return "That send failed.";
}
