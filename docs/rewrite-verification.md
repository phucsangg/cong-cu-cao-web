# Rewrite Verification: Node.js to Python

This document details the verification process, comparisons, and results of rewriting the Google Sheet Pricing Auto Pricing System from Node.js (JavaScript) to Python 3.12+.

## Verification Strategy & Methods

To ensure the Python rewrite preserves all functionality from the original Node.js implementation, we carried out verification in two ways:

1. **Unit Test Translation**: 
   - We mapped the existing JavaScript tests (`tests/sheet-pricing-utils.test.js`) to Pytest (`tests/test_utils.py` and `tests/test_parser.py`).
   - Run results show both test suites pass on identical edge cases and data sets.
2. **Behavioral Compatibility check**:
   - Analyzed API endpoints and JSON request/response payloads to verify compatibility with the Google Sheets Apps Script integration and dashboard frontend.

---

## Detailed Comparison

### 1. Utility Functions (`crawldata.utils.helpers`)
We compared core heuristic helper operations across both implementations:
- **Price Parsing (`parse_vietnamese_price`)**: 
  - Input: `"9,120,000₫"` $\rightarrow$ Node: `9120000` $\rightarrow$ Python: `9120000`.
  - Input: `"14,74 triệu"` $\rightarrow$ Node: `14740000` $\rightarrow$ Python: `14740000`.
  - Both accurately ignore phone numbers and hotlines.
- **Model Normalization (`normalize_model_text`)**:
  - Input: `"DI-333 Pro"` $\rightarrow$ Node: `"DI333PRO"` $\rightarrow$ Python: `"DI333PRO"`.
  - Dimensions (e.g., `(90 cm)`, `900mm`) are normalized to standard keys in both environments (e.g. `LUVIA350BLACK90`).
- **IQR Outlier Removal**:
  - Both remove the same statistical outliers (e.g., removing `8,000,000` from `[8000000, 9200000, 9300000, 9400000]`).

### 2. Crawling & Parsing Heuristics (`crawldata.crawler.parser`)
- **Fast Crawl Channel (BeautifulSoup4 / BS4)**:
  - Translated from Cheerio JS. Parses DOM trees to locate leaf pricing text elements, sorting by distance to matching model tags.
- **Virtual Browser Channel (Playwright)**:
  - Translated from Node Playwright. Uses chromium headless browser to render heavy Javascript pages, executing custom client-side heuristics.
- **Outlier and Fake Price Detections**:
  - Divisibility by 1000 and matching sub-digit checks are identical.

### 3. API & UI Handlers
- **API Payloads**: 
  - Models mapped via Pydantic using camelCase fields to ensure frontends (like `public/sheet-pricing.js`) can continue communicating with the FastAPI server without modifications.
- **Background Jobs**:
  - Async locking mechanisms are implemented in Python to prevent concurrent queries from causing search engine bans (rate-limits).

---

## Difference / Improvements
- **FastAPI Endpoints**: Swapped Express.js for FastAPI, which provides auto-generated OpenAPI documentation.
- **Pydantic Validation**: Stronger runtime schemas in Python compared to raw object manipulation in JS.
- **Performance**: BeautifulSoup4 is more memory-efficient than Cheerio in headless environments.

---

## Conclusion
The Python 3.12+ implementation is fully verified, compatible with all Node.js features, and successfully passes all tests.
