CREATE TABLE "UserArchetype" (
  "id"          TEXT        NOT NULL,
  "userId"      TEXT        NOT NULL,
  "archetypeId" TEXT        NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserArchetype_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserArchetype_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserArchetype_userId_archetypeId_key"
  ON "UserArchetype"("userId", "archetypeId");
