import "dotenv/config";
import { sendDigestEmail } from "../src/services/email";
import type { DigestItem } from "../src/services/email";

const testItems: DigestItem[] = [
  {
    score: 0.91,
    listing: {
      url: "https://www.ebay.com/itm/123456789005",
      platform: "ebay",
      title: "1950s Two-Tone Rayon Bowling Shirt Chain Stitch Embroidery Joes Auto Shop",
      price: 35,
      imageUrls: ["https://i.ebayimg.com/images/g/test/s-l1600.jpg"],
      description: "Vintage 1950s bowling shirt with chain stitch embroidery.",
      rawData: {},
    },
    evaluation: {
      isAuthentic: true,
      itemIdentification: "1950s two-tone rayon bowling shirt, chain stitch embroidery",
      identificationConfidence: 0.92,
      estimatedEra: "1950s",
      estimatedValue: 180,
      currentPrice: 35,
      margin: 145,
      confidence: 0.88,
      reasoning: "Chain stitch bowling shirts are highly collectible.",
      redFlags: [],
      references: [],
      soldListings: [
        { title: "1950s chain stitch bowling shirt two-tone rayon", price: 225, url: null },
      ],
      hook: "Somewhere in postwar America, a man named Joe ran an auto shop, and every Saturday his crew bowled in matching shirts that now outlast his business by seventy years.",
      brandStory: "The custom bowling shirt was the corporate uniform before corporations existed — small businesses outfitting their teams in rayon two-tones, each one a tiny monument to American small-town commerce. The shirts were typically made by regional sportswear companies like King Louie or Swingster, who perfected the chain stitch embroidery that gives them their texture.",
      itemStory: "Chain stitch embroidery loops back on itself — it's structurally different from modern machine embroidery and creates a raised, almost three-dimensional surface. Combined with the two-tone rayon construction, this is the definitive 1950s leisure garment. The 'Joes Auto Shop' chain embroidery on the back is the kind of detail that turns a shirt into a document.",
      historicalContext: "Bowling was the most popular participation sport in 1950s America — more people bowled than played any other organized sport. The league shirt was its uniform, its class equalizer, the garment that put the factory worker and the shop owner on the same team on a Tuesday night.",
      marketContext: "Custom chain stitch bowling shirts are a grail for the workwear and Americana crowd — and this one has the rare trifecta: two-tone rayon, chain stitch embroidery, and a named employer on the back. Named shirts command serious premiums. Rockabilly collectors, Japanese vintage buyers, and the Grailed streetwear crowd all want this shirt for different reasons. At $35 it's not even a decision.",
      storyScore: 0.91,
      storyScoreReasoning: "Exceptional narrative payload — the custom embroidery transforms this from a garment into a primary source document of postwar American working-class culture.",
    },
  },
];

await sendDigestEmail(testItems, ["adrian.aa.chang.aa@gmail.com"]);
console.log("Done.");
