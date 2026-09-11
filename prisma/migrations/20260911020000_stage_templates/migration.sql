-- Stage checklists: "when a job reaches this stage, add these tasks".
--
-- Rows a person owns, not a built-in list. Every search has its own ritual, and
-- a fixed set of steps would be wrong for all of them. Nothing is seeded here —
-- seed_stage_templates offers a starting set, and only when somebody asks.
--
-- Task.stageTemplateId is SET NULL rather than cascade on purpose: deleting the
-- checklist line must not delete the task it already made. That task is work in
-- progress; the template is a setting.
CREATE TABLE "StageTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "dueInDays" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StageTemplate_userId_stage_idx" ON "StageTemplate"("userId", "stage");

ALTER TABLE "StageTemplate" ADD CONSTRAINT "StageTemplate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task" ADD COLUMN "stageTemplateId" TEXT;

-- The dedupe read: "has this checklist line already fired for this job".
CREATE INDEX "Task_applicationId_stageTemplateId_idx" ON "Task"("applicationId", "stageTemplateId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_stageTemplateId_fkey"
    FOREIGN KEY ("stageTemplateId") REFERENCES "StageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
