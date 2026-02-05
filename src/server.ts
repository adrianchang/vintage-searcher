import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "vintage-searcher" });
});

// eBay marketplace account deletion notification (required for compliance)
// https://developer.ebay.com/marketplace-account-deletion
app.get("/ebay/webhook", (req, res) => {
  // eBay sends a challenge_code for verification
  const challengeCode = req.query.challenge_code as string;

  if (challengeCode) {
    // For verification, eBay expects the challenge code echoed back
    // In production, you should hash it with your verification token
    console.log("eBay verification challenge received:", challengeCode);
    res.set("Content-Type", "application/json");
    res.json({ challengeResponse: challengeCode });
  } else {
    res.json({ status: "webhook endpoint ready" });
  }
});

app.post("/ebay/webhook", (req, res) => {
  // Handle eBay notifications (account deletion, etc.)
  console.log("eBay webhook received:", req.body);
  res.status(200).send("OK");
});

// eBay OAuth callback
app.get("/ebay/auth/callback", (req, res) => {
  const { code, state } = req.query;

  if (code) {
    console.log("eBay OAuth code received:", code);
    // TODO: Exchange code for access token
    res.send(`
      <html>
        <body>
          <h1>Authorization successful!</h1>
          <p>Code received. You can close this window.</p>
          <pre>${code}</pre>
        </body>
      </html>
    `);
  } else {
    res.status(400).send("No authorization code received");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`eBay webhook endpoint: http://localhost:${PORT}/ebay/webhook`);
  console.log(`eBay OAuth callback: http://localhost:${PORT}/ebay/auth/callback`);
});
