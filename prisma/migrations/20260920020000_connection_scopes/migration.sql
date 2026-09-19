-- Scoping a connection to one job.
--
-- NO BACKFILL, deliberately: the column's default is FULL, Postgres writes it
-- into every existing row as part of the ALTER, and FULL is defined in
-- src/lib/mcp/tools.ts as exactly what this server served before this migration
-- existed — the same code path, not a rebuild from the section table. An
-- existing client sees the same tool list, the same briefing and the same
-- behaviour after the deploy as before it.
--
-- FULL is a VALUE, not "no scope". Do not make this column nullable later to
-- mean "unset"; the byte-identical promise above is about the value.
--
-- ADD COLUMN ... NOT NULL DEFAULT does not rewrite the table on PG 11+, so this
-- is instant on any instance.

-- CreateEnum
CREATE TYPE "McpScope" AS ENUM ('FULL', 'WRITING', 'PIPELINE', 'READONLY');

-- AlterTable
ALTER TABLE "McpConnection" ADD COLUMN     "scope" "McpScope" NOT NULL DEFAULT 'FULL';
