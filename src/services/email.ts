import { Resend } from "resend";
import type { Listing, Evaluation } from "../types";
import { combinedScore, priceScore } from "./score";

const FROM_ADDRESS = process.env.EMAIL_FROM || "finds@vintagefinds.email";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

function getResend() {
  return new Resend(RESEND_API_KEY);
}

export interface DigestItem {
  listing: Listing;
  evaluation: Evaluation;
  score: number;
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
    theBrand: "The Brand",
    thisPiece: "This Piece",
    theMoment: "The Moment",
    theMarket: "The Market",
    theStyle: "The Style",
    storyScore: "Story score",
    combined: "Combined",
    viewOnEbay: "View on eBay →",
    footer: "You're receiving this because you signed up for daily vintage finds.<br>Prices and availability change — always verify before purchasing.",
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
    theBrand: "品牌故事",
    thisPiece: "單品",
    theMoment: "時代背景",
    theMarket: "行情",
    theStyle: "穿搭指南",
    storyScore: "故事分",
    combined: "綜合分",
    viewOnEbay: "前往 eBay 查看 →",
    footer: "你收到這封信，因為你訂閱了每日古著精選。<br>價格與庫存隨時變動，購買前請自行確認。",
  },
};

export async function sendDigestEmail(
  items: DigestItem[],
  recipients: string[],
  lang = "en",
): Promise<void> {
  if (recipients.length === 0) {
    console.log("No recipients — skipping email");
    return;
  }
  if (items.length === 0) {
    console.log("No items — skipping email");
    return;
  }

  const html = buildEmailHtml(items, lang);
  const subject = buildSubject(items, lang);

  if (!RESEND_API_KEY) {
    console.log(`[EMAIL] Would send "${subject}" to ${recipients.length} recipient(s) with ${items.length} finds (RESEND_API_KEY not set)`);
    return;
  }

  const resend = getResend();
  for (const to of recipients) {
    try {
      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to,
        subject,
        html,
      });
      if (error) {
        console.error(`[EMAIL] Failed to send to ${to}:`, error);
      } else {
        console.log(`[EMAIL] Sent to ${to}`);
      }
    } catch (err) {
      console.error(`[EMAIL] Error sending to ${to}:`, err);
    }
  }
}

function buildSubject(items: DigestItem[], lang = "en"): string {
  if (lang === "zh") {
    const date = new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric" });
    if (items.length === 1) return `🏷️ 今日好物 — ${items[0].evaluation.itemIdentification} · ${date}`;
    return `🏷️ ${items.length} 件好物等你來看 · ${date}`;
  }
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  if (items.length === 1) return `🏷️ TODAY'S FIND — ${items[0].evaluation.itemIdentification.toUpperCase()} · ${date.toUpperCase()}`;
  return `🏷️ ${items.length} FINDS WORTH YOUR ATTENTION · ${date.toUpperCase()}`;
}

function buildEmailHtml(items: DigestItem[], lang = "en"): string {
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

          <!-- Intro line -->
          <tr>
            <td style="padding:24px 0 32px;">
              <p style="margin:0;font-size:16px;line-height:1.7;color:#444;font-style:italic;">
                ${L.intro}
              </p>
            </td>
          </tr>

          <!-- Items -->
          ${items.map((item, index) => buildItemHtml(item, index, items.length, L)).join("")}

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

function buildItemHtml(item: DigestItem, index: number, total: number, L: Record<string, string>): string {
  const { listing, evaluation } = item;
  const imageUrl = listing.imageUrls[0] || "";
  const pScore = priceScore(evaluation);
  const cScore = combinedScore(evaluation);
  const isUndervalued = evaluation.margin != null && evaluation.estimatedValue != null && pScore > 0.2;
  const isLastItem = index === total - 1;

  const redFlagsHtml = evaluation.redFlags.length > 0
    ? `<tr>
        <td style="padding-top:16px;">
          <p style="margin:0;font-size:12px;color:#999;font-family:Helvetica,Arial,sans-serif;font-style:italic;">
            ⚠ ${evaluation.redFlags.join(" · ")}
          </p>
        </td>
      </tr>`
    : "";

  const priceHtml = isUndervalued
    ? `<table cellpadding="0" cellspacing="0" style="margin-top:24px;background:#1a1a1a;border-radius:4px;overflow:hidden;">
        <tr>
          <td style="padding:16px 24px;">
            <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.theNumbers}</p>
            <table cellpadding="0" cellspacing="0" style="margin-top:8px;width:100%;">
              <tr>
                <td>
                  <span style="font-size:13px;color:#aaa;font-family:Helvetica,Arial,sans-serif;">${L.listed}</span><br>
                  <span style="font-size:22px;color:#fff;font-family:Helvetica,Arial,sans-serif;font-weight:300;">$${listing.price.toFixed(0)}</span>
                </td>
                <td style="padding:0 20px;color:#555;font-size:20px;font-family:Helvetica,Arial,sans-serif;" align="center">→</td>
                <td>
                  <span style="font-size:13px;color:#aaa;font-family:Helvetica,Arial,sans-serif;">${L.estValue}</span><br>
                  <span style="font-size:22px;color:#c8a96e;font-family:Helvetica,Arial,sans-serif;font-weight:300;">$${evaluation.estimatedValue!.toFixed(0)}</span>
                </td>
                <td align="right">
                  <span style="font-size:11px;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.upside}</span><br>
                  <span style="font-size:22px;color:#7ec8a0;font-family:Helvetica,Arial,sans-serif;font-weight:300;">+$${evaluation.margin!.toFixed(0)}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`
    : `<table cellpadding="0" cellspacing="0" style="margin-top:24px;background:#1a1a1a;border-radius:4px;overflow:hidden;">
        <tr>
          <td style="padding:16px 24px;">
            <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.listedPrice}</p>
            <span style="font-size:22px;color:#fff;font-family:Helvetica,Arial,sans-serif;font-weight:300;">$${listing.price.toFixed(0)}</span>
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
      ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(listing.title)}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border-radius:4px;margin-bottom:28px;aspect-ratio:4/3;object-fit:cover;">` : ""}

      <!-- Hook -->
      <h2 style="margin:0 0 20px;font-size:21px;font-weight:normal;line-height:1.5;color:#1a1a1a;font-style:italic;">
        "${escapeHtml(evaluation.hook)}"
      </h2>

      <!-- Price block -->
      ${priceHtml}

      <!-- Brand Story -->
      <h3 style="margin:24px 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.theBrand}</h3>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#333;">
        ${escapeHtml(evaluation.brandStory)}
      </p>

      <!-- Item Story -->
      <h3 style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.thisPiece}</h3>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#333;">
        ${escapeHtml(evaluation.itemStory)}
      </p>

      <!-- Historical Context -->
      <h3 style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;font-family:Helvetica,Arial,sans-serif;">${L.theMoment}</h3>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#333;">
        ${escapeHtml(evaluation.historicalContext)}
      </p>

      <!-- Market Context -->
      <h3 style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#c8a96e;font-family:Helvetica,Arial,sans-serif;">${L.theMarket}</h3>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#333;">
        ${escapeHtml(evaluation.marketContext)}
      </p>

      <!-- Style Guide -->
      <h3 style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#7ec8a0;font-family:Helvetica,Arial,sans-serif;">${L.theStyle}</h3>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#333;">
        ${escapeHtml(evaluation.styleGuide)}
      </p>

      <!-- Red flags -->
      <table width="100%" cellpadding="0" cellspacing="0">
        ${redFlagsHtml}
      </table>

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr>
          <td align="right">
            <a href="${listing.url}" style="display:inline-block;padding:12px 28px;background:#2c2c2c;color:#fff;text-decoration:none;font-size:13px;letter-spacing:1px;font-family:Helvetica,Arial,sans-serif;border-radius:2px;">
              ${L.viewOnEbay}
            </a>
          </td>
        </tr>
      </table>

      ${!isLastItem ? '<hr style="border:none;border-top:1px solid #ddd;margin-top:56px;">' : ""}

    </td>
  </tr>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
