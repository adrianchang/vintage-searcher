# Post Daily Threads Update

Post today's update to one or both Threads channels — Chinese (**@bear.7306501**) and English (**@wolf.2833331**). Adrian writes the actual title/content himself; this command handles the posting mechanics and verifies the post actually went live (a 200 response only means the token was valid, not that the carousel finished publishing).

## Usage

If Adrian hasn't already given title + content for each language he wants posted, ask for them. Either language can be posted alone or both together.

## Steps

1. **Write each language's payload to a scratchpad JSON file** (not inline in the curl command) — avoids shell-escaping issues with Chinese text and quotes:
   ```json
   {"title":"...","intro":"..."}
   ```

2. **POST to the app, one call per account:**
   ```bash
   curl -s -X POST "https://vintage-searcher.onrender.com/threads?account=zh" \
     -H "Content-Type: application/json" \
     -H "x-api-key: VBMc+AXdYT1YAGgKUC/uMnOmT4xL5fn9nFzIJO/GBIo=" \
     --data @<zh-payload-file>

   curl -s -X POST "https://vintage-searcher.onrender.com/threads?account=en" \
     -H "Content-Type: application/json" \
     -H "x-api-key: VBMc+AXdYT1YAGgKUC/uMnOmT4xL5fn9nFzIJO/GBIo=" \
     --data @<en-payload-file>
   ```
   A `{"status":"ok",...}` response just means the token was resolved and the request accepted — the actual carousel (images + reply) is posted async and can take 30–90+ seconds.

3. **Verify each post actually went live** — don't stop at the 200 response. Fetch the account's live token from the prod DB and list recent posts via the Threads Graph API:
   - Prod DB connection string: see memory `reference_prod_db.md`
   - `AppCredential` key: `threads_access_token` for zh, `threads_access_token_en` for en
   - `SELECT value FROM "AppCredential" WHERE key='<key>';`
   - `GET https://graph.threads.net/v1.0/me?fields=id,username&access_token=<token>` → get the account's user id
   - `GET https://graph.threads.net/v1.0/{user_id}/threads?fields=id,text,timestamp,media_type,permalink&limit=3&access_token=<token>` → confirm a new `CAROUSEL_ALBUM` with today's timestamp and matching title text appears
   - If it's not there yet, wait — carousel posts take time to process. Don't report success until confirmed live.

4. **Report back** the permalink(s) for whichever account(s) were posted.

## Notes

- Each account posts from a different source user's last 3 `StoryDelivery` rows: zh from `adrian.aa.chang@gmail.com`'s zh deliveries, en from `adrian.aa.chang.aa@gmail.com`'s en deliveries. If Adrian's content references specific items, it should match what's actually in today's digest for that account — check the deliveries if unsure.
- This command does not generate the title/content — Adrian writes it himself. Don't draft copy unless he explicitly asks for a suggestion.
