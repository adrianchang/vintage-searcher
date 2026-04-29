CREATE TABLE "StoryDelivery" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "sentAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StoryDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoryDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StoryDelivery_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StoryDelivery_userId_evaluationId_key" ON "StoryDelivery"("userId", "evaluationId");
