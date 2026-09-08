-- The reader's own calendar. Empty means the host's clock, which is what every
-- existing row gets and what every account behaved as before this column.
ALTER TABLE "Profile" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT '';
