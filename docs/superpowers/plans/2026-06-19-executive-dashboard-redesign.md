# Executive Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the pricing dashboard into a modern, easier-to-use executive-style interface without breaking the existing Google Sheet pricing workflow.

**Architecture:** Keep the current backend and browser-side pricing flow intact, but rebuild the HTML structure around the existing DOM hooks and clean up the UI text/state handling in the browser script. Use a lighter visual system with clearer hierarchy so setup, monitoring, and results are easier to scan.

**Tech Stack:** Static HTML, Bootstrap 5, custom CSS, vanilla browser JavaScript, Node test runner

---

### Task 1: Redesign the shell layout

**Files:**
- Modify: `D:\Work\crawldata\public\index.html`

- [ ] **Step 1: Replace the old dark glass layout with a lighter dashboard structure**

Create a new page shell that keeps the existing functional IDs while reorganizing the page into:

```html
<header>hero + status + quick actions</header>
<section>kpi strip</section>
<main>monitor column + setup column</main>
<section>results table</section>
<div id="productDetailModal"></div>
```

- [ ] **Step 2: Preserve the required DOM hooks**

Ensure these IDs still exist in the final markup:

```text
pricingStatusBadge
pricingSheetList
btnReloadSheetNames
pricingSheetName
pricingSheetSelectionSummary
btnPricingStart
btnPricingStop
progressText
pricingProgressBar
pricingStartRow
pricingEndRow
pricingAppsScriptUrl
pricingSheetUrl
pricingBatchSize
pricingRowsConcurrency
pricingLinksConcurrency
pricingTotalRows
pricingProcessedCount
pricingSuccessCount
pricingErrorCount
pricingWriteCount
terminalBody
sheetPricingBody
productDetailModal
modalProductTitle
modalProductCode
modalUrlsTableBody
collapseConfig
```

- [ ] **Step 3: Keep the advanced config section compatible with the current script**

Retain a container with:

```html
<div id="collapseConfig" class="collapse show">...</div>
```

or equivalent markup that still supports the script logic which expands the config block when validation fails.

### Task 2: Clean the browser-side UX copy and interactions

**Files:**
- Modify: `D:\Work\crawldata\public\sheet-pricing.js`

- [ ] **Step 1: Add a safe text-normalization helper**

Implement a helper that repairs common mojibake before rendering UI text:

```js
function decodeMojibake(value) {
    const text = String(value ?? '');
    if (!/[ÃÂÄÆá»áºâ]/.test(text)) return text;
    try {
        return decodeURIComponent(escape(text));
    } catch {
        return text;
    }
}
```

- [ ] **Step 2: Route rendered strings through normalized output**

Update HTML/text rendering helpers so log lines, modal content, summaries, and badges display clean Vietnamese copy:

```js
function escapeHtml(value) {
    return decodeMojibake(String(value ?? ''))
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
```

- [ ] **Step 3: Rewrite visible UI labels with clean strings**

Fix strings for:

```text
sheet selection summary
empty states
button labels
status labels
load sheet messages
terminal startup message
modal empty state
money suffix "đ"
```

### Task 3: Verify the redesign does not break pricing flows

**Files:**
- Modify: `D:\Work\crawldata\public\index.html`
- Modify: `D:\Work\crawldata\public\sheet-pricing.js`
- Verify: `D:\Work\crawldata\lib\sheet-pricing-service.js`
- Test: `D:\Work\crawldata\tests\sheet-pricing-service.test.js`

- [ ] **Step 1: Check browser script syntax**

Run:

```powershell
node --check public\sheet-pricing.js
```

Expected: command exits successfully with no syntax errors.

- [ ] **Step 2: Re-check service syntax**

Run:

```powershell
node --check lib\sheet-pricing-service.js
```

Expected: command exits successfully with no syntax errors.

- [ ] **Step 3: Run the service tests**

Run:

```powershell
node --test tests\sheet-pricing-service.test.js
```

Expected: all tests pass, including the added list-sheet fallback and model matching coverage.

- [ ] **Step 4: Manual UI smoke checklist**

Verify these browser flows manually:

```text
load config
reload sheet list
multi-select sheets
start scan
stop scan
watch live logs
open row detail modal
scan the results table
```
