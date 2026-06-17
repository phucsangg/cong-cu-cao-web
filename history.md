# History of Modifications

## Added Files
- [.node-version](file:///d:/Work/cong-cu-cao-web-ver-2/.node-version): Specified Node.js version `22.17.0` for Netlify deployments to fulfill requirements of `@sparticuz/chromium`.

## Modified Files
- [netlify/functions/scrape.js](file:///d:/Work/cong-cu-cao-web-ver-2/netlify/functions/scrape.js):
  - Isolated `@sparticuz/chromium` to only load when in production Serverless (AWS Lambda) environments, skipping it in local development (`netlify dev`) to prevent executable spawning errors.
  - Added try-catch blocks to request interception functions to prevent requests from hanging.
  - Wrapped `page.evaluate` in a try-catch block to fall back to static HTML scraping via Cheerio if the browser's execution context is destroyed or page is navigating.
  - Replaced the top-level CommonJS `require('puppeteer-core')` with an asynchronous dynamic `import('puppeteer-core')` inside the handler function to avoid `ERR_REQUIRE_ESM` when running on AWS Lambda.
  - Implemented DOM tree-distance proximity matching (using custom `getCheerioDistance` and `getDOMDistance` helpers) in both Cheerio and Puppeteer paths to associate each price node with its mathematically closest title/link. This resolves cross-talk and duplication issues when crawing pages containing multiple product sections/grids.
  - Added `isLayoutContainer` helper to prevent parent traversal from going up into layout-level containers (like grids, rows, lists, body, main). This limits parent traversal to single-product cards, preventing runaway page-wide `querySelectorAll` searches and resolving the HTTP 502 function timeout.
  - Increased Cheerio fast-path threshold from 3 to 8. This avoids returning recommended/featured items prematurely on category pages that render main products dynamically.
  - Merged remote `phucsang/main` changes containing general `<script>` tag selection logic for `productSaleSetup` extraction.
- [netlify.toml](file:///d:/Work/cong-cu-cao-web-ver-2/netlify.toml):
  - Added `functions = "netlify/functions"` under `[build]` to ensure the Netlify builder and CLI locate and deploy the serverless functions folder, resolving 404 errors on `/api/*` endpoints.
- [public/index.html](file:///d:/Work/cong-cu-cao-web-ver-2/public/index.html):
  - Merged new UI changes from remote branch. Added SKU (Mã sản phẩm) and Series parsing, display in UI table/grid, searching capabilities, and CSV/Shopify export mapping.
  - Changed the early-exit condition to break the sequential page loop if a page yields 0 new items (`newCount === 0`) instead of `products.length === 0`. This stops useless repeated crawing of identical pages.
  - Cleaned up redundant early stop checks in frontend logic after merging remote `phucsang/main` changes.
  - Redesigned and updated `extractSku` to use case-sensitive matching, list of excluded common words (e.g. gas, vùng, nấu, etc.), and immediate validation bypass for Hafele dotted codes, resolving inaccurate and false-positive extraction.
  - Added URL input mode switcher (Single manual URL vs .txt file upload containing a list of newline-separated URLs) to support bulk category crawling in a single execution.
  - Replaced collapsible accordion with an always-visible, beautifully styled glass advanced settings panel to improve UX.
  - Added a Jaccard token-based similarity fuzzy matching algorithm (with a 60% threshold, excluding catalog stop words) to match and group products that do not have an extracted SKU/Series.
  - Added a Price Comparison View ('So sánh' tab mode) that clusters products by SKU or Jaccard similarity and highlights the lowest ('Rẻ nhất') and highest ('Cao nhất') prices in real-time.
  - Implemented real-time tracking and display of global minimum and maximum prices with matching product details in the dashboard metrics.
  - Added fault-tolerance to the bulk URL list execution: failed pages or category links are skipped after logging the reason, allowing subsequent category URLs to run.
  - Implemented a post-campaign warning report listing all failed URLs and failure reasons in the terminal panel and final alert box.
  - Added option to select between a fixed page count ("Nhất định") or crawling all available pages of a category ("Toàn bộ trang").
  - Removed "MS", "GB", "TB", and "MB" from SKU excluded words to allow correct extraction of kitchen appliance model codes.
  - Added material filter rules to prevent steel specifications (such as INOX, SUS, SS304, etc.) from being incorrectly extracted as product SKUs.
  - Rewrote product comparison grouping rules to group strictly by SKU and Series.
  - Implemented name conflict detection (`hasConflict` heuristic) and added material/utensil stopWords in fuzzy matching to prevent incorrect grouping of different items (e.g. different sizes/types).
  - Refined Pattern 2 regex matching boundary rules in `extractSku` to allow single-letter brand prefixes (e.g. `K-` in `K-10540`) while rejecting ASCII boundaries on Unicode letters (such as `4 s`).
  - Added package quantity/combo signature detection (`getPackSignature`) to differentiate and separate single products from combos or packs containing multiple items or different sets.
  - Hardcoded custom series suffix matching for generic 2-4 uppercase letter suffixes (like `MCB` or `PGR`) to prevent mismatched price comparisons.
- [test-fetch.mjs](file:///d:/Work/cong-cu-cao-web-ver-2/test-fetch.mjs):
  - Updated SKU/Series extraction testing logic to align with the frontend improvements.

## Deleted Files
- None.

## Commands Executed
- `npx netlify dev --port 8889 --staticServerPort 8890 --functions-port 4001`: Started local netlify dev server on custom ports for testing.
- `curl.exe "http://localhost:8889/api/scrape?url=https://bepxanh.com/bep-tu.html"`: Verified fast path scraping (Cheerio).
- `curl.exe "http://localhost:8889/api/scrape?url=https://example.com"`: Verified fallback browser path (Puppeteer) and robustness fixes.
- `git remote set-url origin https://github.com/tomyrese/crawldata.git`: Changed remote origin to user's repository.
- `git push -u origin main`: Pushed codebase to user's repository.
- `git commit -am "Fix require of ES Module puppeteer-core on Netlify" && git push origin main`: Pushed the dynamic import fix.
- `git remote add phucsang https://github.com/phucsangg/cong-cu-cao-web-ver-2.git`: Added phucsang repository as remote.
- `git push phucsang main`: Pushed final codebase with fixes to phucsang's repository.
- `git status`: Checked working directory status.
- `git remote -v`: Verified configure git remotes.
- `git fetch phucsang`: Fetched updates from phucsang remote.
- `git log HEAD..phucsang/main --oneline`: Evaluated incoming commits from the phucsang remote.
- `git merge phucsang/main`: Fast-forwarded local branch to the latest remote state.
- `git config --local user.email "phuquynguyen458@gmail.com"`: Configured local Git email.
- `git config --local user.name "Wuys"`: Configured local Git name.
- `git push origin main`: Pushed the merged commits to the origin remote.
- `node -c netlify/functions/scrape.js`: Syntax-checked scrape.js.
- `git commit -am "fix: implement DOM distance-based proximity matching to resolve multi-section product scraping collisions"`: Committed code changes.
- `git push origin main`: Pushed updates to origin remote.
- `git commit -am "fix: raise Cheerio fast-path threshold and stop page crawing on zero new items"`: Committed threshold and page-exit fixes.
- `git push origin main`: Pushed updates to origin remote.
- `git push origin main`: Pushed updates to origin remote.
- `git fetch phucsang`: Fetched remote branch from phucsang remote.
- `git merge phucsang/main`: Merged remote commits from phucsang/main into local main.
- `git push phucsang main`: Pushed final codebase with fixes to phucsang's repository.
- `node test-fetch.mjs`: Verified updated SKU/Series extraction logic with real catalog data.
- `npx netlify dev --port 8889 --staticServerPort 8890 --functions-port 4001`: Ran local server to verify TXT import loop crawling and new dashboard UI changes.
- `git add public/index.html history.md`: Staged recent changes.
- `git commit -m "feat: add support for importing list of URLs from TXT file and make advanced configuration panel always visible"`: Committed TXT import and advanced config panel.
- `git push origin main` / `git push phucsang main`: Synchronized remotes with TXT import features.
- `Remove-Item test_urls.txt`: Deleted temporary file used during testing.
- `git commit -am "feat: implement real-time global price boundaries and fault-tolerant bulk crawing loop"`: Committed min/max prices and crawing loop fault-tolerance.
- `git pull phucsang main --rebase`: Resolved remote push conflict on phucsang branch.
- `git push origin main --force` / `git push phucsang main`: Pushed rebased commits to both remotes.

## Bugs Found
1. **Fallback Path Bypass on Local Dev (Windows)**: `@sparticuz/chromium` was imported and initialized on local Windows machines because the module is installed. `chromium.executablePath()` returned a folder/path that exists, so `fs.promises.access` succeeded, but running `puppeteer.launch` failed because it's not a valid Windows executable. This bypassed the local Chrome/Edge fallback search.
2. **Hanging Network Requests**: No error handling inside Puppeteer's `page.on('request')` hook, which caused requests to hang on redirect or when already handled, leading to page goto timeouts.
3. **Execution Context Destroyed Error**: If page navigation is delayed or times out, calling `page.evaluate` threw `Execution context was destroyed`, causing the function to crash instead of parsing the loaded HTML.
4. **Node Version Engine Mismatch on Serverless**: `@sparticuz/chromium` v149.0.0 requires Node.js `>= 22.17.0` or `>= 24.0.0`. If Netlify environment uses default Node (e.g. 18 or 20), it would fail to compile or execute.
5. **Missing Functions Directory Config (404 Error)**: The `functions` property was missing in the `[build]` block of `netlify.toml`. This caused Netlify CLI / builder to skip deploying the serverless functions directory, resulting in HTTP 404 when querying `/api/*`.
6. **ERR_REQUIRE_ESM on AWS Lambda for puppeteer-core**: `puppeteer-core` version 25.1.0 is a pure ES Module. Calling `require('puppeteer-core')` at the top level of a CommonJS file (`scrape.js`) throws `ERR_REQUIRE_ESM` when executed in the production AWS Lambda environment, crashing the serverless endpoint and returning a 502 Bad Gateway.
7. **Cross-talk & Duplicate Filtering in Multi-Section Pages**: In pages containing multiple product sections or grids, crawing got stuck repeatedly crawing only 1 section (getting duplicate entries of the first section's items). This happened because the scraper traversed up to 5 levels to find product titles and links, but when it reached a higher-level container (such as a row, swiper wrapper, or grid) containing multiple products, it called `querySelectorAll` or `.find()` globally on it, returning the first product's title for *all* products in that container. The de-duplication stage then discarded all other products as duplicates.
8. **Premature Cheerio Fast-Path Success on Dynamic Category Pages**: When crawing dynamic category pages (e.g. `bep-tu.html`), the raw HTML contains no actual products but has a few featured/recommended products statically rendered. The Cheerio fast-path scraped these 4-6 featured products. Since this is >= 3 (the original threshold), the scraper returned them immediately and skipped Puppeteer. On page 2, 3, etc., the scraper fetched the same static HTML, returning the same featured products which were discarded as duplicates, resulting in 0 new products.
9. **Infinite Page Fetch Loop on Duplicate Pages**: If a category page ignores page parameters (e.g. returning page 1's products on page 2) or has only 1 page, the scraper got stuck in an infinite page-crawing loop because the break condition only checked if `products.length === 0`, which is false since it keeps returning the same products.
10. **Runaway Page-Wide DOM Distance Calculation & Function Timeout (HTTP 502)**: When crawing pages where certain price nodes did not have valid titles close by, parent traversal went up to the root element (`<body>` or `<html>`). At this level, it performed `parent.querySelectorAll` which returned thousands of elements, and calculated tree-distance for each of them. This O(N^2) complexity froze the browser thread during `page.evaluate`, causing the Netlify Function to hang and time out, resulting in HTTP 502 Bad Gateway after 40 seconds.
11. **Inaccurate and False-Positive SKU and Series Extraction**: The model extraction regex used case-insensitive matching (`/i`) which caused normal lowercase words like "gas 3" in "Bếp gas 3 vùng nấu" to be incorrectly matched as a product SKU. It also struggled with complex hyphenated model numbers (like `HS20-SSN2R90M` which was split into two separate codes) and failed to extract purely numeric Hafele article codes (`536.01.695`) due to requiring at least one letter.

## Fixes Applied
1. Prevented `@sparticuz/chromium` from loading when not on AWS Lambda or when `NETLIFY_DEV` is true.
2. Added try-catch and `isInterceptResolutionHandled()` checks to Puppeteer request interception.
3. Wrapped `page.evaluate` in a try-catch that falls back to grabbing static `page.content()` and parsing it via Cheerio.
4. Added `.node-version` file to lock Node.js version on Netlify to `22.17.0`.
5. Explicitly defined `functions = "netlify/functions"` under `[build]` in `netlify.toml`.
6. Loaded `puppeteer-core` dynamically inside the handler via `await import('puppeteer-core')` to support ES module loading in a CommonJS function.
7. **DOM Distance Proximity Matching**: Replaced the first-match logic in parent traversal with tree-distance calculation (`getCheerioDistance` in Cheerio, `getDOMDistance` in Puppeteer). Now, the scraper evaluates all candidate titles/links under the parent and pairs each price node with its mathematically closest title/link in the DOM tree.
8. **Increased Fast-Path Threshold**: Increased the fast-path Cheerio threshold from 3 to 8. Category pages with fewer than 8 static products will fallback to Puppeteer to execute JS, scroll, and capture all products.
9. **New Product Exit Condition**: Changed the break condition in sequential crawing to stop if a page yields 0 new/unique products (`newCount === 0`) instead of `products.length === 0`.
10. **Layout Container Early Break**: Added `isLayoutContainer` check during parent traversal. It immediately breaks the loop when hitting multi-product layout elements (like rows, grids, lists, sections, main, or page body), keeping searches local to single-product cards and avoiding runaway calculations.
11. **Refined SKU and Series Extraction**: Updated `extractSku` in `public/index.html` to use a strict case-sensitive regex for uppercase brand prefixes and model numbers. Introduced a comprehensive validator (`isValidSku` logic) to filter out common Vietnamese kitchen catalog words and general measurement units. Added an immediate bypass check for Hafele-style dotted codes, and improved hyphenated/slashed model group support.

- [public/index.html](file:///d:/Work/cong-cu-cao-web-ver-2/public/index.html):
  - Added space normalization in `extractSku` to merge spaces between numeric model prefixes and trailing letter suffixes safely (e.g. `CZ 52 IH` -> `CZ 52IH`).
  - Updated `getPackSignature` to detect additional Vietnamese and English gift/bundle keywords (`tặng`, `tang`, `quà`, `qua`, `gift`, `kèm`, `kem`, `+`) to correctly separate bundled combos from bare items.
  - Added robust string normalization (removing spaces, hyphens, and underscores) in `groupAndCompareProducts` when constructing `skuKey` comparison clusters.
  - Updated `groupAndCompareProducts` to parse domains from links, select only the cheapest product option per domain, and restrict comparisons exclusively to clusters that exist on at least 2 different websites.
  - Expanded `stripColors` to handle short abbreviations (e.g. `BK`, `WH`, `GR`) and single-letter color codes (e.g. `B`, `W`, `G`, `S`, `R`, `C`).
  - Added regex replacements inside `stripColors` to remove trailing color suffixes attached directly to digits (e.g. `K10540B`) or separated by a character (e.g. `K-10540-BK`, `K-10540/WHITE`).
  - Updated the Jaccard similarity token stopWords inside `getComparisonTokens` to ignore color abbreviations (e.g. `bk`, `wh`, `gr`, `ghi`), preventing color differences from penalizing title-only comparisons.
- [test-fetch.mjs](file:///d:/Work/cong-cu-cao-web-ver-2/test-fetch.mjs):
  - Synced standalone `extractSku` implementation with the latest frontend version.
- [netlify/functions/scrape.js](file:///d:/Work/cong-cu-cao-web-ver-2/netlify/functions/scrape.js):
  - Added generic promotional and section heading keywords (`khuyến mãi`, `ưu đãi`, `nhập mã`, `mã giảm giá`, `quà tặng`, `thông số`, `kỹ thuật`, `mô tả`, `chi tiết`, `đặc điểm` and their unaccented equivalents) to `tuKhoaRac` arrays in both Cheerio and Puppeteer selectors.

## Deleted Files
- None.

## Commands Executed
- `node test-fetch.mjs`: Verified SKU/Series extraction results on standard and edge case kitchen appliance titles.
- `node -c netlify/functions/scrape.js`: Syntax checked the modified serverless scrape script.
- `node -e "..."`: Simulated cross-site domain grouping and price de-duplication logic.
- `node test-colors.mjs`: Ran local tests for RegExp-based trailing color suffix removal.
- `Remove-Item test-colors.mjs`: Deleted temporary test script.

## Bugs Found
1. **Model Number Space Inconsistencies**: Spacing variations like `CZ 52 IH` vs `CZ 52IH` or `CZ 52 I` vs `CZ 52I` prevented SKU comparison matches due to exact string key comparison.
2. **Missing Gift/Bundle Detection**: Titles featuring gifts/bundles (`tặng nồi`, `kèm quà`, `+`) were incorrectly matched as single items because combo detection was restricted only to `combo`, `set`, and `bộ quà tặng`.
3. **Unicode Word Boundary Interruptions**: Suffixes starting with uppercase letters followed by Unicode characters (e.g., `16 Món`) were sometimes incorrectly matched due to JavaScript's ASCII-only `\b` boundaries matching before Unicode characters (e.g. `M` in `Món`).
4. **Promotional Block Proximity Hijacking**: Elements containing generic promotion titles (like `KHUYẾN MÃI - ƯU ĐÃI`) located inside product info sections were closer to the main price element in the DOM tree than the main title, causing them to be extracted as product names on detail pages.
5. **Intra-Site Comparisons**: The Comparison View grouped and compared different listings or price variants from the exact same website against each other, instead of strictly comparing different websites.
6. **Color Variant Key Mismatches**: Single-letter color suffixes (like `B`, `W`, `G`, `S`, `R`, `C`) or short abbreviations (like `BK`, `WH`, `GR`, `GY`, `GD`, `SS`, `CH`, `CR`) attached directly to digits (e.g. `K10540B`) or separated by standard characters (e.g. `K-10540-BK`, `K-10540/WHITE`) were not identified or stripped by `stripColors`, causing same-model listings in different colors to form separate, disconnected comparison groups.
7. **Fuzzy Color Token Penalties**: The fuzzy title Jaccard similarity matcher penalized matches if color keywords (like `bk`, `wh`, `gr`, `ghi`) were not in stopWords, preventing successful grouping of title-only comparison pairs.

## Fixes Applied
1. **Space Normalization in SKU Matching**: Added a safe replacement regex in `extractSku` to join alphanumeric gaps (e.g. `52 IH` -> `52IH`), bypassing Vietnamese words using trailing letter checks.
2. **Enriched Combo Signature Detection**: Expanded `getPackSignature` to identify gift/addon signatures, ensuring that bundles are grouped under distinct keys and compared separately from the base product.
3. **Robust Comparison Group Keys**: Normalized comparison SKU and Series keys in `groupAndCompareProducts` by stripping all spaces, hyphens, and underscores before grouping.
4. **Garbage Keyword Filtering for Section Headers**: Added promotional keywords (e.g. `khuyến mãi`, `ưu đãi`) to `tuKhoaRac` lists to skip generic block titles.
5. **Cross-Site Comparison Limit & De-duplication**: Updated `groupAndCompareProducts` to keep only the cheapest option per website domain and limit comparisons to groups present on 2 or more different websites.
6. **Enhanced Color-Stripping RegExps**: Expanded the color keywords list to cover short forms and single-letter codes. Added dual regex replacements in `stripColors` to strip trailing color suffixes when separated by `[-_\\/ ]` or when attached directly to a digit, allowing robust clustering under the base SKU.
7. **Expanded StopWords in Fuzzy Matching**: Integrated the short/single-letter color codes into the Jaccard similarity stopWords array within `getComparisonTokens`.

## Remaining Issues
- None.


