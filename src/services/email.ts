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

// Not signed/personal like the links above — this points at a public page
// (GET /story/:id in server.ts) meant to be forwarded to strangers, so it
// deliberately carries no email or token.
export function buildStoryShareUrl(storyId: string): string {
  return `${APP_URL}/story/${storyId}`;
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
    visitWebsite: "Visit our website →",
    tryOnTitle: "Try It On",
    tryOnSub: "Pick one — one try per email.",
    tryOnFirst: "First Item",
    tryOnSecond: "Second Item",
    tryOnThird: "Third Item",
    shareThisFind: "Share this find →",
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
    visitWebsite: "前往我們的網站 →",
    tryOnTitle: "試穿",
    tryOnSub: "選一件 — 每封信限一次。",
    tryOnFirst: "第一件",
    tryOnSecond: "第二件",
    tryOnThird: "第三件",
    shareThisFind: "分享這件單品 →",
  },
};

export async function sendDigestEmail(
  items: DigestItem[],
  recipient: string,
  lang = "en",
): Promise<void> {
  if (!recipient) {
    console.log("No recipient — skipping email");
    return;
  }
  if (items.length === 0) {
    console.log("No items — skipping email");
    return;
  }

  const html = buildEmailHtml(items, recipient, lang);
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

function buildEmailHtml(items: DigestItem[], recipient: string, lang = "en"): string {
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

          <!-- Try-on picker — always shown, front and center, before the intro, so
               it's seen without scrolling through the full digest. Clicking without
               a photo on file prompts for one right on /tryon itself (see server.ts) —
               no separate nudge/upload step needed here. -->
          ${buildTryOnPickerHtml(items, recipient, L)}

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
              <p style="margin:0 0 12px;font-size:11px;color:#aaa;line-height:1.8;font-family:Helvetica,Arial,sans-serif;text-align:center;">
                ${L.footer}
              </p>
              <p style="margin:0;font-size:11px;text-align:center;">
                <a href="${APP_URL}/" style="color:#8a6a30;text-decoration:none;font-family:Helvetica,Arial,sans-serif;">${L.visitWebsite}</a>
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

// Image-led picker, shown up front (before the full digest) so the "which one
// would you try on" signal doesn't require reading the whole email first.
// Originally text-only (deliberately, to avoid picture-then-bounce), but that
// bet didn't pay off — click-through stayed low regardless. Reversed
// 2026-09-06: let the item's own photo sell the try-on instead of hoping the
// story text earns it — see product_design.md's 2026-09-06 entry. Uses the
// same hasProcessedImage-aware cutout image as the item cards below, not the
// raw eBay photo, so the picker matches the clean studio look used everywhere
// else. Real buttons, not text links — low click-through (13% of recipients
// as of 2026-08-28) was traced partly to the old row style reading as a quiet
// list rather than something to click. Gold background (the brand accent,
// unused elsewhere as a button fill) deliberately differentiates these from
// the dark eBay CTA buttons below each item — a different, "just for fun" action.
function buildTryOnPickerHtml(items: DigestItem[], recipient: string, L: Record<string, string>): string {
  // Rounder corners + a soft gold-tinted shadow than the sharp/flat eBay CTA
  // (2px radius, no shadow) — a little more "tap me" tactility for a button
  // that's meant to feel like a fun extra, not a transactional link.
  const ordinals = [L.tryOnFirst, L.tryOnSecond, L.tryOnThird];
  const buttons = items.map((item, index) => {
    const imageUrl = item.evaluation.hasProcessedImage
      ? `${APP_URL}/evaluations/${item.evaluation.id}/image`
      : (item.listing.imageUrls[0] || "");
    return `
          <tr>
            <td style="padding-bottom:${index === items.length - 1 ? "0" : "10px"};">
              <a href="${buildTryOnUrl(recipient, item.storyId)}" style="display:block;text-decoration:none;background:#c8a96e;border-radius:6px;box-shadow:0 2px 5px rgba(200,169,110,0.45);">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="56" style="padding:8px;">
                      <img src="${imageUrl}" width="56" height="72" alt="" style="display:block;width:56px;height:72px;object-fit:cover;border-radius:4px;background:#f5f0eb;">
                    </td>
                    <td style="padding:8px 20px 8px 4px;color:#1a1a1a;font-size:14px;font-weight:bold;letter-spacing:0.2px;font-family:Helvetica,Arial,sans-serif;">
                      ${escapeHtml(shortItemName(item.evaluation.itemIdentification))} — ${ordinals[index] ?? ""} <span style="margin-left:4px;">→</span>
                    </td>
                  </tr>
                </table>
              </a>
            </td>
          </tr>`;
  }).join("");

  // Warm dark taupe (lighter than the era tags' near-black #2c2c2c) instead of
  // the near-invisible off-white card — a real color block at the top of the
  // email reads as "featured," not just another quiet section. padding-top
  // keeps it from touching the header's border-bottom rule directly above.
  return `
          <tr>
            <td style="padding-top:24px;padding-bottom:32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#524c42;border-radius:8px;">
                <tr>
                  <td style="padding:20px 22px;">
                    <p style="margin:0 0 4px;font-size:14px;font-weight:bold;color:#f5f0eb;font-family:Helvetica,Arial,sans-serif;">${L.tryOnTitle}</p>
                    <p style="margin:0 0 16px;font-size:13px;color:#b8b1a6;font-family:Helvetica,Arial,sans-serif;">${L.tryOnSub}</p>
                    <table width="100%" cellpadding="0" cellspacing="0">${buttons}</table>
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
       <span style="font-size:18px;color:#2f7a52;font-family:Helvetica,Arial,sans-serif;font-weight:700;margin-left:10px;">${evaluation.margin! >= 0 ? "+" : "-"}$${Math.abs(evaluation.margin!).toFixed(0)} ${L.upside}</span>`
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

      <!-- Share — a small unobtrusive text link, not another button, so it
           doesn't compete with the eBay CTA (deliberately kept lightweight
           given how packed each item card already is). Points at a public,
           unsigned page (see buildStoryShareUrl) meant to be forwarded. -->
      <p style="margin:0 0 20px;">
        <a href="${buildStoryShareUrl(item.storyId)}" style="font-size:12px;color:#999;text-decoration:underline;font-family:Helvetica,Arial,sans-serif;">${L.shareThisFind}</a>
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
