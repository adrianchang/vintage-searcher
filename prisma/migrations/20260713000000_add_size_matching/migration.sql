-- User size profile (men's/unisex) — all optional
ALTER TABLE "User" ADD COLUMN "topSize" TEXT;
ALTER TABLE "User" ADD COLUMN "waistSize" INTEGER;
ALTER TABLE "User" ADD COLUMN "pitToPitInches" DOUBLE PRECISION;

-- Size extraction on evaluations (null on rows evaluated before this existed)
ALTER TABLE "Evaluation" ADD COLUMN "garmentType" TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "labeledSize" TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "pitToPitInches" DOUBLE PRECISION;
ALTER TABLE "Evaluation" ADD COLUMN "waistInches" DOUBLE PRECISION;
ALTER TABLE "Evaluation" ADD COLUMN "sizeConfidence" DOUBLE PRECISION;
ALTER TABLE "Evaluation" ADD COLUMN "sizeEvidence" TEXT;
