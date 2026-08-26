-- AlterTable: add batchId as nullable first, backfill, then enforce NOT NULL.
-- Historical rows (predating this migration) are backfilled to a deterministic
-- userId+day value, reconstructing the one-batch-per-day reality that held
-- before this column existed (only one scan ran per user per day).
ALTER TABLE "StoryDelivery" ADD COLUMN "batchId" TEXT;
UPDATE "StoryDelivery" SET "batchId" = "userId" || ':' || to_char("sentAt", 'YYYY-MM-DD') WHERE "batchId" IS NULL;
ALTER TABLE "StoryDelivery" ALTER COLUMN "batchId" SET NOT NULL;

ALTER TABLE "TryOn" ADD COLUMN "batchId" TEXT;
UPDATE "TryOn" SET "batchId" = "userId" || ':' || to_char("createdAt", 'YYYY-MM-DD') WHERE "batchId" IS NULL;
ALTER TABLE "TryOn" ALTER COLUMN "batchId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "TryOn_userId_batchId_idx" ON "TryOn"("userId", "batchId");
