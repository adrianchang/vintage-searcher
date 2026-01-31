-- CreateTable
CREATE TABLE "FilteredListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "imageUrls" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rawData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "isAuthentic" BOOLEAN NOT NULL,
    "estimatedEra" TEXT NOT NULL,
    "estimatedValue" REAL NOT NULL,
    "currentPrice" REAL NOT NULL,
    "margin" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "reasoning" TEXT NOT NULL,
    "redFlags" TEXT NOT NULL,
    "references" TEXT NOT NULL,
    "isOpportunity" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evaluation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "FilteredListing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FilteredListing_url_key" ON "FilteredListing"("url");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_listingId_key" ON "Evaluation"("listingId");
