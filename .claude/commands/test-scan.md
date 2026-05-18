# Test Scan

Trigger a test scan on the production server. Test mode caps at 10 listings and sends email only to adrian.aa.chang.aa@gmail.com.

```bash
curl -s -X POST \
  "https://vintage-searcher.onrender.com/scan?test=true" \
  -H "x-api-key: VBMc+AXdYT1YAGgKUC/uMnOmT4xL5fn9nFzIJO/GBIo="
```

The server responds immediately with `{"status":"ok","message":"Scan started"}` — the scan runs async in the background. Check your email in a few minutes for results.

**How it differs from prod:**
- `maxListings: 10` instead of 20
- Only delivers to `adrian.aa.chang.aa@gmail.com` and `adrian.aa.chang@gmail.com`
- Uses the same real pipeline: eBay fetch → filter → Gemini identify/value → story → email
