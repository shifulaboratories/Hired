-- When somebody last finished or skipped the welcome tour. Null = never seen it,
-- which is every account that existed before this column did: they all get the
-- tour once, which is the right answer for a feature whose whole job is to
-- explain what the app is.
ALTER TABLE "Profile" ADD COLUMN "tourSeenAt" TIMESTAMP(3);
