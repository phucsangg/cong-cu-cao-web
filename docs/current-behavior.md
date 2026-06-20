# Current Behavior Analysis - CrawlData (Node.js)

This document provides a detailed overview of the system architecture, file structure, processing pipelines, and matching logic of the existing Node.js-based application.

---

## 1. Project Overview

The project is an **Auto-Pricing and Scraping System** linked with **Google Sheets** (acting as database storage) and **Haravan** (acting as e-commerce storefront storage). 

Its main objectives are:
1. Fetch product items (consisting of brands and models) from Google Sheets via a Google Apps Script Web App wrapper.
2. Query search engines (Google, Bing, DuckDuckGo, Cốc Cốc) progressively to locate product detail pages on the web.
3. Parse and extract pricing from those product detail pages using layout heuristics (Cheerio fast path + Puppeteer fallback browser rendering).
4. Perform statistical pricing analysis (filtering outlier prices using Interquartile Range (IQR), calculating median/min, and suggesting target retail prices).
5. Update Google Sheets with market prices and suggestions.
6. Sync prices to Haravan storefront variant inventory and notify results via Telegram.

---

## 2. Directory Structure

```text
├── docs/
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-06-19-executive-dashboard-redesign.md
│       │   └── 2026-06-19-sheet-multiselect-search-fix.md
│       └── specs/
│           ├── 2026-06-18-google-sheet-pricing-design.md
│           └── 2026-06-19-executive-dashboard-redesign.md
├── lib/
│   ├── scraper-core.js            # Core web extraction library (Cheerio / Puppeteer)
│   ├── sheet-pricing-service.js   # Background worker, API router, Apps Script bridge logic
│   └── sheet-pricing-utils.js     # Text normalization, model matching heuristics, math logic
├── netlify/
│   └── functions/
│       └── sheet-pricing.js       # Netlify serverless routing endpoint
├── public/
│   ├── index.html                 # Executive Pricing Dashboard UI
│   └── sheet-pricing.js           # Client-side state manager and logger
├── scripts/
│   └── google-sheet-pricing-apps-script.gs  # Apps Script web endpoint code
├── tests/
│   ├── sheet-pricing-service.test.js  # Node native tests for background job routing
│   └── sheet-pricing-utils.test.js    # Node native tests for matching and calculations
├── package.json
├── package-lock.json
├── server.js                      # Express-alternative vanilla http router
├── netlify.toml                   # Netlify configuration
└── .env.example                   # Environment configuration variables template
```

---

## 3. Current Dependencies

* `@sparticuz/chromium`: Used for serverless Headless Chromium deployment.
* `cheerio`: Fast, lightweight parser simulating jQuery for direct static HTML traversal.
* `puppeteer-core`: Headless browser control library for executing JavaScript pages.
* `xlsx`: Local Excel parsing and output writer (remnant from older versions).

---

## 4. Main Process Flow & Core Pipelines

### A. Web Server Setup & Entrypoints
* Local Server (`server.js`): Uses the core Node.js `http` module to serve static files from `public/` and route API calls (`/api/sheet-pricing/...`).
* Netlify Function (`netlify/functions/sheet-pricing.js`): Matches the API routing for serverless deployments.

### B. Core REST APIs & Actions (`POST /api/sheet-pricing`)
The routing logic processes requests based on the `action` field:
* `fetch-mapping`: Downloads and parses `20. ID Haravan` sheet mapping.
* `list-sheets`: Discovers tab names in the workbook.
* `haravan-sync`: Pulls all variant IDs and specs from Haravan storefront, matches with Model, writes back to Sheet `20. ID Haravan`.
* `fetch-haravan-mapping`: Reads variants mapping from Sheet `20. ID Haravan`.
* `haravan-update-price`: Calls Haravan APIs to update variant price.
* `telegram-notify`: Dispatches alert notifications to a Telegram Channel.
* `haravan-log-update`: Records update audit logs in Sheet `19.Log`.
* `sheet-update-sale-price`: Directly updates single row price inside product sheets.
* `fetch-sheet`: Downloads rows range or selective list of row numbers.
* `process-row`: Entrypoint for single row crawl.
* `write-results`: Writes batch update cells back to sheet columns.

---

## 5. Job Pricing Flow & Parallelism

When a job starts:
1. `sheetName`, `startRow`, `endRow`, `rowsConcurrency`, `linksConcurrency` are defined.
2. The system triggers `startBackgroundPricingJob`.
3. Read headers and identify column offsets (`mapSheetHeaders`).
4. Read rows. Each row is processed under `rowsConcurrency` limits.
5. For each row:
   * Generate query search terms using `generateKeywords`.
   * Search progressively using **Google**, **Bing**, **DuckDuckGo**, or **Cốc Cốc** via `searchProductLinks` to get up to 20 candidate URLs.
   * Filter and validate each URL to confirm it is a likely product detail page using `isLikelyProductDetailUrl` and model match validation `isModelMatch`.
   * For the top selected URLs, query detail page html (directly with Cheerio HTTP request first, or Puppeteer fallback if Cheerio returns insufficient products or fails).
   * Extract price text via `getPriceText`, parse to integer VND via `parseVietnamesePrice`.
   * Group all extracted prices, sort ascending, and take up to 10 lowest values.
   * Apply IQR outlier filtering via `computeSuggestedPricing`.
   * Calculate summary columns: `Min`, `GAP` (`Giá bán - Min`), `%GAP` (`GAP / Min`), and `Gia de xuat` (average of top 3 lowest prices * 0.995).
6. Write batch results to the Google Sheet using the Apps Script endpoint.

---

## 6. Heuristic Algorithms & Specifications

### A. Price Extraction (`parseVietnamesePrice`)
* Validates currency symbols (`₫`, `vnd`, `vnđ`, `đồng`).
* Interprets shortcut representations (e.g. `850` as `850,000`, `14.7 tr` as `14,700,000`, `14.7k` as `14,700,000`).
* Rejects elements that match spec criteria (units like `W`, `kW`, `cm`, `mm`, `Hz`, `dB`).
* Filters out telephone numbers.

### B. Text and Model Normalization (`normalizeModelText`)
* Normalizes accents, removes diacritics, and forces uppercase.
* Converts dimensions to centimeters (e.g., `900mm` -> `90cm` -> `90`).
* Replaces symbols like `+` to `PLUS`.

### C. Model Match Verification (`isModelMatch`)
* Employs suffix and prefix conflict rules (`hasConflictingModelPrefix` and `hasConflictingModelSuffix`).
* Checks boundaries of digits to avoid matching sub-parts (e.g., matching model `871` against `8713`).
* Suffix conflict set includes terms like `PRO`, `PLUS`, `S`, `T`, `MAX`, `LITE`, etc.

### D. IQR Outlier Filtering
* Evaluates price distribution.
* Removes items beyond `Q1 - 1.5 * IQR` and `Q3 + 1.5 * IQR`.

---

## 7. Environment Variables

* `APPS_SCRIPT_URL`: Google Apps Script endpoint URL.
* `SHEET_URL`: Targeted Google Spreadsheet URL.
* `SHEET_NAME`: Target sheet inside workbook.
* `TELEGRAM_BOT_TOKEN`: Token for dispatching telegram updates.
* `TELEGRAM_CHAT_ID`: Targeted Telegram chat/channel ID.
* `HARAVAN_SHOP_URL`: Targeted shop domain.
* `HARAVAN_ACCESS_TOKEN`: API Token credentials.

---

## 8. Rewrite Risks & Challenges

1. **Mojibake handling**: The Javascript code has encoding repair helper functions like `decodeMojibake` to treat Unicode anomalies. This must be ported carefully to Python.
2. **Puppeteer vs. Playwright parity**: Puppeteer uses request interceptors to block resources (images, fonts, stylesheets, trackers). We must configure Playwright interceptors similarly to maintain fast execution and low memory consumption.
3. **Regex differences**: Core matching logic relies on JavaScript regex behaviors (lookbehinds, lookaheads, word boundary specs). These need testing to verify they behave identically in Python.
