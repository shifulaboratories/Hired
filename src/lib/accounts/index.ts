import type { AccountProvider } from "@prisma/client";
import type { AccountFeature, CalendarReader, MailReader } from "@/lib/accounts/types";
import { googleCalendarReader, googleMailReader } from "@/lib/accounts/google";
import { microsoftCalendarReader, microsoftMailReader } from "@/lib/accounts/microsoft";
import { imapMailReader } from "@/lib/accounts/imap";
import { caldavCalendarReader } from "@/lib/accounts/caldav";

/**
 * From a row's credentials to a reader. The data layer resolves a live
 * access token for the OAuth providers before calling this; the IMAP kind
 * carries everything it needs on the row.
 */

export type ReaderCredentials = {
  provider: AccountProvider;
  email: string;
  features: string[];
  /** A live access token, for GOOGLE and MICROSOFT. */
  accessToken: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPassword: string;
  caldavUrl: string;
  caldavUsername: string;
  caldavPassword: string;
};

export function hasFeature(account: { features: string[] }, feature: AccountFeature): boolean {
  return account.features.includes(feature);
}

export function mailReaderFor(account: ReaderCredentials): MailReader | null {
  if (!hasFeature(account, "mail")) return null;
  switch (account.provider) {
    case "GOOGLE":
      return googleMailReader(account.accessToken, account.email);
    case "MICROSOFT":
      return microsoftMailReader(account.accessToken);
    case "IMAP":
      return imapMailReader({
        host: account.imapHost,
        port: account.imapPort,
        username: account.imapUsername,
        password: account.imapPassword,
        accountEmail: account.email,
      });
  }
}

export function calendarReaderFor(account: ReaderCredentials): CalendarReader | null {
  if (!hasFeature(account, "calendar")) return null;
  switch (account.provider) {
    case "GOOGLE":
      return googleCalendarReader(account.accessToken);
    case "MICROSOFT":
      return microsoftCalendarReader(account.accessToken, account.email);
    case "IMAP":
      return caldavCalendarReader({
        url: account.caldavUrl,
        username: account.caldavUsername,
        password: account.caldavPassword,
      });
  }
}

/** The name a person knows the provider by. */
export const PROVIDER_LABEL: Record<AccountProvider, string> = {
  GOOGLE: "Google",
  MICROSOFT: "Microsoft 365",
  IMAP: "IMAP & CalDAV",
};

/** What each half is called for a given provider, on a tile or in a sentence. */
export function featureLabel(provider: AccountProvider, feature: AccountFeature): string {
  if (feature === "mail") return provider === "GOOGLE" ? "Gmail" : provider === "MICROSOFT" ? "Outlook" : "IMAP";
  return provider === "IMAP" ? "CalDAV" : "Calendar";
}
