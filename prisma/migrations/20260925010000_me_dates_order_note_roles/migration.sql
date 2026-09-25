-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "roleId" TEXT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "roleOrder" TEXT NOT NULL DEFAULT 'date';

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "backgroundUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "endUnconfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startUnconfirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Note_userId_roleId_idx" ON "Note"("userId", "roleId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: until now the only record of when a background was written was
-- updatedAt, which is the best estimate there is for rows that already exist.
UPDATE "Role" SET "backgroundUpdatedAt" = "updatedAt";
