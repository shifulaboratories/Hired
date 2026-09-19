-- Version history for the two things that get replaced, and a log of what each
-- assistant did.
--
-- NO BACKFILL for either, and both omissions are deliberate. There is no
-- before-image for a write that already happened, and inventing one from the
-- current row would be a revision claiming the document was always what it is
-- now — a lie with a timestamp on it. There is likewise no record of which
-- connection made which change before this table existed. A workspace's history
-- starts the day this deploys.
--
-- One migration for both tables because they ship as one feature: undo joins
-- them by time, and a half-applied pair is worse than either alone.
-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('RESUME', 'ROLE');

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RevisionKind" NOT NULL,
    "recordId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "writtenBy" TEXT NOT NULL DEFAULT 'app',
    "connectionId" TEXT NOT NULL DEFAULT '',
    "connectionName" TEXT NOT NULL DEFAULT '',
    "tool" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL DEFAULT '',
    "connectionName" TEXT NOT NULL DEFAULT '',
    "tool" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "recordId" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WriteLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Revision_userId_kind_recordId_createdAt_idx" ON "Revision"("userId", "kind", "recordId", "createdAt");

-- CreateIndex
CREATE INDEX "Revision_userId_createdAt_idx" ON "Revision"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WriteLog_userId_createdAt_idx" ON "WriteLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WriteLog_userId_kind_recordId_createdAt_idx" ON "WriteLog"("userId", "kind", "recordId", "createdAt");

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteLog" ADD CONSTRAINT "WriteLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

