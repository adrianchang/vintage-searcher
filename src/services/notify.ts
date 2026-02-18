import type { Listing, Evaluation } from "../types";

interface Opportunity {
  listing: Listing;
  evaluation: Evaluation;
}

interface DiscordEmbed {
  title: string;
  url: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export async function sendAlert(opportunities: Opportunity[]): Promise<void> {
  // Always log to console
  logToConsole(opportunities);

  // Send to Discord if webhook URL is configured
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (webhookUrl) {
    await sendDiscordAlert(webhookUrl, opportunities);
  }
}

function logToConsole(opportunities: Opportunity[]): void {
  console.log("\n=== OPPORTUNITIES FOUND ===\n");

  for (const { listing, evaluation } of opportunities) {
    console.log(`Title: ${listing.title}`);
    console.log(`URL: ${listing.url}`);
    console.log(`Listed Price: $${listing.price}`);
    console.log(`Estimated Value: $${evaluation.estimatedValue}`);
    console.log(`Potential Margin: $${evaluation.margin}`);
    console.log(`Era: ${evaluation.estimatedEra}`);
    console.log(`Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`);
    console.log(`Reasoning: ${evaluation.reasoning}`);
    if (evaluation.redFlags.length > 0) {
      console.log(`Red Flags: ${evaluation.redFlags.join(", ")}`);
    }
    console.log(`References: ${evaluation.references.join(", ")}`);
    console.log("\n---\n");
  }
}

async function sendDiscordAlert(webhookUrl: string, opportunities: Opportunity[]): Promise<void> {
  // Discord has a limit of 10 embeds per message
  const embeds = opportunities.slice(0, 10).map(({ listing, evaluation }) => {
    const embed: DiscordEmbed = {
      title: truncate(listing.title, 256),
      url: listing.url,
      color: getColorByMargin(evaluation.margin),
      fields: [
        {
          name: "Price",
          value: `$${listing.price} → ${evaluation.estimatedValue != null ? `$${evaluation.estimatedValue}` : "N/A"}`,
          inline: true,
        },
        {
          name: "Margin",
          value: evaluation.margin != null ? `$${evaluation.margin}` : "N/A",
          inline: true,
        },
        {
          name: "Confidence",
          value: `${(evaluation.confidence * 100).toFixed(0)}%`,
          inline: true,
        },
        {
          name: "Era",
          value: evaluation.estimatedEra || "Unknown",
          inline: true,
        },
        {
          name: "Reasoning",
          value: truncate(evaluation.reasoning, 1024),
          inline: false,
        },
      ],
      footer: {
        text: `Platform: ${listing.platform}`,
      },
    };

    // Add red flags if present
    if (evaluation.redFlags.length > 0) {
      embed.fields.push({
        name: "Red Flags",
        value: truncate(evaluation.redFlags.join(", "), 1024),
        inline: false,
      });
    }

    // Add references if present
    if (evaluation.references.length > 0) {
      embed.fields.push({
        name: "References",
        value: truncate(evaluation.references.join("\n"), 1024),
        inline: false,
      });
    }

    return embed;
  });

  const payload = {
    content: `🔍 **Found ${opportunities.length} vintage opportunity${opportunities.length > 1 ? "s" : ""}!**`,
    embeds,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`Discord webhook failed: ${response.status} ${response.statusText}`);
      console.error(`Discord response body: ${body}`);
      console.error(`Payload sent: ${JSON.stringify(payload, null, 2)}`);
    } else {
      console.log(`Discord notification sent for ${opportunities.length} opportunities`);
    }
  } catch (error) {
    console.error("Failed to send Discord notification:", error);
  }
}

// Color based on margin: green for high, yellow for medium, orange for low
function getColorByMargin(margin: number | null): number {
  if (margin == null) return 0xffa500;
  if (margin >= 150) return 0x00ff00; // Green
  if (margin >= 100) return 0x7cfc00; // Light green
  if (margin >= 75) return 0xffff00;  // Yellow
  return 0xffa500;                     // Orange
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
