import { GoogleGenAI } from "@google/genai";
import type { PrismaClient, FilteredListing, Evaluation, ChatMessage } from "../generated/prisma/client";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const MIN_REQUEST_INTERVAL_MS = 2000; // 1 request per 2 seconds
let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (lastRequestTime > 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

type ImagePart = { inlineData: { data: string; mimeType: string } };

async function fetchListingImages(imageUrls: string[]): Promise<ImagePart[]> {
  const imageParts: ImagePart[] = [];
  for (const url of imageUrls.slice(0, 4)) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mimeType = response.headers.get("content-type") || "image/jpeg";
      imageParts.push({ inlineData: { data: base64, mimeType } });
    } catch {
      // Skip failed images
    }
  }
  return imageParts;
}

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  en: "Answer the user's questions in English.",
  zh: "用繁體中文回答使用者的問題。",
};

const MODEL_ACK: Record<string, string> = {
  en: "I've reviewed the listing details, images, and evaluation. How can I help you with this item?",
  zh: "我已查看了商品詳情、圖片和評估。關於這件商品有什麼我可以幫您的？",
};

const FALLBACK_ERROR: Record<string, string> = {
  en: "I'm sorry, I couldn't generate a response.",
  zh: "抱歉，我無法產生回覆。",
};

function buildSystemContext(
  listing: FilteredListing,
  evaluation: Evaluation | null,
  lang: string,
): string {
  const langInstruction = LANGUAGE_INSTRUCTIONS[lang] || LANGUAGE_INSTRUCTIONS.en;

  let context = `You are a helpful assistant specializing in vintage clothing. You are helping the user analyze a specific listing.

Listing Details:
- Title: ${listing.title}
- Price: $${listing.price}
- Platform: ${listing.platform}
- Description: ${listing.description}`;

  if (evaluation) {
    context += `

Evaluation:
- Authentic: ${evaluation.isAuthentic ? "Yes" : "No"}
- Estimated Era: ${evaluation.estimatedEra || "Unknown"}
- Estimated Value: ${evaluation.estimatedValue != null ? "$" + evaluation.estimatedValue : "Unknown"}
- Current Price: $${evaluation.currentPrice}
- Margin: ${evaluation.margin != null ? "$" + evaluation.margin : "N/A"}
- Confidence: ${(evaluation.confidence * 100).toFixed(0)}%
- Reasoning: ${evaluation.reasoning}
- Red Flags: ${JSON.parse(evaluation.redFlags).join(", ") || "None"}
- References: ${JSON.parse(evaluation.references).join(", ") || "None"}`;
  }

  context += `

The listing images are attached. Use Google Search when needed to look up comparable items, pricing, or authentication details.

IMPORTANT: ${langInstruction}`;

  return context;
}

export async function chatWithListing(
  prisma: PrismaClient,
  listing: FilteredListing & { evaluation: Evaluation | null },
  userMessage: string,
  lang: string = "en",
): Promise<string> {
  // Cap message length
  const message = userMessage.slice(0, 1000);

  // Get last 20 chat messages for history
  const history = await prisma.chatMessage.findMany({
    where: { listingId: listing.id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  // Build conversation contents
  const imageUrls: string[] = JSON.parse(listing.imageUrls);
  const imageParts = await fetchListingImages(imageUrls);

  const systemContext = buildSystemContext(listing, listing.evaluation, lang);

  // Build message history for Gemini
  const contents: Array<{ role: string; parts: Array<{ text: string } | ImagePart> }> = [];

  // First message includes system context + images
  contents.push({
    role: "user",
    parts: [
      { text: systemContext },
      ...imageParts,
    ],
  });
  contents.push({
    role: "model",
    parts: [{ text: MODEL_ACK[lang] || MODEL_ACK.en }],
  });

  // Add chat history
  for (const msg of history) {
    contents.push({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    });
  }

  // Add current user message
  contents.push({
    role: "user",
    parts: [{ text: message }],
  });

  await throttle();

  const response = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const reply = response.text ?? (FALLBACK_ERROR[lang] || FALLBACK_ERROR.en);
  return reply;
}
