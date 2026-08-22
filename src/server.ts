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
  buildArchetypeConfigId,
  type ArchetypeId,
} from "./configs/archetypes";
import { postToThreads, resolveThreadsToken, type ThreadsStoryItem, type ThreadsAccount } from "./services/threads";
import { parseTopSizeLabel, coercePitToPitInches, coerceWaistInches } from "./services/size";
import { buildClickUrl, buildPhotoUploadUrl } from "./services/email";
import { generateTryOn, startOfUtcDay } from "./services/tryon";

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const EBAY_VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || "";
const EBAY_ENDPOINT = process.env.EBAY_ENDPOINT || "";
const THREADS_APP_ID = process.env.THREADS_APP_ID || "";
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET || "";
const THREADS_REDIRECT_URI = process.env.THREADS_REDIRECT_URI || "https://vintage-searcher.onrender.com/threads/callback";

// Which user's deliveries + which story language each Threads account posts.
// zh = @bear.7306501 (original), en = @wolf.2833331 (English audience, added 2026-08-19).
const THREADS_ACCOUNTS: Record<ThreadsAccount, { sourceEmail: string; language: string }> = {
  zh: { sourceEmail: "adrian.aa.chang@gmail.com", language: "zh" },
  en: { sourceEmail: "adrian.aa.chang.aa@gmail.com", language: "en" },
};

const prisma = new PrismaClient();
const scanConfig: ScanConfig = {
  platform: "ebay",
  maxListings: 20,
  minMargin: 0,
  minConfidence: 0,
};

// 10mb accommodates a base64-encoded phone photo (see MAX_PHOTO_BYTES below,
// which caps the actual decoded size well under this).
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(import.meta.dirname, "..", "public")));

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

// Shared by /subscribe (new signups) and /photo (existing-user reminder flow).
function decodePhotoUpload(photoBase64: unknown, mimeType: unknown): { bytes: Buffer; mimeType: string } | null {
  if (typeof photoBase64 !== "string" || typeof mimeType !== "string" || !mimeType.startsWith("image/")) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(photoBase64, "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return null;
  return { bytes, mimeType };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBrandPage(bodyHtml: string, title = "Vintage Finds"): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0eb;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
  <div style="max-width:480px;margin:0 auto;padding:48px 20px;text-align:center;">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">Vintage Finds</p>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(import.meta.dirname, "..", "public", "signup.html"));
});

// --- Public signup ---

const MAX_ARCHETYPES = 3;

app.post("/subscribe", async (req, res) => {
  const { email, language, archetypeIds, topSize, waistSize, pitToPitInches, photoBase64, photoMimeType } = req.body as {
    email?: string;
    language?: string;
    archetypeIds?: unknown;
    topSize?: unknown;
    waistSize?: unknown;
    pitToPitInches?: unknown;
    photoBase64?: unknown;
    photoMimeType?: unknown;
  };

  // --- Validate email ---
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  // --- Validate size profile (all optional; null clears, absent leaves unchanged) ---
  // Values are normalized through the same coercion used for listings, so
  // cm inputs and flat waist measurements are handled server-side too.
  const sizeUpdate: { topSize?: string | null; waistSize?: number | null; pitToPitInches?: number | null } = {};

  if (topSize !== undefined) {
    if (topSize === null || topSize === "") {
      sizeUpdate.topSize = null;
    } else {
      const parsed = typeof topSize === "string" ? parseTopSizeLabel(topSize) : null;
      if (!parsed) {
        res.status(400).json({ error: "topSize must be one of XS, S, M, L, XL, XXL" });
        return;
      }
      sizeUpdate.topSize = parsed;
    }
  }

  if (waistSize !== undefined) {
    if (waistSize === null || waistSize === "") {
      sizeUpdate.waistSize = null;
    } else {
      const coerced = coerceWaistInches(Number(waistSize));
      if (coerced == null) {
        res.status(400).json({ error: "waistSize must be a plausible waist measurement" });
        return;
      }
      sizeUpdate.waistSize = Math.round(coerced);
    }
  }

  if (pitToPitInches !== undefined) {
    if (pitToPitInches === null || pitToPitInches === "") {
      sizeUpdate.pitToPitInches = null;
    } else {
      const coerced = coercePitToPitInches(Number(pitToPitInches));
      if (coerced == null) {
        res.status(400).json({ error: "pitToPitInches must be a plausible pit-to-pit measurement" });
        return;
      }
      sizeUpdate.pitToPitInches = coerced;
    }
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

  // --- Validate optional photo (absent = unchanged, same convention as size fields) ---
  let photoUpdate: { photoBytes: Uint8Array<ArrayBuffer>; photoMimeType: string; hasPhoto: true } | Record<string, never> = {};
  if (photoBase64 !== undefined && photoBase64 !== null) {
    const decoded = decodePhotoUpload(photoBase64, photoMimeType);
    if (!decoded) {
      res.status(400).json({ error: "Invalid photo upload" });
      return;
    }
    photoUpdate = { photoBytes: new Uint8Array(decoded.bytes), photoMimeType: decoded.mimeType, hasPhoto: true };
  }

  try {
    // Upsert the user — never touch votes, deliveries, or story history.
    const user = await prisma.user.upsert({
      where: { email },
      update: { language: lang, ...sizeUpdate, ...photoUpdate },
      create: { name: email, email, language: lang, ...sizeUpdate, ...photoUpdate },
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

// --- Click-through redirect (eBay button in emails) ---

app.get("/go", async (req, res) => {
  const { e: email, s: storyId, t: token } = req.query as Record<string, string>;

  if (!email || !storyId || !token) {
    res.status(400).send("Invalid link");
    return;
  }

  // Same HMAC scheme as vote links ("click" pseudo-direction)
  const expected = crypto.createHmac("sha256", VOTE_SECRET)
    .update(`${email}:${storyId}:click`)
    .digest("hex")
    .slice(0, 32);

  if (token !== expected) {
    res.status(403).send("Invalid token");
    return;
  }

  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: { evaluation: true },
    });
    if (!story) {
      res.status(404).send("Listing not found");
      return;
    }

    // Record the click without delaying the redirect
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { name: email, email },
    })
      .then(user => prisma.engagementEvent.create({ data: { userId: user.id, storyId, type: "click" } }))
      .then(() => console.log(`[CLICK] ${email} → ${story.evaluation.url}`))
      .catch(err => console.error("[CLICK] Failed to record:", err));

    res.redirect(302, story.evaluation.url);
  } catch (err) {
    console.error("[CLICK] Error:", err);
    res.status(500).send("Something went wrong");
  }
});

// --- Background-removed hero image (served from our own domain so email
// clients and Threads can fetch it like any other image URL) ---

app.get("/evaluations/:id/image", async (req, res) => {
  try {
    const evaluation = await prisma.evaluation.findUnique({
      where: { id: req.params.id },
      select: { heroImageBytes: true, heroImageMimeType: true, imageUrl: true },
    });
    if (!evaluation) {
      res.status(404).send("Not found");
      return;
    }
    if (evaluation.heroImageBytes) {
      res.setHeader("Content-Type", evaluation.heroImageMimeType || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(evaluation.heroImageBytes);
      return;
    }
    if (evaluation.imageUrl) {
      res.redirect(302, evaluation.imageUrl);
      return;
    }
    res.status(404).send("No image available");
  } catch (err) {
    console.error("[IMAGE] Error:", err);
    res.status(500).send("Something went wrong");
  }
});

// --- Photo upload (existing-user reminder flow — new signups set this via /subscribe) ---

app.post("/photo", async (req, res) => {
  const { email, token, photoBase64, mimeType } = req.body as {
    email?: string;
    token?: string;
    photoBase64?: unknown;
    mimeType?: unknown;
  };

  if (!email || !token) {
    res.status(400).json({ error: "email and token required" });
    return;
  }

  const expected = crypto.createHmac("sha256", VOTE_SECRET).update(`photo:${email}`).digest("hex").slice(0, 32);
  if (token !== expected) {
    res.status(403).json({ error: "Invalid token" });
    return;
  }

  const decoded = decodePhotoUpload(photoBase64, mimeType);
  if (!decoded) {
    res.status(400).json({ error: "Invalid photo upload" });
    return;
  }

  try {
    await prisma.user.upsert({
      where: { email },
      update: { photoBytes: new Uint8Array(decoded.bytes), photoMimeType: decoded.mimeType, hasPhoto: true },
      create: { name: email, email, photoBytes: new Uint8Array(decoded.bytes), photoMimeType: decoded.mimeType, hasPhoto: true },
    });
    console.log(`[PHOTO] Saved for ${email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[PHOTO] Upload error:", err);
    res.status(500).json({ error: "Failed to save photo" });
  }
});

app.get("/photo/upload", (req, res) => {
  const { e: email, t: token } = req.query as Record<string, string>;
  if (!email || !token) {
    res.status(400).send("Invalid link");
    return;
  }

  const expected = crypto.createHmac("sha256", VOTE_SECRET).update(`photo:${email}`).digest("hex").slice(0, 32);
  if (token !== expected) {
    res.status(403).send("Invalid link");
    return;
  }

  res.send(renderBrandPage(`
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:normal;">Upload your photo</h1>
    <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.6;font-family:Helvetica,Arial,sans-serif;">One clear, full-body photo — this is what every future try-on pick gets rendered onto. Uploaded once, used from then on.</p>
    <input type="file" id="photoInput" accept="image/*" style="display:block;margin:0 auto 20px;font-family:Helvetica,Arial,sans-serif;">
    <div id="preview" style="margin-bottom:20px;"></div>
    <button id="uploadBtn" style="padding:12px 28px;background:#2c2c2c;color:#fff;border:none;border-radius:2px;font-size:13px;letter-spacing:1px;font-family:Helvetica,Arial,sans-serif;cursor:pointer;">Save Photo</button>
    <p id="status" style="margin-top:16px;font-size:13px;color:#888;font-family:Helvetica,Arial,sans-serif;"></p>
    <script>
      const email = ${JSON.stringify(email)};
      const token = ${JSON.stringify(token)};
      const input = document.getElementById('photoInput');
      const preview = document.getElementById('preview');
      const statusEl = document.getElementById('status');
      let selectedFile = null;

      input.addEventListener('change', () => {
        selectedFile = input.files[0];
        if (selectedFile) {
          const url = URL.createObjectURL(selectedFile);
          preview.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:320px;border-radius:4px;">';
        }
      });

      document.getElementById('uploadBtn').addEventListener('click', () => {
        if (!selectedFile) {
          statusEl.textContent = 'Choose a photo first.';
          return;
        }
        statusEl.textContent = 'Uploading...';
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result.split(',')[1];
          try {
            const res = await fetch('/photo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, token, photoBase64: base64, mimeType: selectedFile.type }),
            });
            const json = await res.json();
            statusEl.textContent = res.ok ? 'Saved — you can close this page.' : (json.error || 'Something went wrong.');
          } catch (err) {
            statusEl.textContent = 'Something went wrong. Try again.';
          }
        };
        reader.readAsDataURL(selectedFile);
      });
    </script>
  `, "Upload your photo"));
});

// --- Virtual try-on (AI render of a listing on the user's own photo) ---

app.get("/tryon", async (req, res) => {
  const { e: email, s: storyId, t: token } = req.query as Record<string, string>;
  if (!email || !storyId || !token) {
    res.status(400).send("Invalid link");
    return;
  }

  const expected = crypto.createHmac("sha256", VOTE_SECRET)
    .update(`${email}:${storyId}:tryon`)
    .digest("hex")
    .slice(0, 32);
  if (token !== expected) {
    res.status(403).send("Invalid token");
    return;
  }

  // Log every click as an EngagementEvent, not just successful generations —
  // "wanted to try this on" is a signal worth keeping even when blocked by
  // the daily limit or a missing photo (TryOn only records completed
  // attempts). Fire-and-forget, same pattern as /go's click logging.
  prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: email, email },
  })
    .then(user => prisma.engagementEvent.create({ data: { userId: user.id, storyId, type: "tryon_click" } }))
    .then(() => console.log(`[TRYON] Click recorded: ${email} → story ${storyId}`))
    .catch(err => console.error("[TRYON] Failed to record click:", err));

  const buildResultBody = (
    tryOn: { imageBytes: Uint8Array | null; imageMimeType: string | null },
    evaluation: { itemIdentification: string; estimatedEra: string | null },
    storyIdForLink: string,
  ) => {
    const dataUri = tryOn.imageBytes
      ? `data:${tryOn.imageMimeType || "image/jpeg"};base64,${Buffer.from(tryOn.imageBytes).toString("base64")}`
      : "";
    return `
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:normal;">${escapeHtml(evaluation.itemIdentification)}</h1>
      <p style="margin:0 0 20px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${escapeHtml(evaluation.estimatedEra || "Vintage")}</p>
      ${dataUri ? `<img src="${dataUri}" style="width:100%;border-radius:4px;margin-bottom:20px;">` : ""}
      <a href="${buildClickUrl(email, storyIdForLink)}" style="display:block;padding:14px 28px;background:#2c2c2c;color:#fff;text-decoration:none;font-size:13px;letter-spacing:1px;font-family:Helvetica,Arial,sans-serif;border-radius:2px;">View on eBay →</a>
    `;
  };

  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      include: { evaluation: true },
    });
    if (!story) {
      res.status(404).send(renderBrandPage(`<p style="font-size:14px;color:#666;font-family:Helvetica,Arial,sans-serif;">This item is no longer available.</p>`));
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, hasPhoto: true, photoBytes: true, photoMimeType: true },
    });

    if (!user || !user.hasPhoto || !user.photoBytes || !user.photoMimeType) {
      res.send(renderBrandPage(`
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:normal;">Upload a photo first</h1>
        <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.6;font-family:Helvetica,Arial,sans-serif;">You need a photo on file before trying anything on.</p>
        <a href="${buildPhotoUploadUrl(email)}" style="display:inline-block;padding:12px 28px;background:#2c2c2c;color:#fff;text-decoration:none;border-radius:2px;font-size:13px;letter-spacing:1px;font-family:Helvetica,Arial,sans-serif;">Upload your photo</a>
      `));
      return;
    }

    // Once per UTC day, and only successful ("done") generations count — a
    // failed attempt doesn't cost the user their day's try.
    const doneToday = await prisma.tryOn.findFirst({
      where: { userId: user.id, status: "done", createdAt: { gte: startOfUtcDay() } },
      orderBy: { createdAt: "desc" },
    });

    if (doneToday) {
      if (doneToday.evaluationId === story.evaluationId) {
        // Same item as today's existing result — show it again, no regeneration.
        res.send(renderBrandPage(buildResultBody(doneToday, story.evaluation, story.id)));
        return;
      }
      res.send(renderBrandPage(`
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:normal;">Already used today's try-on</h1>
        <p style="margin:0;font-size:14px;color:#666;line-height:1.6;font-family:Helvetica,Arial,sans-serif;">One try-on per day — come back tomorrow for the next pick.</p>
      `));
      return;
    }

    const garmentImageUrl = story.evaluation.hasProcessedImage
      ? `${APP_URL}/evaluations/${story.evaluation.id}/image`
      : (story.evaluation.imageUrl ?? "");

    if (!garmentImageUrl) {
      res.send(renderBrandPage(`<p style="font-size:14px;color:#666;font-family:Helvetica,Arial,sans-serif;">Something went wrong loading this item's photo.</p>`));
      return;
    }

    const result = await generateTryOn(user.photoBytes, user.photoMimeType, garmentImageUrl);

    if (!result) {
      await prisma.tryOn.create({
        data: { userId: user.id, evaluationId: story.evaluationId, status: "failed" },
      });
      res.send(renderBrandPage(`
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:normal;">Couldn't generate that one</h1>
        <p style="margin:0;font-size:14px;color:#666;line-height:1.6;font-family:Helvetica,Arial,sans-serif;">Something went wrong on our end — refresh to try again (this attempt didn't use up today's try-on).</p>
      `));
      return;
    }

    const tryOn = await prisma.tryOn.create({
      data: {
        userId: user.id,
        evaluationId: story.evaluationId,
        status: "done",
        imageBytes: new Uint8Array(result.bytes),
        imageMimeType: result.mimeType,
      },
    });

    console.log(`[TRYON] ${email} tried on ${story.evaluation.itemIdentification}`);
    res.send(renderBrandPage(buildResultBody(tryOn, story.evaluation, story.id)));
  } catch (err) {
    console.error("[TRYON] Error:", err);
    res.status(500).send(renderBrandPage(`<p style="font-size:14px;color:#666;font-family:Helvetica,Arial,sans-serif;">Something went wrong.</p>`));
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

  // Piggyback on the daily scan to keep both Threads tokens perpetually
  // refreshed — long-lived tokens die at ~60 days and can't be revived.
  resolveThreadsToken(prisma, "zh").catch(() => {});
  resolveThreadsToken(prisma, "en").catch(() => {});

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

// --- Threads OAuth ---

app.get("/threads/auth", (_req, res) => {
  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", THREADS_APP_ID);
  url.searchParams.set("redirect_uri", THREADS_REDIRECT_URI);
  url.searchParams.set("scope", "threads_basic,threads_content_publish");
  url.searchParams.set("response_type", "code");
  res.redirect(url.toString());
});

app.get("/threads/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send("Missing code");
    return;
  }

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: THREADS_APP_ID,
        client_secret: THREADS_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: THREADS_REDIRECT_URI,
        code,
      }),
    });
    const tokenJson = await tokenRes.json() as { access_token?: string; user_id?: string; error_message?: string };
    if (!tokenJson.access_token) {
      res.status(500).send(`Token exchange failed: ${tokenJson.error_message ?? JSON.stringify(tokenJson)}`);
      return;
    }

    // Exchange short-lived token for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${THREADS_APP_SECRET}&access_token=${tokenJson.access_token}`
    );
    const longJson = await longRes.json() as { access_token?: string; expires_in?: number; error?: { message: string } };
    if (!longJson.access_token) {
      res.status(500).send(`Long-lived token exchange failed: ${longJson.error?.message ?? JSON.stringify(longJson)}`);
      return;
    }

    const expiresInDays = Math.floor((longJson.expires_in ?? 0) / 86400);

    res.send(`
      <h2>Threads Auth Complete</h2>
      <p><strong>User ID:</strong> ${tokenJson.user_id}</p>
      <p><strong>Long-lived token</strong> (expires in ~${expiresInDays} days):</p>
      <textarea rows="4" cols="80">${longJson.access_token}</textarea>
      <p>Add these to Render env vars:<br>
        <code>THREADS_USER_ID=${tokenJson.user_id}</code><br>
        <code>THREADS_ACCESS_TOKEN=${longJson.access_token}</code>
      </p>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err instanceof Error ? err.message : err}`);
  }
});

// --- Threads post ---

app.post("/threads", async (req, res) => {
  const cronKey = req.headers["x-api-key"];
  const envKey = process.env.SCAN_API_KEY;

  if (!cronKey || cronKey !== envKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  const { title, intro } = req.body as { title?: string; intro?: string };
  if (!title || !intro) {
    res.status(400).json({ error: "title and intro are required" });
    return;
  }

  const accountParam = (req.query.account as string) || "zh";
  if (accountParam !== "zh" && accountParam !== "en") {
    res.status(400).json({ error: "account must be 'zh' or 'en'" });
    return;
  }
  const account = accountParam as ThreadsAccount;
  const { sourceEmail, language } = THREADS_ACCOUNTS[account];

  // Fail loudly BEFORE acknowledging — a dead token used to make this
  // endpoint return "ok" and then silently drop the post.
  const threadsToken = await resolveThreadsToken(prisma, account);
  if (!threadsToken) {
    const tokenEnvVar = account === "en" ? "THREADS_ACCESS_TOKEN_EN" : "THREADS_ACCESS_TOKEN";
    res.status(500).json({ error: `Threads access token invalid or missing for account=${account} — re-mint via Meta portal Generate Token and set ${tokenEnvVar}` });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: sourceEmail },
      include: { archetypes: true },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const archetypeIds = user.archetypes.map(a => a.archetypeId as ArchetypeId);
    const configId = buildArchetypeConfigId(archetypeIds);

    const deliveries = await prisma.storyDelivery.findMany({
      where: { userId: user.id },
      orderBy: { sentAt: "desc" },
      take: 3,
    });
    deliveries.reverse();

    const items: ThreadsStoryItem[] = [];
    for (const delivery of deliveries) {
      const evaluation = await prisma.evaluation.findUnique({ where: { url: delivery.url } });
      if (!evaluation) continue;
      const story = await prisma.story.findUnique({
        where: { evaluationId_language_configId: { evaluationId: evaluation.id, language, configId } },
      });
      if (!story) continue;
      const imageUrl = evaluation.hasProcessedImage
        ? `${APP_URL}/evaluations/${evaluation.id}/image`
        : evaluation.imageUrl;
      items.push({
        itemIdentification: evaluation.itemIdentification,
        estimatedEra: evaluation.estimatedEra,
        currentPrice: evaluation.currentPrice,
        estimatedValue: evaluation.estimatedValue,
        hook: story.hook,
        mainStory: story.mainStory,
        imageUrl,
        ebayUrl: delivery.url,
      });
    }

    res.json({ status: "ok", message: `Posting thread with ${items.length} stories [${account}]` });

    await postToThreads(title, intro, items, threadsToken, account);
  } catch (err) {
    console.error("[THREADS] Endpoint error:", err);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`eBay webhook: ${EBAY_ENDPOINT || "http://localhost:" + PORT + "/ebay/webhook"}`);
});
