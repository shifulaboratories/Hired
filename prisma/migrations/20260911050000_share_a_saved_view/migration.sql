-- One share row per thing shared, instead of one per person.
--
-- "Everything I have from a referral" is a reasonable thing to show a friend;
-- the whole board is not. So a link can now point at a saved view.
--
-- Nothing moves. An existing row already has savedViewId NULL and, once the
-- column lands with its default, shareKey '' — which is exactly what "the whole
-- pipeline" means. No backfill, and none that could be got wrong.
--
-- shareKey is the discriminator rather than a partial unique index. Postgres
-- treats NULLs as distinct, so a unique on (userId, savedViewId) would let one
-- person hold two whole-pipeline links; Prisma cannot express `WHERE savedViewId
-- IS NULL`, and an index living only in a migration is invisible to the next
-- reader. Company.archiveKey and Tag.key already took this trade.
--
-- The foreign key CASCADES rather than SET NULL, and that is a security choice:
-- SET NULL would silently promote a link showing four applications into one
-- showing the entire search, as a side effect of deleting something else.
DROP INDEX "PipelineShare_userId_key";

ALTER TABLE "PipelineShare"
  ADD COLUMN "savedViewId" TEXT,
  ADD COLUMN "shareKey"    TEXT NOT NULL DEFAULT '';

ALTER TABLE "PipelineShare" ADD CONSTRAINT "PipelineShare_savedViewId_fkey"
  FOREIGN KEY ("savedViewId") REFERENCES "SavedView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PipelineShare_userId_shareKey_key" ON "PipelineShare"("userId", "shareKey");
CREATE INDEX "PipelineShare_userId_idx" ON "PipelineShare"("userId");
CREATE INDEX "PipelineShare_savedViewId_idx" ON "PipelineShare"("savedViewId");
