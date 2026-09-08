-- Deleting becomes archiving.
--
-- Company, Contact and Application each gain a nullable `archivedAt`. Null is
-- live; a timestamp means the row is in the archive, out of every list, picker
-- and filter in the app, and counting down to being destroyed. Every existing
-- row is live, so there is no backfill: NULL is the live value and the columns
-- arrive empty.
--
-- Two columns need explaining.
--
-- Company.archiveKey exists because company names are unique per person, and
-- an archived "Stripe" must not stop somebody tracking a new job at Stripe.
-- Postgres would express that as a partial unique index over live rows only,
-- but Prisma cannot model one, so every future `migrate dev` would offer to
-- drop it as drift. A discriminator column that is "" while live and the row's
-- own id once archived gives the same guarantee in something Prisma can see —
-- the same workaround Tag.key already uses for a functional index.
--
-- Application.archivedWith records which company's archiving swept an
-- application in, so restoring the company brings back exactly those and
-- leaves an application the person had binned separately where they put it.

ALTER TABLE "Company"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archiveKey" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Contact"
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Application"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedWith" TEXT;

CREATE INDEX "Company_userId_archivedAt_idx" ON "Company"("userId", "archivedAt");
CREATE INDEX "Contact_userId_archivedAt_idx" ON "Contact"("userId", "archivedAt");
CREATE INDEX "Application_userId_archivedAt_idx" ON "Application"("userId", "archivedAt");

-- Swap the uniqueness in one file so there is never a window in which two live
-- companies can take the same name. Not CONCURRENTLY: that would take the
-- statement out of the transaction this migration runs in.
DROP INDEX "Company_userId_name_key";
CREATE UNIQUE INDEX "Company_userId_name_archiveKey_key" ON "Company"("userId", "name", "archiveKey");
