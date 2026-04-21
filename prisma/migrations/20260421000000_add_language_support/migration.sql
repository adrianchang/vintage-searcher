-- Add language preference to User
ALTER TABLE "User" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';

-- Add language to Story and change unique constraint
ALTER TABLE "Story" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Story" DROP CONSTRAINT "Story_evaluationId_key";
ALTER TABLE "Story" ADD CONSTRAINT "Story_evaluationId_language_key" UNIQUE ("evaluationId", "language");
