import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";
import { PrismaClient } from "./generated/prisma/client";
import { fetchListings } from "./services/ecommerce";
import { filterListings } from "./services/filter";
import { evaluateListing } from "./services/evaluate";
import { sendAlert } from "./services/notify";
import { runScan } from "./scan";
import type { ScanConfig } from "./types";

const app = express();
const PORT = process.env.PORT || 3000;
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || "";
const EBAY_ENDPOINT = process.env.EBAY_ENDPOINT || "";

const prisma = new PrismaClient();
const scanConfig: ScanConfig = {
  platform: "ebay",
  maxListings: 20,
  minMargin: 50,
  minConfidence: 0.7,
};

app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, "..", "public")));

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "vintage-searcher" });
});

// eBay marketplace account deletion notification (required for compliance)
// https://developer.ebay.com/marketplace-account-deletion
app.get("/ebay/webhook", (req, res) => {
  const challengeCode = req.query.challenge_code as string;

  if (challengeCode) {
    // eBay verification: hash = SHA256(challenge_code + verification_token + endpoint)
    const hash = crypto
      .createHash("sha256")
      .update(challengeCode)
      .update(EBAY_VERIFICATION_TOKEN)
      .update(EBAY_ENDPOINT)
      .digest("hex");

    console.log("eBay verification challenge received");

    res.set("Content-Type", "application/json");
    res.json({ challengeResponse: hash });
  } else {
    res.json({ status: "webhook endpoint ready" });
  }
});

app.post("/ebay/webhook", (req, res) => {
  // Handle eBay notifications (account deletion, etc.)
  console.log("eBay webhook received:", req.body);
  res.status(200).send("OK");
});

// eBay OAuth callback
app.get("/ebay/auth/callback", (req, res) => {
  const { code, state } = req.query;

  if (code) {
    console.log("eBay OAuth code received");
  } else {
    res.status(400).send("No authorization code received");
  }
});

// --- User & Query Management ---

// List all users
app.get("/users", async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  res.json(users);
});

// Get queries for a user
app.get("/users/:userId/queries", async (req, res) => {
  const queries = await prisma.searchQuery.findMany({
    where: { userId: req.params.userId },
    orderBy: { createdAt: "asc" },
  });
  res.json(queries);
});

// Replace all queries for a user
app.put("/users/:userId/queries", async (req, res) => {
  const { queries } = req.body as { queries: { query: string; count: number; enabled: boolean }[] };
  if (!Array.isArray(queries)) {
    res.status(400).json({ error: "queries array required" });
    return;
  }

  const userId = req.params.userId;
  await prisma.$transaction([
    prisma.searchQuery.deleteMany({ where: { userId } }),
    ...queries.map((q) =>
      prisma.searchQuery.create({
        data: { query: q.query, count: q.count, enabled: q.enabled, userId },
      }),
    ),
  ]);

  const updated = await prisma.searchQuery.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  res.json(updated);
});

// Trigger a scan (runs in background, responds immediately)
app.post("/scan", (req, res) => {
  const userId = req.body?.userId as string | undefined;
  console.log(`Scan triggered via API${userId ? ` for user ${userId}` : ""}`);
  res.json({ status: "ok", message: "Scan started" });

  runScan(scanConfig, {
    prisma,
    fetchListings,
    filterListings,
    evaluateListing,
    sendAlert,
  }, userId).catch((error) => {
    console.error("Scan failed:", error);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`eBay webhook endpoint: ${EBAY_ENDPOINT || "http://localhost:" + PORT + "/ebay/webhook"}`);
});
