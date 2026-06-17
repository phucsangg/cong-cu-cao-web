# History of Modifications

## Added Files
- [.node-version](file:///d:/Work/cong-cu-cao-web-ver-2/.node-version): Specified Node.js version `22.17.0` for Netlify deployments to fulfill requirements of `@sparticuz/chromium`.

## Modified Files
- [netlify/functions/scrape.js](file:///d:/Work/cong-cu-cao-web-ver-2/netlify/functions/scrape.js):
  - Isolated `@sparticuz/chromium` to only load when in production Serverless (AWS Lambda) environments, skipping it in local development (`netlify dev`) to prevent executable spawning errors.
  - Added try-catch blocks to request interception functions to prevent requests from hanging.
  - Wrapped `page.evaluate` in a try-catch block to fall back to static HTML scraping via Cheerio if the browser's execution context is destroyed or page is navigating.
- [netlify.toml](file:///d:/Work/cong-cu-cao-web-ver-2/netlify.toml):
  - Added `functions = "netlify/functions"` under `[build]` to ensure the Netlify builder and CLI locate and deploy the serverless functions folder, resolving 404 errors on `/api/*` endpoints.

## Deleted Files
- None.

## Commands Executed
- `npx netlify dev --port 8889 --staticServerPort 8890 --functions-port 4001`: Started local netlify dev server on custom ports for testing.
- `curl.exe "http://localhost:8889/api/scrape?url=https://bepxanh.com/bep-tu.html"`: Verified fast path scraping (Cheerio).
- `curl.exe "http://localhost:8889/api/scrape?url=https://example.com"`: Verified fallback browser path (Puppeteer) and robustness fixes.

## Bugs Found
1. **Fallback Path Bypass on Local Dev (Windows)**: `@sparticuz/chromium` was imported and initialized on local Windows machines because the module is installed. `chromium.executablePath()` returned a folder/path that exists, so `fs.promises.access` succeeded, but running `puppeteer.launch` failed because it's not a valid Windows executable. This bypassed the local Chrome/Edge fallback search.
2. **Hanging Network Requests**: No error handling inside Puppeteer's `page.on('request')` hook, which caused requests to hang on redirect or when already handled, leading to page goto timeouts.
3. **Execution Context Destroyed Error**: If page navigation is delayed or times out, calling `page.evaluate` threw `Execution context was destroyed`, causing the function to crash instead of parsing the loaded HTML.
4. **Node Version Engine Mismatch on Serverless**: `@sparticuz/chromium` v149.0.0 requires Node.js `>= 22.17.0` or `>= 24.0.0`. If Netlify environment uses default Node (e.g. 18 or 20), it would fail to compile or execute.
5. **Missing Functions Directory Config (404 Error)**: The `functions` property was missing in the `[build]` block of `netlify.toml`. This caused Netlify CLI / builder to skip deploying the serverless functions directory, resulting in HTTP 404 when querying `/api/*`.

## Fixes Applied
1. Prevented `@sparticuz/chromium` from loading when not on AWS Lambda or when `NETLIFY_DEV` is true.
2. Added try-catch and `isInterceptResolutionHandled()` checks to Puppeteer request interception.
3. Wrapped `page.evaluate` in a try-catch that falls back to grabbing static `page.content()` and parsing it via Cheerio.
4. Added `.node-version` file to lock Node.js version on Netlify to `22.17.0`.
5. Explicitly defined `functions = "netlify/functions"` under `[build]` in `netlify.toml`.

## Remaining Issues
- None.
