-- Stored column widths, per list, on the profile.
--
-- Defaulted rather than nullable so every existing row reads as "{}" — which
-- the catalogue treats as "every column at its default width", the same way an
-- empty boardFields means "the default set of fields".
ALTER TABLE "Profile" ADD COLUMN "columnWidths" JSONB NOT NULL DEFAULT '{}';
