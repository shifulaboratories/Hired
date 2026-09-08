-- A task can be about almost anything, not only an application.
--
-- Five nullable foreign keys rather than a polymorphic (kind, id) pair: the
-- pair cannot be enforced, so deleting a resume would leave tasks pointing at
-- an id nothing resolves. These cascade, which is what applicationId already
-- did and what a person expects — delete the thing, its reminders go with it.
--
-- At most one is set, which the data layer enforces on the way in. Nothing here
-- does: a CHECK across five columns is a constraint every future subject has to
-- remember to extend, and the reader takes the first one it finds anyway.
ALTER TABLE "Task" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Task" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Task" ADD COLUMN "resumeId" TEXT;
ALTER TABLE "Task" ADD COLUMN "roleId" TEXT;
ALTER TABLE "Task" ADD COLUMN "noteId" TEXT;

CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");
CREATE INDEX "Task_contactId_idx" ON "Task"("contactId");
CREATE INDEX "Task_resumeId_idx" ON "Task"("resumeId");
CREATE INDEX "Task_roleId_idx" ON "Task"("roleId");
CREATE INDEX "Task_noteId_idx" ON "Task"("noteId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_resumeId_fkey"
  FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
