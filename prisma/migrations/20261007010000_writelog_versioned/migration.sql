-- Which change-log rows can be undone, declared by the tool that wrote them.
ALTER TABLE "WriteLog" ADD COLUMN "versioned" BOOLEAN NOT NULL DEFAULT false;

-- The rows already logged by the tools that take a version before they write.
UPDATE "WriteLog" SET "versioned" = true
WHERE "tool" IN (
  'update_role', 'append_role_background', 'update_resume', 'log_win',
  'restore_revision', 'undo_change'
);
