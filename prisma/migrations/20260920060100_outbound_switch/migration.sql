-- The switch that turns sending on, and the only thing that does.
--
-- Split from 20260920060000_outbound only because that one was already applied
-- locally when these two columns were written; they belong to the same feature
-- and there is no ordering dependency between them.
--
-- BOTH DEFAULTS ARE THE SAFETY STORY. outboundDailyLimit defaults to 0, which
-- means "this app will not send on my behalf at all", and outboundApproval
-- defaults to "each", which means every message waits for a click in the app
-- that no MCP tool can make. Every existing account therefore lands OFF and in
-- the strictest mode with no backfill. A default of anything else would turn
-- sending on for everybody at deploy. Do not "helpfully" backfill a limit.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "outboundApproval" TEXT NOT NULL DEFAULT 'each',
ADD COLUMN     "outboundDailyLimit" INTEGER NOT NULL DEFAULT 0;

