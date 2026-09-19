-- The sample search, and the manifest that makes wiping it exact.
--
-- NO BACKFILL, and none is possible: an existing workspace has no sample, which
-- is correct. There is deliberately no `isSample` column on the nine content
-- models this writes to — that would be nine columns every future read has to
-- remember to ignore, and it would still be wrong the moment somebody
-- duplicates a sample resume, because the copy would carry the flag.

-- CreateTable
CREATE TABLE "SampleLoad" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "fixture" TEXT NOT NULL DEFAULT '',
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleLoad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SampleLoad_userId_key" ON "SampleLoad"("userId");

-- AddForeignKey
ALTER TABLE "SampleLoad" ADD CONSTRAINT "SampleLoad_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

