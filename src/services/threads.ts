const THREADS_API = "https://graph.threads.net/v1.0";
const THREADS_USER_ID = process.env.THREADS_USER_ID || "";
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN || "";

export interface ThreadsStoryItem {
  itemIdentification: string;
  estimatedEra: string | null;
  currentPrice: number;
  estimatedValue: number | null;
  hook: string;
  brandStory: string;
  itemStory: string;
  imageUrl: string | null;
  ebayUrl: string;
}

function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return match ? match[0].trim() : text;
}

function buildReplyText(item: ThreadsStoryItem, index: number): string {
  const num = ["①", "②", "③"][index] ?? `${index + 1}.`;
  const era = item.estimatedEra ?? "Vintage";
  const price = item.estimatedValue
    ? `Listed $${item.currentPrice.toFixed(0)} → Est. $${item.estimatedValue.toFixed(0)}`
    : `Listed $${item.currentPrice.toFixed(0)}`;

  return [
    `${num} ${item.itemIdentification} · ${era}`,
    `"${item.hook}"`,
    price,
    firstSentence(item.brandStory),
    firstSentence(item.itemStory),
    item.ebayUrl,
  ].join("\n");
}

async function createContainer(params: Record<string, string>): Promise<string> {
  const url = new URL(`${THREADS_API}/${THREADS_USER_ID}/threads`);
  url.searchParams.set("access_token", THREADS_ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json() as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(`Threads container error: ${json.error?.message ?? res.status}`);
  return json.id;
}

async function publishContainer(creationId: string): Promise<string> {
  const url = new URL(`${THREADS_API}/${THREADS_USER_ID}/threads_publish`);
  url.searchParams.set("access_token", THREADS_ACCESS_TOKEN);
  url.searchParams.set("creation_id", creationId);

  const res = await fetch(url.toString(), { method: "POST" });
  const json = await res.json() as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(`Threads publish error: ${json.error?.message ?? res.status}`);
  return json.id;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForContainer(containerId: string, maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const url = new URL(`${THREADS_API}/${containerId}`);
    url.searchParams.set("fields", "status,error_message");
    url.searchParams.set("access_token", THREADS_ACCESS_TOKEN);
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
): Promise<void> {
  if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
    console.log("[THREADS] THREADS_USER_ID or THREADS_ACCESS_TOKEN not set — skipping");
    return;
  }
  if (items.length === 0) {
    console.log("[THREADS] No items — skipping");
    return;
  }

  const mainText = `${title}\n\n${intro}\n\n#vintage #vintagefinds`;

  // Main post
  const mainContainerId = await createContainer({ media_type: "TEXT", text: mainText });
  const mainPostId = await publishContainer(mainContainerId);
  console.log(`[THREADS] Main post published: ${mainPostId}`);

  // One reply per story
  for (let i = 0; i < items.length; i++) {
    await sleep(1000);
    const item = items[i];
    const text = buildReplyText(item, i);

    const params: Record<string, string> = {
      text,
      reply_to_id: mainPostId,
    };

    if (item.imageUrl) {
      params.media_type = "IMAGE";
      params.image_url = item.imageUrl;
    } else {
      params.media_type = "TEXT";
    }

    const replyContainerId = await createContainer(params);
    if (item.imageUrl) await waitForContainer(replyContainerId);
    const replyId = await publishContainer(replyContainerId);
    console.log(`[THREADS] Reply ${i + 1} published: ${replyId}`);
  }

  console.log(`[THREADS] Thread posted with ${items.length} replies`);
}
