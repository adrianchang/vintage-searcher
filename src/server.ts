import "dotenv/config";
import express from "express";
import crypto from "crypto";
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
    console.log("Challenge code:", challengeCode);
    console.log("Response hash:", hash);

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
    console.log("eBay OAuth code received:", code);
    res.send(`
      <html>
        <body>
          <h1>Authorization successful!</h1>
          <p>Code received. You can close this window.</p>
          <pre>${code}</pre>
        </body>
      </html>
    `);
  } else {
    res.status(400).send("No authorization code received");
  }
});

// Trigger a scan
app.post("/scan", async (req, res) => {
  console.log("Scan triggered via API");
  try {
    await runScan(scanConfig, {
      prisma,
      fetchListings,
      filterListings,
      evaluateListing,
      sendAlert,
    });
    res.json({ status: "ok", message: "Scan complete" });
  } catch (error) {
    console.error("Scan failed:", error);
    res.status(500).json({ status: "error", message: "Scan failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`eBay webhook endpoint: ${EBAY_ENDPOINT || "http://localhost:" + PORT + "/ebay/webhook"}`);
});
