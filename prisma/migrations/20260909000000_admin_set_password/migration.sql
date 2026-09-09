-- Letting an admin choose the password, and hand it back afterwards.
--
-- Two halves of one idea. An invitation can carry a password the inviter picked
-- instead of asking the invitee to invent one, and a reset can set a chosen
-- password instead of a generated passphrase. Either way the admin now knows a
-- password that opens somebody else's workspace, so both can be marked
-- "must change" — the flag lives on User because that is where the gate reads
-- it, and on Invite because the invitation is written before the User exists.
--
-- Every existing row is false and empty, which is exactly the behaviour every
-- existing account and outstanding invitation already had.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invite" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Invite" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
