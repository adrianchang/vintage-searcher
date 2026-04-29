-- Drop FK constraint from Evaluation to FilteredListing
ALTER TABLE "Evaluation" DROP CONSTRAINT IF EXISTS "Evaluation_listingId_fkey";

-- Add url column to Evaluation, populate from FilteredListing join, then make NOT NULL unique
ALTER TABLE "Evaluation" ADD COLUMN "url" TEXT;
UPDATE "Evaluation" e SET "url" = fl."url" FROM "FilteredListing" fl WHERE fl."id" = e."listingId";
ALTER TABLE "Evaluation" ALTER COLUMN "url" SET NOT NULL;
CREATE UNIQUE INDEX "Evaluation_url_key" ON "Evaluation"("url");

-- Drop old listingId column and FilteredListing table
ALTER TABLE "Evaluation" DROP COLUMN "listingId";
DROP TABLE "FilteredListing";
