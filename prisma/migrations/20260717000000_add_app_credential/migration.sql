-- Self-refreshing credential store (Threads access token etc.)
CREATE TABLE "AppCredential" (
  "key"       TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppCredential_pkey" PRIMARY KEY ("key")
);
