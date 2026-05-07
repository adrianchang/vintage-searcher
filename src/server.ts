import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";

const VOTE_SECRET = process.env.VOTE_SECRET || "dev-vote-secret";
import { PrismaClient } from "./generated/prisma/client";
import { fetchListings } from "./services/ecommerce";
import { filterListings } from "./services/filter";
import { runIdentification, runValuation } from "./services/evaluate";
import { runScan } from "./scan";
import type { ScanConfig } from "./types";
import {
  isValidArchetypeId,
  mergeArchetypeKeywords,
  type ArchetypeId,
} from "./configs/archetypes";

const app = express();
const PORT = process.env.PORT || 3000;
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || "";
const EBAY_ENDPOINT = process.env.EBAY_ENDPOINT || "";

const prisma = new PrismaClient();
const scanConfig: ScanConfig = {
  platform: "ebay",
  maxListings: 20,
  minMargin: 0,
  minConfidence: 0,
};

app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, "..", "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(import.meta.dirname, "..", "public", "signup.html"));
});

// --- Public signup ---

const MAX_ARCHETYPES = 3;

app.post("/subscribe", async (req, res) => {
  const { email, language, archetypeIds } = req.body as {
    email?: string;
    language?: string;
    archetypeIds?: unknown;
  };

  // --- Validate email ---
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  // --- Validate archetypeIds ---
  // Accept missing/null/undefined as "no archetypes selected" (fall back to defaults).
  // Reject anything that is present but malformed.
  let validatedArchetypeIds: ArchetypeId[] = [];

  if (archetypeIds !== undefined && archetypeIds !== null) {
    if (!Array.isArray(archetypeIds)) {
      res.status(400).json({ error: "archetypeIds must be an array" });
      return;
    }
    if (archetypeIds.length > MAX_ARCHETYPES) {
      res.status(400).json({ error: `Maximum ${MAX_ARCHETYPES} archetypes allowed` });
      return;
    }
    const invalid = archetypeIds.filter((id) => typeof id !== "string" || !isValidArchetypeId(id));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid archetype ID(s): ${invalid.join(", ")}` });
      return;
    }
    // Deduplicate while preserving order
    validatedArchetypeIds = [...new Set(archetypeIds as ArchetypeId[])];
  }

  const lang = language === "zh" ? "zh" : "en";

  try {
    // Upsert the user — never touch votes, deliveries, or story history.
    const user = await prisma.user.upsert({
      where: { email },
      update: { language: lang },
      create: { name: email, email, language: lang },
    });

    // Build keyword list: merge archetype keywords, or fall back to defaults when none selected.
    // mergeArchetypeKeywords([]) returns DEFAULT_KEYWORDS.
    const keywords = mergeArchetypeKeywords(validatedArchetypeIds);

    // Atomically replace UserKeyword rows and UserArchetype rows in a transaction.
    // All votes, StoryDelivery, and Story records are untouched — they live on the User
    // and Evaluation/Story models which we never modify here.
    await prisma.$transaction([
      // Replace keywords
      prisma.userKeyword.deleteMany({ where: { userId: user.id } }),
      prisma.userKeyword.createMany({
        data: keywords.map((kw) => ({
          userId: user.id,
          query: kw.query,
          percentage: kw.percentage,
        })),
      }),
      // Replace archetypes
      prisma.userArchetype.deleteMany({ where: { userId: user.id } }),
      ...(validatedArchetypeIds.length > 0
        ? [
            prisma.userArchetype.createMany({
              data: validatedArchetypeIds.map((archetypeId) => ({
                userId: user.id,
                archetypeId,
              })),
            }),
          ]
        : []),
    ]);

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

  if (code) {
    // eBay OAuth code received — not currently used
  } else {
    res.status(400).send("No authorization code received");
  }
});

// --- Vote (thumbs up / down from email) ---

app.get("/vote", async (req, res) => {
  const { e: email, s: storyId, d: direction, t: token } = req.query as Record<string, string>;

  const closeHtml = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#f5f0eb;font-family:Helvetica,sans-serif;}</style></head><body><p style="color:#888;font-size:14px;letter-spacing:2px;">NOTED</p><script>setTimeout(function(){window.close()},400);</script></body></html>`;

  if (!email || !storyId || !["up", "down"].includes(direction) || !token) {
    res.status(400).send("Invalid request");
    return;
  }

  // Validate HMAC token
  const expected = crypto.createHmac("sha256", VOTE_SECRET)
    .update(`${email}:${storyId}:${direction}`)
    .digest("hex")
    .slice(0, 32);

  if (token !== expected) {
    res.status(403).send("Invalid token");
    return;
  }

  try {
    // Upsert user (creates a minimal record if they don't exist yet)
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { name: email, email },
    });

    // Upsert vote — one vote per (user, story), last click wins
    await prisma.vote.upsert({
      where: { userId_storyId: { userId: user.id, storyId } },
      update: { direction },
      create: { userId: user.id, storyId, direction },
    });

    console.log(`[VOTE] ${email} voted ${direction} on story ${storyId}`);
    res.send(closeHtml);
  } catch (err) {
    console.error("[VOTE] Error recording vote:", err);
    res.send(closeHtml); // still close the tab — don't leave user on error page
  }
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
    runIdentification,
    runValuation,
  }, undefined, testRecipients).catch((error) => {
    console.error("Scan failed:", error);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`eBay webhook: ${EBAY_ENDPOINT || "http://localhost:" + PORT + "/ebay/webhook"}`);
});
