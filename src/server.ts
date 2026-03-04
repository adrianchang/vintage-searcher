import "dotenv/config";
import "./types/express.d.ts";
import express from "express";
import crypto from "crypto";
import path from "path";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { PrismaClient } from "./generated/prisma/client";
import { fetchListings } from "./services/ecommerce";
import { filterListings } from "./services/filter";
import { evaluateListing } from "./services/evaluate";
import { sendAlert } from "./services/notify";
import { runScan } from "./scan";
import { configurePassport } from "./auth";
import { requireAuth } from "./middleware/requireAuth";
import { chatWithListing } from "./services/chat";
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

// --- Middleware ---
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.use(express.json());

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  }),
);

configurePassport();
app.use(passport.initialize());
app.use(passport.session());

app.use(express.static(path.join(import.meta.dirname, "..", "public")));

// --- Auth routes ---

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (_req, res) => {
    res.redirect("/");
  },
);

app.get("/auth/status", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  if (req.isAuthenticated()) {
    res.json({ authenticated: true, user: { id: req.user!.id, name: req.user!.name } });
  } else {
    res.json({ authenticated: false });
  }
});

app.post("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      res.status(500).json({ error: "Logout failed" });
      return;
    }
    res.json({ ok: true });
  });
});

// --- eBay webhooks (no auth required) ---

app.get("/ebay/webhook", (req, res) => {
  const challengeCode = req.query.challenge_code as string;

  if (challengeCode) {
    const hash = crypto
      .createHash("sha256")
      .update(challengeCode)
      .update(EBAY_VERIFICATION_TOKEN)
      .update(EBAY_ENDPOINT)
      .digest("hex");

    res.set("Content-Type", "application/json");
    res.json({ challengeResponse: hash });
  } else {
    res.json({ status: "webhook endpoint ready" });
  }
});

app.post("/ebay/webhook", (req, res) => {
  res.status(200).send("OK");
});

app.get("/ebay/auth/callback", (req, res) => {
  const { code } = req.query;

  if (code) {
    // eBay OAuth code received — not currently used
  } else {
    res.status(400).send("No authorization code received");
  }
});

// --- Protected API routes ---

// Get queries for the logged-in user
app.get("/users/me/queries", requireAuth, async (req, res) => {
  const queries = await prisma.searchQuery.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(queries);
});

// Replace all queries for the logged-in user
app.put("/users/me/queries", requireAuth, async (req, res) => {
  const { queries } = req.body as { queries: { query: string; count: number; enabled: boolean }[] };
  if (!Array.isArray(queries)) {
    res.status(400).json({ error: "queries array required" });
    return;
  }

  const userId = req.user!.id;
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

// Get opportunity listings for the logged-in user
app.get("/users/me/listings", requireAuth, async (req, res) => {
  const listings = await prisma.filteredListing.findMany({
    where: {
      userId: req.user!.id,
      evaluation: { isOpportunity: true },
    },
    include: { evaluation: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(listings);
});

// Get a single listing by ID (verify ownership)
app.get("/users/me/listings/:listingId", requireAuth, async (req, res) => {
  const listingId = req.params.listingId as string;
  const listing = await prisma.filteredListing.findUnique({
    where: { id: listingId },
    include: { evaluation: true },
  });
  if (!listing || listing.userId !== req.user!.id) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  res.json(listing);
});

// Get chat messages for a listing
app.get("/users/me/listings/:listingId/messages", requireAuth, async (req, res) => {
  const listingId = req.params.listingId as string;
  const listing = await prisma.filteredListing.findUnique({
    where: { id: listingId },
  });
  if (!listing || listing.userId !== req.user!.id) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }
  const messages = await prisma.chatMessage.findMany({
    where: { listingId: listing.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
});

// Send a chat message about a listing
app.post("/users/me/listings/:listingId/chat", requireAuth, async (req, res) => {
  const { message } = req.body as { message: string };
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "message required" });
    return;
  }
  if (message.length > 1000) {
    res.status(400).json({ error: "message too long (max 1000 chars)" });
    return;
  }

  const listingId = req.params.listingId as string;
  const listing = await prisma.filteredListing.findUnique({
    where: { id: listingId },
    include: { evaluation: true },
  });
  if (!listing || listing.userId !== req.user!.id) {
    res.status(404).json({ error: "Listing not found" });
    return;
  }

  // Save user message
  await prisma.chatMessage.create({
    data: { listingId: listing.id, role: "user", content: message.trim() },
  });

  try {
    const reply = await chatWithListing(prisma, listing, message.trim());

    // Save assistant reply
    const assistantMsg = await prisma.chatMessage.create({
      data: { listingId: listing.id, role: "assistant", content: reply },
    });

    res.json(assistantMsg);
  } catch (error) {
    console.error("Chat error:", error);
    const errorReply = "Sorry, I encountered an error processing your request. Please try again.";
    const assistantMsg = await prisma.chatMessage.create({
      data: { listingId: listing.id, role: "assistant", content: errorReply },
    });
    res.json(assistantMsg);
  }
});

// Trigger a scan — authenticated user or cron with API key
app.post("/scan", (req, res) => {
  const cronKey = req.headers["x-api-key"];
  const envKey = process.env.SCAN_API_KEY;
  const isCron = cronKey && cronKey === envKey;

  console.log(`Scan auth: hasKey=${!!cronKey}, envKeySet=${!!envKey}, match=${isCron}, authenticated=${req.isAuthenticated()}`);

  if (!isCron && !req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const userId = req.user?.id; // undefined for cron — falls back to Adrian in runScan
  console.log(`Scan triggered via API${userId ? ` for user ${userId}` : " (cron)"}`);
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
