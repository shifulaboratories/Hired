-- Outbound mail: a weekly summary and a due-today nudge.
--
-- Off for everybody until they turn it on. Nothing in this app has ever sent a
-- person mail they did not ask for, and a default of true would make the first
-- upgrade after this migration the day that changed.
--
-- The two "last sent" columns are civil DAY strings in the person's own zone,
-- not timestamps. The question the sweep asks is "have they had today's yet",
-- which is a question about their calendar — and storing the answer that way is
-- what makes the sweep safe to run hourly, or twice by accident.
ALTER TABLE "Profile"
  ADD COLUMN "weeklyDigest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dailyNudge"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "digestHour"   INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "lastDigestOn" TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "lastNudgeOn"  TEXT    NOT NULL DEFAULT '';
