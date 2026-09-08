-- GoogleAccount becomes LinkedAccount: one table for every mailbox and
-- calendar the app reads on a person's behalf — Google, Microsoft 365, or
-- anything that speaks IMAP and CalDAV — and more than one per person, because
-- a work Outlook and a personal Gmail are both where recruiters write.
--
-- A rename rather than a new table so a Google connection made on the
-- previous release survives: its refresh token, its address and which of
-- Gmail and Calendar it granted (rewritten from Google's scope URLs into the
-- provider-neutral feature names the app uses now).
CREATE TYPE "AccountProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'IMAP');

ALTER TABLE "GoogleAccount" RENAME TO "LinkedAccount";
ALTER TABLE "LinkedAccount" RENAME CONSTRAINT "GoogleAccount_pkey" TO "LinkedAccount_pkey";
ALTER TABLE "LinkedAccount" RENAME CONSTRAINT "GoogleAccount_userId_fkey" TO "LinkedAccount_userId_fkey";
DROP INDEX "GoogleAccount_userId_key";

ALTER TABLE "LinkedAccount" ADD COLUMN "provider" "AccountProvider" NOT NULL DEFAULT 'GOOGLE';
ALTER TABLE "LinkedAccount" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "LinkedAccount" RENAME COLUMN "googleId" TO "externalId";
ALTER TABLE "LinkedAccount" ALTER COLUMN "refreshToken" SET DEFAULT '';

ALTER TABLE "LinkedAccount" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LinkedAccount" ADD COLUMN "features" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "LinkedAccount" SET "features" = ARRAY_REMOVE(ARRAY[
  CASE WHEN 'https://www.googleapis.com/auth/gmail.readonly' = ANY("scopes") THEN 'mail' END,
  CASE WHEN 'https://www.googleapis.com/auth/calendar.readonly' = ANY("scopes") THEN 'calendar' END
], NULL);
ALTER TABLE "LinkedAccount" DROP COLUMN "scopes";

ALTER TABLE "LinkedAccount" ADD COLUMN "imapHost" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LinkedAccount" ADD COLUMN "imapPort" INTEGER NOT NULL DEFAULT 993;
ALTER TABLE "LinkedAccount" ADD COLUMN "imapUsername" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LinkedAccount" ADD COLUMN "imapPassword" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LinkedAccount" ADD COLUMN "caldavUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LinkedAccount" ADD COLUMN "caldavUsername" TEXT NOT NULL DEFAULT '';
ALTER TABLE "LinkedAccount" ADD COLUMN "caldavPassword" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX "LinkedAccount_userId_provider_email_key" ON "LinkedAccount"("userId", "provider", "email");
CREATE INDEX "LinkedAccount_userId_idx" ON "LinkedAccount"("userId");
