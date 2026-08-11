-- Background-removed hero image (gray studio backdrop)
ALTER TABLE "Evaluation" ADD COLUMN "heroImageBytes" BYTEA;
ALTER TABLE "Evaluation" ADD COLUMN "heroImageMimeType" TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "hasProcessedImage" BOOLEAN NOT NULL DEFAULT false;
