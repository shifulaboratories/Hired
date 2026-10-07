-- search_me no longer reads the profile's own background: it is the person's
-- private positioning ("not for the resume"), and a full-text excerpt of it came
-- back looking like evidence. The index expression has to match searchMe's
-- WHERE clause character for character, so it is rebuilt without the column.
DROP INDEX IF EXISTS "Profile_search_idx";

CREATE INDEX "Profile_search_idx" ON "Profile" USING GIN (
  to_tsvector('english',
    coalesce("fullName", '') || ' ' || coalesce("headline", '') || ' ' ||
    coalesce("summary", ''))
);
