-- Full-text indexes for search_me.
--
-- `english` is a built-in text search configuration, not an extension, so this
-- adds nothing for a self-hoster to install and DATABASE_URL is still the only
-- variable. Expression indexes rather than stored tsvector columns: Prisma does
-- not model a tsvector, and an unmodelled column would show as schema drift
-- forever. An expression index does not.
--
-- `array_to_string` is not marked IMMUTABLE, so Postgres refuses it inside an
-- index expression. hired_words is a one-line immutable wrapper over exactly
-- that call; searchMe uses the same function, so the two expressions match.
--
-- Each expression is the one searchMe puts in its WHERE clause, character for
-- character. If the two ever drift apart the index simply goes unused — the
-- search still returns the right answer, just more slowly — which is the right
-- failure mode for an optimisation nothing verifies.
--
-- On a small account the planner will often prefer the existing userId index
-- and recompute the vector for the handful of rows it finds. That is fine and
-- expected; these earn their keep on the person with four hundred highlights.
CREATE FUNCTION hired_words(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT array_to_string($1, ' ') $$;

CREATE INDEX "Profile_search_idx" ON "Profile" USING GIN (
  to_tsvector('english',
    coalesce("fullName", '') || ' ' || coalesce("headline", '') || ' ' ||
    coalesce("summary", '') || ' ' || coalesce("brainDump", ''))
);

CREATE INDEX "Role_search_idx" ON "Role" USING GIN (
  to_tsvector('english',
    coalesce("company", '') || ' ' || coalesce("title", '') || ' ' ||
    coalesce("summary", '') || ' ' || coalesce("brainDump", '') || ' ' ||
    hired_words("tags"))
);

CREATE INDEX "Highlight_search_idx" ON "Highlight" USING GIN (
  to_tsvector('english',
    coalesce("text", '') || ' ' || coalesce("impact", '') || ' ' ||
    hired_words("tags"))
);

CREATE INDEX "Note_search_idx" ON "Note" USING GIN (
  to_tsvector('english',
    coalesce("title", '') || ' ' || coalesce("body", '') || ' ' ||
    hired_words("tags"))
);

CREATE INDEX "Project_search_idx" ON "Project" USING GIN (
  to_tsvector('english',
    coalesce("name", '') || ' ' || coalesce("role", '') || ' ' ||
    coalesce("description", '') || ' ' || coalesce("brainDump", '') || ' ' ||
    hired_words("tags"))
);
