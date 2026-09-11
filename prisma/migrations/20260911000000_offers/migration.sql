-- What someone actually offered, as rows rather than columns on Application.
--
-- Rows because offers get revised, and the movement between the first number
-- and the last is the negotiation record. See the model's own comment.
--
-- Nothing is backfilled from Application.salaryRange, deliberately. That column
-- holds what the POSTING advertised, in the posting's words — "$210k – $260k",
-- "competitive", or nothing. Parsing it would take the first number it sees and
-- write a base salary nobody agreed to, onto rows a person would then put in a
-- comparison table and make a decision from. The two facts stay apart.
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "baseAmount" INTEGER NOT NULL DEFAULT 0,
    "bonusAmount" INTEGER NOT NULL DEFAULT 0,
    "equityAmount" INTEGER NOT NULL DEFAULT 0,
    "signOnAmount" INTEGER NOT NULL DEFAULT 0,
    "terms" TEXT NOT NULL DEFAULT '',
    "vesting" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondBy" TIMESTAMP(3),
    "startsOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Offer_userId_idx" ON "Offer"("userId");
CREATE INDEX "Offer_applicationId_idx" ON "Offer"("applicationId");
-- The deadline query the bell and list_schedule run.
CREATE INDEX "Offer_userId_respondBy_idx" ON "Offer"("userId", "respondBy");

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
