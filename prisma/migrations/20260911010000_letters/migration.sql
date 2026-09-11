-- Everything you write that is not a resume: cover letters, cold outreach,
-- referral asks, thank-yous, replies.
--
-- Its own table rather than a kind on Resume. A resume is a structured document
-- whose shape the renderer and half the tools depend on (src/lib/resume-schema.ts);
-- prose in that shape would break the contract for both, and a resume's
-- template, accent, margins and page count all mean nothing for a letter.
--
-- All three links are SET NULL. Destroying an application must not destroy what
-- you wrote to them — that is a record of what you said, and it is yours.
CREATE TYPE "LetterKind" AS ENUM ('COVER_LETTER', 'OUTREACH', 'REFERRAL_ASK', 'THANK_YOU', 'REPLY', 'OTHER');

CREATE TABLE "Letter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LetterKind" NOT NULL DEFAULT 'COVER_LETTER',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT NOT NULL DEFAULT '',
    "applicationId" TEXT,
    "contactId" TEXT,
    "resumeId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Letter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Letter_userId_idx" ON "Letter"("userId");
CREATE INDEX "Letter_userId_kind_idx" ON "Letter"("userId", "kind");
CREATE INDEX "Letter_applicationId_idx" ON "Letter"("applicationId");
CREATE INDEX "Letter_contactId_idx" ON "Letter"("contactId");

ALTER TABLE "Letter" ADD CONSTRAINT "Letter_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_resumeId_fkey"
    FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
