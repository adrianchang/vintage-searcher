import type { PrismaClient } from "../generated/prisma/client";

const THREADS_API = "https://graph.threads.net/v1.0";
const THREADS_USER_ID = process.env.THREADS_USER_ID || "";
const ENV_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN || "";

// ─── Token lifecycle ─────────────────────────────────────────────────────────
// Long-lived Threads tokens expire after ~60 days and can only be refreshed
// while still valid. The active token lives in AppCredential (seeded from the
// THREADS_ACCESS_TOKEN env var) and is re-refreshed whenever it's >24h old —
// the daily scan calls resolveThreadsToken, so the token never reaches expiry.
// If it ever does die (e.g. the service was down for 60+ days), re-mint via
// the Meta portal User Token Generator and update the env var; the store
// re-seeds from it automatically.

const TOKEN_KEY = "threads_access_token";
const TOKEN_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

async function tokenIsValid(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${THREADS_API}/me?fields=id&access_token=${encodeURIComponent(token)}`);
    return res.ok;
  } catch {
    return false;
  }
}

async function refreshToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`,
    );
    const json = await res.json() as { access_token?: string; error?: { message?: string } };
    if (json.access_token) return json.access_token;
    console.warn(`[THREADS] Token refresh failed: ${json.error?.message ?? "unknown error"}`);
    return null;
  } catch (err) {
    console.warn(`[THREADS] Token refresh error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Returns a working Threads access token, or null if none is available.
 * Prefers the stored token (refreshing it when >24h old); falls back to the
 * env var when the store is empty or its token has died (manual re-mint).
 */
export async function resolveThreadsToken(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.appCredential.findUnique({ where: { key: TOKEN_KEY } });

  if (row && await tokenIsValid(row.value)) {
    let token = row.value;
    if (Date.now() - row.updatedAt.getTime() > TOKEN_REFRESH_AFTER_MS) {
      const refreshed = await refreshToken(token);
      if (refreshed) {
        token = refreshed;
        await prisma.appCredential.update({ where: { key: TOKEN_KEY }, data: { value: refreshed } });
        console.log("[THREADS] Access token refreshed (+60 days)");
      }
    }
    return token;
  }

  if (ENV_ACCESS_TOKEN && await tokenIsValid(ENV_ACCESS_TOKEN)) {
    await prisma.appCredential.upsert({
      where: { key: TOKEN_KEY },
      update: { value: ENV_ACCESS_TOKEN },
      create: { key: TOKEN_KEY, value: ENV_ACCESS_TOKEN },
    });
    console.log("[THREADS] Token store seeded from THREADS_ACCESS_TOKEN env var");
    return ENV_ACCESS_TOKEN;
  }

  console.error("[THREADS] No working access token (stored and env tokens both invalid or missing)");
  return null;
}

export interface ThreadsStoryItem {
  itemIdentification: string;
  estimatedEra: string | null;
  currentPrice: number;
  estimatedValue: number | null;
  hook: string;
  mainStory: string;
  imageUrl: string | null;
  ebayUrl: string;
}

function buildReplyText(item: ThreadsStoryItem): string {
  const era = item.estimatedEra ?? "Vintage";
  const price = item.estimatedValue
    ? `Listed $${item.currentPrice.toFixed(0)} → Est. $${item.estimatedValue.toFixed(0)}`
    : `Listed $${item.currentPrice.toFixed(0)}`;

  const header = [
    `${item.itemIdentification} · ${era}`,
    `"${item.hook}"`,
    price,
    item.ebayUrl,
  ].join("\n");

  const available = 500 - header.length - 1; // -1 for the \n before story
  const story = item.mainStory.length <= available
    ? item.mainStory
    : item.mainStory.slice(0, available - 3) + "...";

  return `${header}\n${story}`;
}

async function createContainer(accessToken: string, params: Record<string, string>): Promise<string> {
  const url = new URL(`${THREADS_API}/${THREADS_USER_ID}/threads`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json() as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(`Threads container error: ${json.error?.message ?? res.status}`);
  return json.id;
}

async function publishContainer(accessToken: string, creationId: string): Promise<string> {
  const url = new URL(`${THREADS_API}/${THREADS_USER_ID}/threads_publish`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("creation_id", creationId);

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json() as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(`Threads publish error: ${json.error?.message ?? res.status}`);
  return json.id;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForContainer(accessToken: string, containerId: string, maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const url = new URL(`${THREADS_API}/${containerId}`);
    url.searchParams.set("fields", "status,error_message");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url.toString());
    const json = await res.json() as { status?: string; error_message?: string };
    if (json.status === "FINISHED") return;
    if (json.status === "ERROR") throw new Error(`Container processing failed: ${json.error_message}`);
  }
  throw new Error("Container processing timed out");
}

export async function postToThreads(
  title: string,
  intro: string,
  items: ThreadsStoryItem[],
  accessToken: string,
): Promise<void> {
  if (!THREADS_USER_ID || !accessToken) {
    console.log("[THREADS] THREADS_USER_ID or access token not set — skipping");
    return;
  }
  if (items.length === 0) {
    console.log("[THREADS] No items — skipping");
    return;
  }

  const mainText = `${title}\n\n${intro}`;

  // Create one IMAGE child container per item for the carousel
  const childIds: string[] = [];
  for (const item of items) {
    const childId = await createContainer(accessToken, {
      media_type: "IMAGE",
      image_url: item.imageUrl!,
      is_carousel_item: "true",
    });
    await waitForContainer(accessToken, childId);
    childIds.push(childId);
    console.log(`[THREADS] Carousel child ready: ${childId}`);
  }

  // Main post: carousel with all images + caption
  const mainContainerId = await createContainer(accessToken, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    text: mainText,
    topic_tag: "古著",
  });
  await waitForContainer(accessToken, mainContainerId);
  const mainPostId = await publishContainer(accessToken, mainContainerId);
  console.log(`[THREADS] Main carousel post published: ${mainPostId}`);

  // One reply for the first story
  await sleep(5000);
  const replyContainerId = await createContainer(accessToken, {
    media_type: "TEXT",
    text: buildReplyText(items[0]),
    reply_to_id: mainPostId,
  });
  await waitForContainer(accessToken, replyContainerId);
  const replyId = await publishContainer(accessToken, replyContainerId);
  console.log(`[THREADS] Reply published: ${replyId}`);

  console.log(`[THREADS] Thread posted`);
}
