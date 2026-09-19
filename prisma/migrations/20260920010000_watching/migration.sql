-- Watching the outside world: a company's board, whether a posting is still up,
-- a sweep of new mail, and the link that captures a posting from a phone.
--
-- THERE IS NO BACKFILL HERE, and each omission is deliberate:
--
--   * Application.postingStatus lands as UNKNOWN with a null postingCheckedAt on
--     every existing row. A null sorts first in the sweep's ordering, so an
--     instance's first sweep after this works through the whole back catalogue
--     oldest first, at the per-run cap, over several runs. That IS the correct
--     behaviour — do not "fix" it with an UPDATE that sets now().
--   * Profile.mailSweep stays false for everybody. It reads a person's mailbox;
--     a migration must never be the thing that turns that on. mailSweptAt stays
--     null, which the sweep reads as "never swept" and answers with a bounded
--     three-day first look rather than the whole mailbox.
--   * CompanyWatch and CaptureLink start empty. In particular no capture link is
--     minted for anybody: unlike an MCP connection, an unwanted one is an
--     unauthenticated write endpoint nobody asked to exist.
--
-- ALTER TYPE "ProposalKind" ADD VALUE runs inside this migration's transaction,
-- which PG 12+ allows as long as the new value is not USED in the same
-- transaction. Nothing below inserts a row, so there is nothing to do by hand.

-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('UNKNOWN', 'LIVE', 'GONE', 'UNCLEAR', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "BoardProvider" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY');

-- AlterEnum
ALTER TYPE "ProposalKind" ADD VALUE 'CREATE_APPLICATION';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "postingCheckedAt" TIMESTAMP(3),
ADD COLUMN     "postingGoneSince" TIMESTAMP(3),
ADD COLUMN     "postingMisses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "postingNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "postingStatus" "PostingStatus" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "mailSweep" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mailSweepNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mailSweptAt" TIMESTAMP(3),
ADD COLUMN     "mailSweptRunAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CompanyWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "BoardProvider" NOT NULL,
    "slug" TEXT NOT NULL,
    "boardUrl" TEXT NOT NULL DEFAULT '',
    "titleTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seenIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proposed" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastFoundAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowCount" INTEGER NOT NULL DEFAULT 0,
    "captured" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedFrom" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyWatch_userId_idx" ON "CompanyWatch"("userId");

-- CreateIndex
CREATE INDEX "CompanyWatch_companyId_idx" ON "CompanyWatch"("companyId");

-- CreateIndex
CREATE INDEX "CompanyWatch_enabled_lastCheckedAt_idx" ON "CompanyWatch"("enabled", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWatch_userId_provider_slug_key" ON "CompanyWatch"("userId", "provider", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureLink_userId_key" ON "CaptureLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureLink_token_key" ON "CaptureLink"("token");

-- CreateIndex
CREATE INDEX "Application_postingCheckedAt_idx" ON "Application"("postingCheckedAt");

-- AddForeignKey
ALTER TABLE "CompanyWatch" ADD CONSTRAINT "CompanyWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyWatch" ADD CONSTRAINT "CompanyWatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureLink" ADD CONSTRAINT "CaptureLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

