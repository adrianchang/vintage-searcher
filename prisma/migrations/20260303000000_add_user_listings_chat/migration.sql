-- AlterTable: Add userId column as nullable first
ALTER TABLE "FilteredListing" ADD COLUMN "userId" TEXT;

-- Backfill existing listings to Adrian's user
UPDATE "FilteredListing" SET "userId" = (SELECT "id" FROM "User" WHERE "name" = 'Adrian' LIMIT 1);

-- Make userId NOT NULL after backfill
ALTER TABLE "FilteredListing" ALTER COLUMN "userId" SET NOT NULL;

-- Drop the old unique index on url
DROP INDEX "FilteredListing_url_key";

-- Add composite unique index
CREATE UNIQUE INDEX "FilteredListing_userId_url_key" ON "FilteredListing"("userId", "url");

-- Add foreign key
ALTER TABLE "FilteredListing" ADD CONSTRAINT "FilteredListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: ChatMessage
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "FilteredListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
