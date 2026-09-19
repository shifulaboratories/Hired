-- Interviews become a record rather than a sentence in a timeline.
--
-- NO BACKFILL, deliberately, and the next reader will assume that was an
-- oversight. It was not. An INTERVIEW activity's body is prose somebody typed —
-- "chat with Priya went well, they asked about the migration" — and turning that
-- into a round number, a format and a scheduled time is inventing four columns
-- out of one sentence. Invariant six says this codebase does not invent. Old
-- activities stay exactly where they are and keep rendering; the first interview
-- a person records is the first Interview row they have.
--
-- Application.interviewRound is NOT rewritten either. It keeps every value it
-- holds, and the new layer can only ever raise it, because how far something got
-- is a fact. The funnel, diagnose_search, pipeline_stats and every saved view
-- read that column and need no change at all.
-- CreateEnum
CREATE TYPE "InterviewFormat" AS ENUM ('PHONE', 'VIDEO', 'ONSITE', 'TAKE_HOME', 'PAIRING', 'PANEL', 'OTHER');

-- CreateEnum
CREATE TYPE "InterviewOutcome" AS ENUM ('SCHEDULED', 'HELD', 'PASSED', 'REJECTED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('BEHAVIOURAL', 'TECHNICAL', 'SYSTEM_DESIGN', 'ROLE', 'CULTURE', 'COMPENSATION', 'MINE', 'OTHER');

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT NOT NULL DEFAULT '',
    "format" "InterviewFormat" NOT NULL DEFAULT 'VIDEO',
    "outcome" "InterviewOutcome" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "durationMins" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT NOT NULL DEFAULT '',
    "prep" TEXT NOT NULL DEFAULT '',
    "debrief" TEXT NOT NULL DEFAULT '',
    "calendarEventId" TEXT NOT NULL DEFAULT '',
    "activityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewInterviewer" (
    "interviewId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewInterviewer_pkey" PRIMARY KEY ("interviewId","contactId")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "kind" "QuestionKind" NOT NULL DEFAULT 'BEHAVIOURAL',
    "question" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "better" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Interview_userId_idx" ON "Interview"("userId");

-- CreateIndex
CREATE INDEX "Interview_applicationId_round_idx" ON "Interview"("applicationId", "round");

-- CreateIndex
CREATE INDEX "Interview_userId_scheduledAt_idx" ON "Interview"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_userId_calendarEventId_idx" ON "Interview"("userId", "calendarEventId");

-- CreateIndex
CREATE INDEX "InterviewInterviewer_contactId_idx" ON "InterviewInterviewer"("contactId");

-- CreateIndex
CREATE INDEX "InterviewQuestion_userId_key_idx" ON "InterviewQuestion"("userId", "key");

-- CreateIndex
CREATE INDEX "InterviewQuestion_interviewId_sortOrder_idx" ON "InterviewQuestion"("interviewId", "sortOrder");

-- CreateIndex
CREATE INDEX "InterviewQuestion_userId_kind_idx" ON "InterviewQuestion"("userId", "kind");

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewInterviewer" ADD CONSTRAINT "InterviewInterviewer_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewInterviewer" ADD CONSTRAINT "InterviewInterviewer_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

