-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "brandStory" TEXT NOT NULL,
    "itemStory" TEXT NOT NULL,
    "historicalContext" TEXT NOT NULL,
    "storyScore" DOUBLE PRECISION NOT NULL,
    "storyScoreReasoning" TEXT NOT NULL,
    "combinedScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Story_evaluationId_key" ON "Story"("evaluationId");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
