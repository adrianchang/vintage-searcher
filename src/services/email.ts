import { createHmac } from "crypto";
import { Resend } from "resend";
import type { Listing, Evaluation } from "../types";
import { combinedScore, priceScore } from "./score";
import { formatGarmentSize, type SizeFit } from "./size";

const FROM_ADDRESS = process.env.EMAIL_FROM || "finds@vintagefinds.email";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const VOTE_SECRET = process.env.VOTE_SECRET || "dev-vote-secret";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

function getResend() {
  return new Resend(RESEND_API_KEY);
}

export interface DigestItem {
  listing: Listing;
  evaluation: Evaluation;
  score: number;
  storyId: string;
  sizeFit?: SizeFit; // set only when the user has a size profile
}

function buildVoteToken(email: string, storyId: string, direction: string): string {
  return createHmac("sha256", VOTE_SECRET)
    .update(`${email}:${storyId}:${direction}`)
    .digest("hex")
    .slice(0, 32);
}

function buildVoteUrl(email: string, storyId: string, direction: "up" | "down"): string {
  const token = buildVoteToken(email, storyId, direction);
  const params = new URLSearchParams({ e: email, s: storyId, d: direction, t: token });
  return `${APP_URL}/vote?${params.toString()}`;
}

// eBay button goes through /go so the click is recorded (EngagementEvent)
// before a 302 to the listing. Signed like vote links; "click" can never
// collide with a vote direction.
export function buildClickUrl(email: string, storyId: string): string {
  const token = buildVoteToken(email, storyId, "click");
  const params = new URLSearchParams({ e: email, s: storyId, t: token });
  return `${APP_URL}/go?${params.toString()}`;
}

// Same HMAC scheme as vote/click links ("tryon" pseudo-direction).
export function buildTryOnUrl(email: string, storyId: string): string {
  const token = buildVoteToken(email, storyId, "tryon");
  const params = new URLSearchParams({ e: email, s: storyId, t: token });
  return `${APP_URL}/tryon?${params.toString()}`;
}

// Not story-specific (a user uploads one photo, not one per item), so this
// signs on email alone rather than reusing buildVoteToken's email:story:dir shape.
export function buildPhotoUploadUrl(email: string): string {
  const token = createHmac("sha256", VOTE_SECRET).update(`photo:${email}`).digest("hex").slice(0, 32);
  const params = new URLSearchParams({ e: email, t: token });
  return `${APP_URL}/photo/upload?${params.toString()}`;
}

const LABELS: Record<string, Record<string, string>> = {
  en: {
    dailyEdit: "The Daily Edit",
    todaysFinds: "Today's Finds",
    piecesSelected: "pieces selected",
    pieceSelected: "piece selected",
    intro: "We scan the market so you don't have to. Every piece below passed our story test — there's something worth knowing about each one.",
    theNumbers: "The Numbers",
    listed: "Listed",
    estValue: "Est. Value",
    upside: "upside",
    listedPrice: "Listed Price",
    theStory: "The Story",
    theStyle: "The Style",
    storyScore: "Story score",
    combined: "Combined",
    viewOnEbay: "View on eBay →",
    sizeUnverified: "Size unverified — check measurements before buying",
    footer: "You're receiving this because you signed up for daily vintage finds.<br>Prices and availability change — always verify before purchasing.",
    tryOnTitle: "Pick One to Try On",
    tryOnSub: "See it on you before you scroll — pick your favorite.",
    tryOnCta: "Try this on",
    photoNudgeTitle: "Unlock AI Try-On",
    photoNudgeBody: "Upload a photo once and see any future pick rendered on you.",
    photoNudgeCta: "Upload your photo",
  },
  zh: {
    dailyEdit: "每日精選",
    todaysFinds: "今日好物",
    piecesSelected: "件入選",
    pieceSelected: "件入選",
    intro: "我們找單品，你享受。以下本日特選 —— 值得你多看一眼。",
    theNumbers: "數字",
    listed: "售價",
    estValue: "估值",
    upside: "空間",
    listedPrice: "售價",
    theStory: "故事",
    theStyle: "穿搭指南",
    storyScore: "故事分",
    combined: "綜合分",
    viewOnEbay: "前往 eBay 查看 →",
    sizeUnverified: "尺寸未確認 — 購買前請確認實際尺寸",
    footer: "你收到這封信，因為你訂閱了每日古著精選。<br>價格與庫存隨時變動，購買前請自行確認。",
    tryOnTitle: "選一件試穿",
    tryOnSub: "看看穿在你身上的樣子 — 選一件你的最愛。",
    tryOnCta: "試穿這件",
    photoNudgeTitle: "解鎖 AI 試穿",
    photoNudgeBody: "上傳一次照片，之後每天都能看到單品穿在你身上的樣子。",
    photoNudgeCta: "上傳照片",
  },
};

export async function sendDigestEmail(
  items: DigestItem[],
  recipient: string,
  lang = "en",
  hasPhoto = false,
): Promise<void> {
  if (!recipient) {
    console.log("No recipient — skipping email");
    return;
  }
  if (items.length === 0) {
    console.log("No items — skipping email");
    return;
  }

  const html = buildEmailHtml(items, recipient, lang, hasPhoto);
  const subject = buildSubject(items, lang);

  if (!RESEND_API_KEY) {
    console.log(`[EMAIL] Would send "${subject}" to ${recipient} with ${items.length} finds (RESEND_API_KEY not set)`);
    return;
  }

  const resend = getResend();
  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: recipient,
      subject,
      html,
    });
    if (error) {
      console.error(`[EMAIL] Failed to send to ${recipient}:`, error);
    } else {
      console.log(`[EMAIL] Sent to ${recipient}`);
    }
  } catch (err) {
    console.error(`[EMAIL] Error sending to ${recipient}:`, err);
  }
}

// Takes the text before the first comma of itemIdentification (a search-query-shaped
// label like "Pendleton Board Shirt, loop collar, wool, 1960s") as a short display name.
function shortItemName(itemIdentification: string): string {
  return itemIdentification.split(",")[0].trim();
}

// Joins names with a trailing conjunction ("A, B and C"); no length capping —
// subject lines are left to truncate naturally in the inbox preview.
function joinWithAnd(names: string[], conjunction: string, separator = ", "): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ${conjunction} ${names[1]}`;
  return `${names.slice(0, -1).join(separator)} ${conjunction} ${names[names.length - 1]}`;
}

export function buildSubject(items: DigestItem[], lang = "en"): string {
  const names = items.map((item) => shortItemName(item.evaluation.itemIdentification));
  if (lang === "zh") {
    const date = new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric" });
    return `🏷️ 今日精選：${joinWithAnd(names, "和", "、")} · ${date}`;
  }
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `🏷️ Today's Selection: ${joinWithAnd(names, "and")} · ${date.toUpperCase()}`;
}

function buildEmailHtml(items: DigestItem[], recipient: string, lang = "en", hasPhoto = false): string {
  const L = LABELS[lang] ?? LABELS.en;
  const date = lang === "zh"
    ? new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" })
    : new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L.todaysFinds}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f0eb;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0eb;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:32px;border-bottom:2px solid #2c2c2c;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.dailyEdit}</p>
                    <h1 style="margin:6px 0 0;font-size:28px;font-weight:normal;color:#1a1a1a;letter-spacing:-0.5px;">${L.todaysFinds}</h1>
                  </td>
                  <td align="right" style="vertical-align:bottom;">
                    <p style="margin:0;font-size:12px;color:#888;font-family:Helvetica,Arial,sans-serif;">${date}</p>
                    <p style="margin:4px 0 0;font-size:12px;color:#888;font-family:Helvetica,Arial,sans-serif;">${items.length} ${items.length !== 1 ? L.piecesSelected : L.pieceSelected}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Try-on picker (has photo) or upload nudge (no photo yet) — front and center,
               before the intro, so it's seen without scrolling through the full digest. -->
          ${hasPhoto ? buildTryOnPickerHtml(items, recipient, L) : buildPhotoNudgeHtml(recipient, L)}

          <!-- Intro line -->
          <tr>
            <td style="padding:24px 0 32px;">
              <p style="margin:0;font-size:16px;line-height:1.7;color:#444;font-style:italic;">
                ${L.intro}
              </p>
            </td>
          </tr>

          <!-- Items -->
          ${items.map((item, index) => buildItemHtml(item, index, items.length, L, recipient)).join("")}

          <!-- Footer -->
          <tr>
            <td style="padding-top:48px;border-top:1px solid #ddd;">
              <p style="margin:0;font-size:11px;color:#aaa;line-height:1.8;font-family:Helvetica,Arial,sans-serif;text-align:center;">
                ${L.footer}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Thumbnail-per-item picker, shown up front (before the full digest) so the
// "which one would you try on" signal doesn't require reading the whole email
// first — the whole point is to make it feel like a quick game, not a chore.
function buildTryOnPickerHtml(items: DigestItem[], recipient: string, L: Record<string, string>): string {
  const cells = items.map((item) => {
    const { listing, evaluation } = item;
    const imageUrl = evaluation.hasProcessedImage
      ? `${APP_URL}/evaluations/${evaluation.id}/image`
      : (listing.imageUrls[0] || "");
    return `
          <td width="${Math.floor(100 / items.length)}%" style="padding:0 6px;vertical-align:top;">
            <a href="${buildTryOnUrl(recipient, item.storyId)}" style="text-decoration:none;display:block;">
              ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(listing.title)}" width="180" style="width:100%;height:auto;display:block;border-radius:4px;aspect-ratio:3/4;object-fit:cover;">` : ""}
              <p style="margin:8px 0 0;padding:8px 0;background:#2c2c2c;color:#c8a96e;text-align:center;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;border-radius:2px;">${L.tryOnCta}</p>
            </a>
          </td>`;
  }).join("");

  return `
          <tr>
            <td style="padding-bottom:32px;">
              <p style="margin:0 0 2px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.tryOnTitle}</p>
              <p style="margin:0 0 16px;font-size:13px;color:#666;font-family:Helvetica,Arial,sans-serif;">${L.tryOnSub}</p>
              <table width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
            </td>
          </tr>`;
}

// Shown instead of the picker for users who haven't uploaded a photo yet —
// re-appears every digest until they do (no separate one-time-nag flag needed;
// it naturally stops once User.hasPhoto flips true).
function buildPhotoNudgeHtml(recipient: string, L: Record<string, string>): string {
  return `
          <tr>
            <td style="padding-bottom:32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f2;border:1px solid #e5ded4;border-left:3px solid #c8a96e;border-radius:4px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:bold;color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;">${L.photoNudgeTitle}</p>
                    <p style="margin:0 0 14px;font-size:13px;color:#666;line-height:1.6;font-family:Helvetica,Arial,sans-serif;">${L.photoNudgeBody}</p>
                    <a href="${buildPhotoUploadUrl(recipient)}" style="display:inline-block;padding:10px 20px;background:#2c2c2c;color:#fff;text-decoration:none;font-size:12px;letter-spacing:1px;font-family:Helvetica,Arial,sans-serif;border-radius:2px;">${L.photoNudgeCta}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function buildItemHtml(item: DigestItem, index: number, total: number, L: Record<string, string>, recipient: string): string {
  const { listing, evaluation } = item;
  // Prefer the background-removed hero image (gray studio backdrop) when
  // available; falls back to the raw listing photo otherwise.
  const imageUrl = evaluation.hasProcessedImage
    ? `${APP_URL}/evaluations/${evaluation.id}/image`
    : (listing.imageUrls[0] || "");
  const pScore = priceScore(evaluation);
  const cScore = combinedScore(evaluation);
  const isUndervalued = evaluation.margin != null && evaluation.estimatedValue != null && pScore > 0.2;
  const isLastItem = index === total - 1;

  const sizeSummary = formatGarmentSize({
    labeledSize: evaluation.labeledSize ?? null,
    pitToPitInches: evaluation.pitToPitInches ?? null,
    waistInches: evaluation.waistInches ?? null,
  });
  const sizeLineText = item.sizeFit === "unknown"
    ? (sizeSummary ? `${sizeSummary} · ${L.sizeUnverified}` : L.sizeUnverified)
    : sizeSummary;
  const sizeHtml = sizeLineText
    ? `<p style="margin:12px 0 0;font-size:12px;color:#888;font-family:Helvetica,Arial,sans-serif;">📏 ${escapeHtml(sizeLineText)}</p>`
    : "";

  // Quiet single-line treatment on the page's own cream background — no dark
  // box. Isolation-effect research: the eBay button below is the one bold
  // dark element per item; a matching dark price card would compete with it
  // instead of reinforcing it. Colors are darker/richer than the on-dark
  // versions used elsewhere (era tag, style label) since these sit directly
  // on #f5f0eb and need their own contrast. Numbers sized up (2026-08-14) —
  // still no box/background, so the eBay button stays the only bold element.
  const priceText = isUndervalued
    ? `<span style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;font-family:Helvetica,Arial,sans-serif;">${L.listed}</span>
       <span style="font-size:22px;color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;font-weight:600;">$${listing.price.toFixed(0)}</span>
       <span style="color:#bbb;font-size:17px;"> → </span>
       <span style="font-size:22px;color:#8a6a30;font-family:Helvetica,Arial,sans-serif;font-weight:600;">$${evaluation.estimatedValue!.toFixed(0)}</span>
       <span style="font-size:18px;color:#2f7a52;font-family:Helvetica,Arial,sans-serif;font-weight:700;margin-left:10px;">+$${evaluation.margin!.toFixed(0)} ${L.upside}</span>`
    : `<span style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#999;font-family:Helvetica,Arial,sans-serif;">${L.listedPrice}</span>
       <span style="font-size:22px;color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;font-weight:600;">$${listing.price.toFixed(0)}</span>`;

  // Price + vote share one row — folds the old standalone feedback card in
  // here. Vote timing moves earlier (right after image+price, before the
  // story) — a closer-to-gut-reaction signal; worth watching in vote data.
  const priceHtml = `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
        <tr>
          <td style="vertical-align:middle;">${priceText}</td>
          <td align="right" style="vertical-align:middle;white-space:nowrap;">
            <a href="${buildVoteUrl(recipient, item.storyId, "up")}" style="display:inline-block;padding:10px 12px;color:#333;text-decoration:none;font-size:19px;">👍</a>
            <a href="${buildVoteUrl(recipient, item.storyId, "down")}" style="display:inline-block;padding:10px 12px;color:#333;text-decoration:none;font-size:19px;">👎</a>
          </td>
        </tr>
      </table>`;

  return `
  <!-- Item ${index + 1} -->
  <tr>
    <td style="padding-bottom:${isLastItem ? "0" : "56px"};">

      <!-- Era + item number tag -->
      <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td style="padding:4px 10px;background:#2c2c2c;border-radius:2px;">
            <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c8a96e;font-family:Helvetica,Arial,sans-serif;">${evaluation.estimatedEra || "Vintage"}</span>
          </td>
          <td style="padding-left:10px;">
            <span style="font-size:11px;letter-spacing:1px;color:#aaa;font-family:Helvetica,Arial,sans-serif;text-transform:uppercase;">${evaluation.itemIdentification}</span>
          </td>
        </tr>
      </table>

      <!-- Image -->
      ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(listing.title)}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border-radius:4px;margin-bottom:20px;aspect-ratio:4/3;object-fit:cover;">` : ""}

      <!-- Price block (moved above the fold — price before the buy decision) -->
      ${priceHtml}
      ${sizeHtml}

      <!-- eBay CTA — the one bold dark focal element per item -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 24px;">
        <tr>
          <td>
            <a href="${buildClickUrl(recipient, item.storyId)}" style="display:block;padding:14px 28px;background:#2c2c2c;color:#fff;text-decoration:none;font-size:13px;letter-spacing:1px;font-family:Helvetica,Arial,sans-serif;border-radius:2px;text-align:center;">
              ${L.viewOnEbay}
            </a>
          </td>
        </tr>
      </table>

      <!-- Hook -->
      <h2 style="margin:0 0 16px;font-size:21px;font-weight:normal;line-height:1.4;color:#1a1a1a;font-style:italic;">
        "${escapeHtml(evaluation.hook)}"
      </h2>

      <!-- Story — full depth, unshortened; this is the actual product -->
      <h3 style="margin:20px 0 6px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.theStory}</h3>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#333;">
        ${escapeHtml(evaluation.mainStory)}
      </p>

      <!-- Style Guide — one tight line, not a full paragraph -->
      <h3 style="margin:0 0 6px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#2f7a52;font-family:Helvetica,Arial,sans-serif;">${L.theStyle}</h3>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#555;">
        ${escapeHtml(firstSentence(evaluation.styleGuide))}
      </p>

      ${!isLastItem ? '<hr style="border:none;border-top:1px solid #ddd;margin-top:40px;">' : ""}

    </td>
  </tr>`;
}

// styleGuide is generated for depth (see STORY_ONLY_PROMPT) but rendered as
// one tight line — this trims older cached stories written before that
// prompt asked for brevity. New stories should already be short enough that
// this is a no-op.
function firstSentence(text: string, maxLen = 160): string {
  const cut = text.indexOf(". ");
  const candidate = cut > -1 && cut < maxLen ? text.slice(0, cut + 1) : text;
  return candidate.length > maxLen ? candidate.slice(0, maxLen - 1).trimEnd() + "…" : candidate;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
