-- Which optional fields each pipeline view draws.
--
-- Three scalar string lists on Profile, defaulting to empty. Empty means "the
-- default set for that view", not "draw nothing" — so every existing account
-- looks exactly as it did, and a field added to a catalogue later appears for
-- everybody rather than hiding behind a stored list that predates it.

ALTER TABLE "Profile"
  ADD COLUMN "boardFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "listFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "calendarFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
