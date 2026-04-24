import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";
import { PrismaClient } from "./generated/prisma/client";
import { fetchListings } from "./services/ecommerce";
import { filterListings } from "./services/filter";
import { evaluateListing } from "./services/evaluate";
import { runScan } from "./scan";
import type { ScanConfig } from "./types";

const app = express();
const PORT = process.env.PORT || 3000;
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || "";
const EBAY_ENDPOINT = process.env.EBAY_ENDPOINT || "";

const prisma = new PrismaClient();
const scanConfig: ScanConfig = {
  platform: "ebay",
  maxListings: 30,
  minMargin: 0,
  minConfidence: 0,
};

app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, "..", "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(import.meta.dirname, "..", "public", "signup.html"));
});

// --- Public signup ---

app.post("/subscribe", async (req, res) => {
  const { email, language } = req.body as { email?: string; language?: string };

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const lang = language === "zh" ? "zh" : "en";

  try {
    await prisma.user.upsert({
      where: { email },
      update: { language: lang },
      create: { name: email, email, language: lang },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Subscribe error:", err);
    res.status(500).json({ error: "Failed to subscribe. Please try again." });
  }
});

// --- eBay webhooks ---

app.get("/ebay/webhook", (req, res) => {
  const challengeCode = req.query.challenge_code as string;
  if (challengeCode) {
    const hash = crypto
      .createHash("sha256")
      .update(challengeCode)
      .update(EBAY_VERIFICATION_TOKEN)
      .update(EBAY_ENDPOINT)
      .digest("hex");
    res.json({ challengeResponse: hash });
  } else {
    res.json({ status: "webhook endpoint ready" });
  }
});

app.post("/ebay/webhook", (_req, res) => {
  res.status(200).send("OK");
});

// DO NOT REMOVE — required by eBay API oauth flow
app.get("/ebay/auth/callback", (req, res) => {
  const { code } = req.query;
  if (!code) {
    res.status(400).send("No authorization code received");
    return;
  }
  res.status(200).send("OK");
});

// --- Scan (API key required) ---

app.post("/scan", (req, res) => {
  const cronKey = req.headers["x-api-key"];
  const envKey = process.env.SCAN_API_KEY;

  if (!cronKey || cronKey !== envKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  const isTest = req.query.test === "true";
  const testRecipients = isTest
    ? ["adrian.aa.chang.aa@gmail.com", "adrian.aa.chang@gmail.com"]
    : undefined;
  const activeScanConfig = isTest ? { ...scanConfig, maxListings: 10 } : scanConfig;

  console.log(`Scan triggered${isTest ? " [TEST MODE]" : ""}`);
  res.json({ status: "ok", message: "Scan started" });

  runScan(activeScanConfig, {
    prisma,
    fetchListings,
    filterListings,
    evaluateListing,
  }, undefined, undefined, testRecipients).catch((error) => {
    console.error("Scan failed:", error);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`eBay webhook: ${EBAY_ENDPOINT || "http://localhost:" + PORT + "/ebay/webhook"}`);
});
