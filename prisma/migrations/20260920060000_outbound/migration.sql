-- One message can leave, and every default is a refusal.
--
-- THIS IS THE WHOLE MIGRATION SAFETY STORY: Profile.outboundDailyLimit defaults
-- to 0 and outboundApproval to "each", so every existing account is OFF and in
-- the strictest mode with no backfill. A default of anything else would turn
-- sending on for everybody at deploy. Do not "helpfully" backfill a limit.
--
-- ON DELETE RESTRICT on accountId and contactId means disconnecting a mailbox
-- or deleting a contact that has an Outbound row FAILS at the database. That is
-- deliberate — the record of what was sent must survive both — and
-- disconnectAccount and deleteContact refuse with a sentence of their own
-- rather than letting Postgres raise in front of somebody.

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Outbound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "OutboundStatus" NOT NULL DEFAULT 'DRAFT',
    "applicationId" TEXT,
    "letterId" TEXT,
    "providerMessageId" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "draftedBy" TEXT NOT NULL DEFAULT '',
    "draftedByName" TEXT NOT NULL DEFAULT '',
    "sentBy" TEXT NOT NULL DEFAULT '',
    "sentByName" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Outbound_userId_status_createdAt_idx" ON "Outbound"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Outbound_userId_sentAt_idx" ON "Outbound"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "Outbound_contactId_idx" ON "Outbound"("contactId");

-- CreateIndex
CREATE INDEX "Outbound_applicationId_idx" ON "Outbound"("applicationId");

-- AddForeignKey
ALTER TABLE "Outbound" ADD CONSTRAINT "Outbound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbound" ADD CONSTRAINT "Outbound_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LinkedAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbound" ADD CONSTRAINT "Outbound_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbound" ADD CONSTRAINT "Outbound_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbound" ADD CONSTRAINT "Outbound_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

