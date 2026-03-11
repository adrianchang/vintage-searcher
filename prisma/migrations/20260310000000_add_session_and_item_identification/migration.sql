-- CreateTable (baseline: already exists from connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
    "sid" VARCHAR NOT NULL,
    "sess" JSONB NOT NULL,
    "expire" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex (baseline: already exists)
CREATE INDEX IF NOT EXISTS "session_expire_idx" ON "session"("expire");

-- AlterTable: Add item identification fields to Evaluation
ALTER TABLE "Evaluation" ADD COLUMN "itemIdentification" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Evaluation" ADD COLUMN "identificationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0;
