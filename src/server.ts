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

// Trigger a scan (uses logged-in user)
app.post("/scan", requireAuth, (req, res) => {
  const userId = req.user!.id;
  console.log(`Scan triggered via API for user ${userId}`);
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
