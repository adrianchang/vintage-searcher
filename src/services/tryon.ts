import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "not-set" });

// Same model Google's own shopping virtual try-on feature runs on. Deliberately
// NOT sharing evaluate.ts's global 15s scan throttle — that throttle exists for
// an unattended background batch job; this is a live request with a real user
// waiting on a page load, and volume is already self-limited to once per digest
// batch per user (see StoryDelivery.batchId + the quota check in server.ts's
// GET /tryon).
const TRYON_MODEL = "gemini-3.1-flash-image";

const TRYON_PROMPT = `You are given two images: the first is a photo of a person, the second is a photo of a single garment (a vintage clothing item). Generate a new, photorealistic image of the exact same person from image 1 — same face, same identity, same body proportions, same pose, same background — now wearing the garment from image 2 instead of what they're currently wearing. Render the garment with realistic fit, drape, folds, and shadows appropriate to the person's pose and body — do not just overlay a flat texture. This garment may normally be worn layered over other clothing (e.g. overalls over a shirt, a vest over a jacket) — if so, keep the person's existing visible clothing underneath/around it rather than leaving them bare. Otherwise keep any other clothing the new garment doesn't replace (e.g. keep pants if the new garment is a top). Match the lighting of the original person photo.`;

export interface TryOnResult {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Generates a single try-on image. Fail-fast by design: one attempt, no
 * retries, no backoff — this runs synchronously inside a user-facing request,
 * unlike the rest of the Gemini pipeline (which retries during an unattended
 * batch scan where nobody is waiting on the response).
 */
export async function generateTryOn(
  personBytes: Uint8Array,
  personMimeType: string,
  garmentImageUrl: string,
): Promise<TryOnResult | null> {
  try {
    const garmentRes = await fetch(garmentImageUrl);
    if (!garmentRes.ok) {
      console.log(`[TRYON] Garment image fetch failed (${garmentRes.status})`);
      return null;
    }
    const garmentBuf = Buffer.from(await garmentRes.arrayBuffer());
    const garmentMime = (garmentRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim();

    const response = await genAI.models.generateContent({
      model: TRYON_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: TRYON_PROMPT },
            { inlineData: { data: Buffer.from(personBytes).toString("base64"), mimeType: personMimeType } },
            { inlineData: { data: garmentBuf.toString("base64"), mimeType: garmentMime } },
          ],
        },
      ],
      config: { responseModalities: ["IMAGE"] },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p) => p.inlineData?.data);
    if (!imgPart?.inlineData?.data) {
      console.log("[TRYON] No image in response");
      return null;
    }
    return {
      bytes: Buffer.from(imgPart.inlineData.data, "base64"),
      mimeType: imgPart.inlineData.mimeType || "image/jpeg",
    };
  } catch (error) {
    console.log(`[TRYON] Generation failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
