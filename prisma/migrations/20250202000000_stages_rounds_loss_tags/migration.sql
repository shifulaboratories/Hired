-- Ten stages become six.
--
-- SCREEN, INTERVIEW and FINAL were three columns for one thing — talking to
-- them — so they become INTERVIEWING, and how deep you are becomes a number.
-- The three names are kept as the round's label, because "Final round" is a
-- fact about an application that nobody typed twice.
--
-- REJECTED, WITHDRAWN and GHOSTED become LOST, and why becomes a LOSS tag: a
-- row the person owns, can rename, recolour and delete. Every account that had
-- one of those endings gets the matching tag created and attached, so nothing
-- that was recorded is lost in the rename.

-- 1. The two new columns, before anything reads them.
ALTER TABLE "Application" ADD COLUMN "interviewRound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Application" ADD COLUMN "roundLabel" TEXT NOT NULL DEFAULT '';

-- 2. Rounds and labels, from the stage each application is in right now.
UPDATE "Application" SET "interviewRound" = 1, "roundLabel" = 'Phone screen' WHERE "stage" = 'SCREEN';
UPDATE "Application" SET "interviewRound" = 2, "roundLabel" = 'Interview'    WHERE "stage" = 'INTERVIEW';
UPDATE "Application" SET "interviewRound" = 3, "roundLabel" = 'Final round'  WHERE "stage" = 'FINAL';

-- An application that ENDED after interviews kept no record of how far it got
-- in its stage, only in its timeline. The furthest interview stage it was ever
-- moved to is in Activity."toStage", which is what the funnel has always read.
UPDATE "Application" a
SET "interviewRound" = f.round
FROM (
  SELECT "applicationId",
         MAX(CASE "toStage"
               WHEN 'SCREEN' THEN 1
               WHEN 'INTERVIEW' THEN 2
               WHEN 'FINAL' THEN 3
             END) AS round
  FROM "Activity"
  WHERE "toStage" IN ('SCREEN', 'INTERVIEW', 'FINAL') AND "applicationId" IS NOT NULL
  GROUP BY "applicationId"
) f
WHERE a."id" = f."applicationId" AND a."interviewRound" < f.round;

-- 3. LOSS joins the tag kinds.
--
-- A new type rather than ALTER TYPE ... ADD VALUE: Prisma runs a migration in
-- one transaction, and Postgres refuses to USE an enum value added in the
-- transaction that added it. Swapping the type sidesteps that, and it is the
-- same move step 5 has to make anyway.
CREATE TYPE "TagKind_new" AS ENUM (
  'APPLICATION', 'COMPANY', 'CONTACT', 'INDUSTRY', 'SIZE', 'LOCATION', 'LOSS'
);
ALTER TABLE "Tag" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "Tag" ALTER COLUMN "kind" TYPE "TagKind_new" USING ("kind"::text::"TagKind_new");
ALTER TABLE "Tag" ALTER COLUMN "kind" SET DEFAULT 'APPLICATION';
DROP TYPE "TagKind";
ALTER TYPE "TagKind_new" RENAME TO "TagKind";

-- 4. The reason each ending had, as a tag the person now owns.
--
-- One tag per user per reason, and only for reasons they have actually used —
-- nobody gets a "Ghosted" row for an ending that never happened to them. The
-- key is lower(trim(name)), which is what the unique index is on.
INSERT INTO "Tag" ("id", "userId", "kind", "name", "key", "color", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  reasons."userId",
  'LOSS',
  reasons.name,
  reasons.key,
  reasons.color,
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT
    a."userId",
    CASE a."stage" WHEN 'REJECTED' THEN 'Rejected' WHEN 'WITHDRAWN' THEN 'Withdrew' ELSE 'Ghosted' END AS name,
    CASE a."stage" WHEN 'REJECTED' THEN 'rejected' WHEN 'WITHDRAWN' THEN 'withdrew' ELSE 'ghosted' END AS key,
    CASE a."stage" WHEN 'REJECTED' THEN 'red'      WHEN 'WITHDRAWN' THEN 'slate'   ELSE 'amber'   END AS color
  FROM "Application" a
  WHERE a."stage" IN ('REJECTED', 'WITHDRAWN', 'GHOSTED')
) reasons
WHERE NOT EXISTS (
  SELECT 1 FROM "Tag" t
  WHERE t."userId" = reasons."userId" AND t."kind" = 'LOSS' AND t."key" = reasons.key
);

INSERT INTO "ApplicationTag" ("applicationId", "tagId", "createdAt")
SELECT a."id", t."id", NOW()
FROM "Application" a
JOIN "Tag" t
  ON t."userId" = a."userId"
 AND t."kind" = 'LOSS'
 AND t."key" = CASE a."stage"
                 WHEN 'REJECTED' THEN 'rejected'
                 WHEN 'WITHDRAWN' THEN 'withdrew'
                 ELSE 'ghosted'
               END
WHERE a."stage" IN ('REJECTED', 'WITHDRAWN', 'GHOSTED')
ON CONFLICT DO NOTHING;

-- 5. Ten stages become six, everywhere the type is used.
CREATE TYPE "Stage_new" AS ENUM (
  'WISHLIST', 'APPLIED', 'INTERVIEWING', 'OFFER', 'ACCEPTED', 'LOST'
);

ALTER TABLE "Application" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Application" ALTER COLUMN "stage" TYPE "Stage_new" USING (
  CASE "stage"::text
    WHEN 'SCREEN'    THEN 'INTERVIEWING'
    WHEN 'INTERVIEW' THEN 'INTERVIEWING'
    WHEN 'FINAL'     THEN 'INTERVIEWING'
    WHEN 'REJECTED'  THEN 'LOST'
    WHEN 'WITHDRAWN' THEN 'LOST'
    WHEN 'GHOSTED'   THEN 'LOST'
    ELSE "stage"::text
  END
)::"Stage_new";
ALTER TABLE "Application" ALTER COLUMN "stage" SET DEFAULT 'WISHLIST';

-- The timeline is rewritten the same way. A move recorded as
-- "Screening -> Interviewing" is now "Interviewing -> Interviewing", which is
-- not a move: those rows keep their body and lose their stage columns, so the
-- funnel does not count a transition that no longer exists.
ALTER TABLE "Activity" ALTER COLUMN "fromStage" TYPE "Stage_new" USING (
  CASE "fromStage"::text
    WHEN 'SCREEN'    THEN 'INTERVIEWING'
    WHEN 'INTERVIEW' THEN 'INTERVIEWING'
    WHEN 'FINAL'     THEN 'INTERVIEWING'
    WHEN 'REJECTED'  THEN 'LOST'
    WHEN 'WITHDRAWN' THEN 'LOST'
    WHEN 'GHOSTED'   THEN 'LOST'
    ELSE "fromStage"::text
  END
)::"Stage_new";
ALTER TABLE "Activity" ALTER COLUMN "toStage" TYPE "Stage_new" USING (
  CASE "toStage"::text
    WHEN 'SCREEN'    THEN 'INTERVIEWING'
    WHEN 'INTERVIEW' THEN 'INTERVIEWING'
    WHEN 'FINAL'     THEN 'INTERVIEWING'
    WHEN 'REJECTED'  THEN 'LOST'
    WHEN 'WITHDRAWN' THEN 'LOST'
    WHEN 'GHOSTED'   THEN 'LOST'
    ELSE "toStage"::text
  END
)::"Stage_new";

UPDATE "Activity"
SET "fromStage" = NULL, "toStage" = NULL
WHERE "fromStage" IS NOT NULL AND "fromStage" = "toStage";

DROP TYPE "Stage";
ALTER TYPE "Stage_new" RENAME TO "Stage";
