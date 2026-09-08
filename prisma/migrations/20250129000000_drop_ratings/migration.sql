-- Excitement and fit are gone.
--
-- Two 1-5 ratings on every application, defaulted to 3, which meant a pipeline
-- of thirty was thirty threes: a number that looks like data, sorts, filters
-- and says nothing. Dropping rather than hiding, because a column no screen can
-- write and no tool should suggest is a column that rots.
--
-- Irreversible, and deliberately so. Anything actually rated is in the notes or
-- the timeline, which is where a judgement belongs.
ALTER TABLE "Application" DROP COLUMN "excitement";
ALTER TABLE "Application" DROP COLUMN "fit";
