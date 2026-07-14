-- Raw Gemini sizing block (pre-normalization, incl. evidenceQuote) for auditing
ALTER TABLE "Evaluation" ADD COLUMN "sizeRaw" TEXT NOT NULL DEFAULT '{}';
