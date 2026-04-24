-- Remove per-user scoping from FilteredListing — listings are now global

-- Drop foreign key and old composite unique
ALTER TABLE "FilteredListing" DROP CONSTRAINT IF EXISTS "FilteredListing_userId_fkey";
ALTER TABLE "FilteredListing" DROP CONSTRAINT IF EXISTS "FilteredListing_userId_url_key";
DROP INDEX IF EXISTS "FilteredListing_userId_url_key";

-- Deduplicate: delete stories → evaluations → duplicate listings (keep oldest per URL)
DELETE FROM "Story"
WHERE "evaluationId" IN (
  SELECT e.id FROM "Evaluation" e
  WHERE e."listingId" IN (
    SELECT id FROM "FilteredListing"
    WHERE id NOT IN (
      SELECT DISTINCT ON (url) id FROM "FilteredListing" ORDER BY url, "createdAt" ASC
    )
  )
);

DELETE FROM "Evaluation"
WHERE "listingId" IN (
  SELECT id FROM "FilteredListing"
  WHERE id NOT IN (
    SELECT DISTINCT ON (url) id FROM "FilteredListing" ORDER BY url, "createdAt" ASC
  )
);

DELETE FROM "FilteredListing"
WHERE id NOT IN (
  SELECT DISTINCT ON (url) id FROM "FilteredListing" ORDER BY url, "createdAt" ASC
);

-- Add unique constraint on url alone
CREATE UNIQUE INDEX "FilteredListing_url_key" ON "FilteredListing"("url");

-- Drop userId column
ALTER TABLE "FilteredListing" DROP COLUMN "userId";
