-- Four things that make the pipeline keep running by itself: a follow-up cadence
-- per stage, tasks that come back, referrals as a record, and a monthly nudge to
-- log a win once the search is over.
--
-- NO BACKFILL anywhere in here, and each omission is deliberate.
--
-- StageCadence: an absent row resolves to the same built-in number the code uses
-- today, so nobody's dates move and no existing account sees a change. Writing a
-- row per user per stage would be three rows each saying what the default
-- already says, and would make the defaults un-editable by a future release.
--
-- Task.repeat*: every existing task is a task that happens once, which is what a
-- null repeatUnit means. There is nothing to convert.
--
-- Referral: ActivityType.REFERRAL rows exist and are NOT turned into referrals.
-- An activity body is prose somebody typed; guessing a status, a company and a
-- thanked-at out of one sentence is inventing four columns from a note, and
-- invariant six says this codebase does not invent.
--
-- Profile.winsNudge / lastWinsOn / winsQuiet: false, "" and 0 are exactly
-- "nobody has asked for this", which is what every existing account means.
-- CreateEnum
CREATE TYPE "TaskRepeat" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('ASKED', 'AGREED', 'SUBMITTED', 'DECLINED', 'NO_ANSWER');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "lastWinsOn" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "winsNudge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "winsQuiet" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "repeatAnchor" TIMESTAMP(3),
ADD COLUMN     "repeatEvery" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "repeatFrom" TEXT,
ADD COLUMN     "repeatUnit" "TaskRepeat",
ADD COLUMN     "repeatUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StageCadence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "days" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageCadence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "applicationId" TEXT,
    "companyId" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'ASKED',
    "askedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',
    "thankedAt" TIMESTAMP(3),
    "thankTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageCadence_userId_idx" ON "StageCadence"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StageCadence_userId_stage_key" ON "StageCadence"("userId", "stage");

-- CreateIndex
CREATE INDEX "Referral_userId_status_idx" ON "Referral"("userId", "status");

-- CreateIndex
CREATE INDEX "Referral_contactId_idx" ON "Referral"("contactId");

-- CreateIndex
CREATE INDEX "Referral_applicationId_idx" ON "Referral"("applicationId");

-- CreateIndex
CREATE INDEX "Referral_companyId_idx" ON "Referral"("companyId");

-- AddForeignKey
ALTER TABLE "StageCadence" ADD CONSTRAINT "StageCadence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

