-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hasPhoto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photoBytes" BYTEA,
ADD COLUMN     "photoMimeType" TEXT;

-- CreateTable
CREATE TABLE "TryOn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "imageBytes" BYTEA,
    "imageMimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TryOn_userId_createdAt_idx" ON "TryOn"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TryOn" ADD CONSTRAINT "TryOn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOn" ADD CONSTRAINT "TryOn_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
