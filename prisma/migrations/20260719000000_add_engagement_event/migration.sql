-- Implicit engagement events: eBay-button clicks via /go (future: Resend webhook events)
CREATE TABLE "EngagementEvent" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "storyId"   TEXT,
  "type"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EngagementEvent_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EngagementEvent_storyId_fkey" FOREIGN KEY ("storyId")
    REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "EngagementEvent_userId_type_idx" ON "EngagementEvent"("userId", "type");
