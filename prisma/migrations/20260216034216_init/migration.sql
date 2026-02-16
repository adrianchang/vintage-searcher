-- CreateTable
CREATE TABLE "FilteredListing" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "imageUrls" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rawData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilteredListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "isAuthentic" BOOLEAN NOT NULL,
    "estimatedEra" TEXT,
    "estimatedValue" DOUBLE PRECISION,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "redFlags" TEXT NOT NULL,
    "references" TEXT NOT NULL,
    "isOpportunity" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilteredListing_url_key" ON "FilteredListing"("url");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_listingId_key" ON "Evaluation"("listingId");

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "FilteredListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
