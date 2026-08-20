import type { PrismaClient } from "../generated/prisma/client";

const THREADS_API = "https://graph.threads.net/v1.0";

// ─── Multi-account config ────────────────────────────────────────────────────
// Each Threads account (one per audience language) has its own user ID, env
// var-seeded access token, and AppCredential storage key so the two accounts'
// tokens are resolved/refreshed completely independently.
export type ThreadsAccount = "zh" | "en";

const ACCOUNT_CONFIG: Record<ThreadsAccount, { userIdEnv: string; tokenEnv: string; tokenKey: string; topicTag: string }> = {
  zh: { userIdEnv: "THREADS_USER_ID", tokenEnv: "THREADS_ACCESS_TOKEN", tokenKey: "threads_access_token", topicTag: "古著" },
  en: { userIdEnv: "THREADS_USER_ID_EN", tokenEnv: "THREADS_ACCESS_TOKEN_EN", tokenKey: "threads_access_token_en", topicTag: "vintage" },
};

function getUserId(account: ThreadsAccount): string {
  return process.env[ACCOUNT_CONFIG[account].userIdEnv] || "";
}

// ─── Token lifecycle ─────────────────────────────────────────────────────────
// Long-lived Threads tokens expire after ~60 days and can only be refreshed
// while still valid. The active token lives in AppCredential (seeded from the
// account's *_ACCESS_TOKEN env var) and is re-refreshed whenever it's >24h
// old — the daily scan calls resolveThreadsToken for both accounts, so
// neither token ever reaches expiry. If one ever does die (e.g. the service
// was down for 60+ days), re-mint via the Meta portal's per-tester "Generate
// Token" button and update the corresponding env var; the store re-seeds
// from it automatically.

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
 * Returns a working Threads access token for the given account, or null if
 * none is available. Prefers the stored token (refreshing it when >24h old);
 * falls back to the account's env var when the store is empty or its token
 * has died (manual re-mint).
 */
export async function resolveThreadsToken(prisma: PrismaClient, account: ThreadsAccount = "zh"): Promise<string | null> {
  const { tokenEnv, tokenKey } = ACCOUNT_CONFIG[account];
  const envAccessToken = process.env[tokenEnv] || "";

  const row = await prisma.appCredential.findUnique({ where: { key: tokenKey } });

  if (row && await tokenIsValid(row.value)) {
    let token = row.value;
    if (Date.now() - row.updatedAt.getTime() > TOKEN_REFRESH_AFTER_MS) {
      const refreshed = await refreshToken(token);
      if (refreshed) {
        token = refreshed;
        await prisma.appCredential.update({ where: { key: tokenKey }, data: { value: refreshed } });
        console.log(`[THREADS] Access token refreshed (+60 days) [${account}]`);
      }
    }
    return token;
  }

  if (envAccessToken && await tokenIsValid(envAccessToken)) {
    await prisma.appCredential.upsert({
      where: { key: tokenKey },
      update: { value: envAccessToken },
      create: { key: tokenKey, value: envAccessToken },
    });
    console.log(`[THREADS] Token store seeded from ${tokenEnv} env var`);
    return envAccessToken;
  }

  console.error(`[THREADS] No working access token for account=${account} (stored and env tokens both invalid or missing)`);
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

async function createContainer(accessToken: string, userId: string, params: Record<string, string>): Promise<string> {
  const url = new URL(`${THREADS_API}/${userId}/threads`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json() as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(`Threads container error: ${json.error?.message ?? res.status}`);
  return json.id;
}

async function publishContainer(accessToken: string, userId: string, creationId: string): Promise<string> {
  const url = new URL(`${THREADS_API}/${userId}/threads_publish`);
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
  account: ThreadsAccount = "zh",
): Promise<void> {
  const { userIdEnv, topicTag } = ACCOUNT_CONFIG[account];
  const userId = getUserId(account);

  if (!userId || !accessToken) {
    console.log(`[THREADS] ${userIdEnv} or access token not set for account=${account} — skipping`);
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
    const childId = await createContainer(accessToken, userId, {
      media_type: "IMAGE",
      image_url: item.imageUrl!,
      is_carousel_item: "true",
    });
    await waitForContainer(accessToken, childId);
    childIds.push(childId);
    console.log(`[THREADS] Carousel child ready: ${childId}`);
  }

  // Main post: carousel with all images + caption
  const mainContainerId = await createContainer(accessToken, userId, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    text: mainText,
    topic_tag: topicTag,
  });
  await waitForContainer(accessToken, mainContainerId);
  const mainPostId = await publishContainer(accessToken, userId, mainContainerId);
  console.log(`[THREADS] Main carousel post published: ${mainPostId} [${account}]`);

  // One reply for the first story
  await sleep(5000);
  const replyContainerId = await createContainer(accessToken, userId, {
    media_type: "TEXT",
    text: buildReplyText(items[0]),
    reply_to_id: mainPostId,
  });
  await waitForContainer(accessToken, replyContainerId);
  const replyId = await publishContainer(accessToken, userId, replyContainerId);
  console.log(`[THREADS] Reply published: ${replyId}`);

  console.log(`[THREADS] Thread posted [${account}]`);
}
