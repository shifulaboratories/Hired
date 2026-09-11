-- The review queue: things an assistant thinks should happen, waiting for a yes.
--
-- inbox_review reads a week of mail and finds six things the pipeline does not
-- know. Until now, approving them meant being in the conversation when it asked.
-- These are the same six waiting on the dashboard, each carrying the line of
-- evidence that produced it.
--
-- payload is the arguments of the one data call the proposal becomes. It is
-- written by an assistant, so it is validated on the way in and again on the way
-- out; every call it can turn into takes the owner's userId as its first
-- argument, which is what stops a payload reaching another account.
--
-- The links CASCADE rather than SET NULL, unlike Letter's: a proposal about an
-- application that no longer exists is not a record of anything, it is a row
-- that would fail on accept.
CREATE TYPE "ProposalKind" AS ENUM ('LOG_ACTIVITY', 'MOVE_STAGE', 'CREATE_TASK', 'SET_FOLLOW_UP', 'CREATE_CONTACT');
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "applicationId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Proposal_userId_status_idx" ON "Proposal"("userId", "status");
CREATE INDEX "Proposal_applicationId_idx" ON "Proposal"("applicationId");
CREATE INDEX "Proposal_contactId_idx" ON "Proposal"("contactId");

ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
