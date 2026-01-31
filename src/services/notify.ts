import type { Listing, Evaluation } from "../types";

interface Opportunity {
  listing: Listing;
  evaluation: Evaluation;
}

// TODO: Implement notification (Discord webhook, email, SMS, etc.)
export async function sendAlert(opportunities: Opportunity[]): Promise<void> {
  // For now, just log to console
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

  // TODO: Implement Discord webhook
  // const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  // if (webhookUrl) {
  //   await fetch(webhookUrl, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ content: formatOpportunities(opportunities) }),
  //   });
  // }
}
