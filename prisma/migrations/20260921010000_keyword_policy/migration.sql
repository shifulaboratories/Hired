-- How close to a posting's own words a document may get, and the transfers a
-- person has recorded. No backfill: MATCH is the default and it is what every
-- existing account already got in practice — a writer with no stated policy
-- used the posting's vocabulary for work that was on file, because there was
-- never a rule against it. STRICT is the new behaviour, opted into.
-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "keywordPolicy" TEXT NOT NULL DEFAULT 'MATCH';

-- CreateTable
CREATE TABLE "TransferableSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "have" TEXT NOT NULL,
    "covers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferableSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransferableSkill_userId_idx" ON "TransferableSkill"("userId");

-- AddForeignKey
ALTER TABLE "TransferableSkill" ADD CONSTRAINT "TransferableSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

