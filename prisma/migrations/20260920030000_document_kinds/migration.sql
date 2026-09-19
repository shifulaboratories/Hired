-- Four more things a person writes, and none of them is a letter to anybody.
--
-- Postgres 16. ALTER TYPE ... ADD VALUE is allowed inside the transaction
-- Prisma wraps each migration in, on 12 and later, as long as nothing in the
-- SAME transaction USES the new value. Nothing here does: this file adds values
-- and stops. Do not add a backfill to it — put one in its own migration if it
-- is ever needed.
--
-- No backfill, and none is possible: every existing row keeps the kind it has,
-- and no read changes meaning. `recipient` and `sentAt` simply stay empty on
-- the four new kinds, which is what their defaults already are.

-- AlterEnum
ALTER TYPE "LetterKind" ADD VALUE 'LINKEDIN_ABOUT';
ALTER TYPE "LetterKind" ADD VALUE 'HEADLINE';
ALTER TYPE "LetterKind" ADD VALUE 'SELF_REVIEW';
ALTER TYPE "LetterKind" ADD VALUE 'BRAG_DOC';
