-- Manual role order was cut: date order is how resumes and recruiters read a
-- career, and grouping by kind of role answers the reason it was added. The
-- column shipped in 20260925010000, so it is dropped here rather than edited
-- out of that migration.
ALTER TABLE "Profile" DROP COLUMN "roleOrder";
