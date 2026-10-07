-- Two corrections to history the stage-move code wrote wrongly, now that it
-- writes them rightly.

-- A wishlist row was never sent. Moving one back to WISHLIST used to keep the
-- date it was first moved past it, so the funnel went on counting it as
-- applied while the board said wishlist.
UPDATE "Application" SET "appliedAt" = NULL
WHERE "stage" = 'WISHLIST' AND "appliedAt" IS NOT NULL;

-- Every move to LOST was logged as the employer's REJECTION, whatever the
-- reason, so a ghosted row read as answered on the day somebody gave up on it.
-- Only the stage-move rows (toStage = LOST) are touched: a rejection somebody
-- logged by hand has no toStage and stays exactly as written. A row whose
-- application wears the "Rejected" loss reason keeps its type.
UPDATE "Activity" a SET "type" = 'STAGE_CHANGE'
WHERE a."type" = 'REJECTION'
  AND a."toStage" = 'LOST'
  AND NOT EXISTS (
    SELECT 1 FROM "ApplicationTag" at
    JOIN "Tag" t ON t."id" = at."tagId"
    WHERE at."applicationId" = a."applicationId"
      AND t."kind" = 'LOSS'
      AND t."key" = 'rejected'
  );
