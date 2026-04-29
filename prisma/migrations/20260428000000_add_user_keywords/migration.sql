CREATE TABLE "UserKeyword" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserKeyword_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserKeyword_userId_query_key" ON "UserKeyword"("userId", "query");

ALTER TABLE "UserKeyword" ADD CONSTRAINT "UserKeyword_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
