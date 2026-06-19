# Sheet Multiselect And Search Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a checkbox-based multi-sheet picker and reduce false-positive product matches in pricing search.

**Architecture:** Keep the existing pricing flow intact, but replace the single-value sheet selector with a checkbox list that serializes selected sheet names into the existing form payload. In the service layer, centralize sheet-name normalization and tighten model/url matching so same-digit but wrong-suffix products are rejected.

**Tech Stack:** Vanilla browser JavaScript, Node.js, `node:test`, existing sheet pricing service.

---

### Task 1: Lock Current Regressions With Tests

**Files:**
- Modify: `tests/sheet-pricing-service.test.js`
- Test: `tests/sheet-pricing-service.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('normalizeSelectedSheetNames handles arrays, csv strings, and duplicates', () => {
  assert.deepEqual(normalizeSelectedSheetNames(['08.Giat say', '12.Xay sinh to', '08.Giat say']), [
    '08.Giat say',
    '12.Xay sinh to',
  ]);
  assert.deepEqual(normalizeSelectedSheetNames('08.Giat say, 12.Xay sinh to ,08.Giat say'), [
    '08.Giat say',
    '12.Xay sinh to',
  ]);
});

test('isModelMatch rejects same digits with conflicting suffix letters', () => {
  assert.equal(isModelMatch('Bosch WQG24570GB', 'WQG24570SG', 'Bosch'), false);
});

test('isLikelyProductDetailUrl rejects conflicting same-digit product slugs', () => {
  assert.equal(
    isLikelyProductDetailUrl('https://shop.vn/p/bosch-wqg24570gb', 'WQG24570SG', 'Bosch'),
    false
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheet-pricing-service.test.js`
Expected: FAIL because `normalizeSelectedSheetNames` is not exported yet and the conflicting-suffix match still returns `true`.

- [ ] **Step 3: Write minimal implementation**

```js
function normalizeSelectedSheetNames(sheetName) {
  const items = Array.isArray(sheetName) ? sheetName : String(sheetName || '').split(',');
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheet-pricing-service.test.js`
Expected: PASS for the new regression cases.

### Task 2: Implement Checkbox Sheet Picker

**Files:**
- Modify: `public/index.html`
- Modify: `public/sheet-pricing.js`

- [ ] **Step 1: Replace the single select with a checkbox list container**

```html
<div id="pricingSheetList" class="sheet-picker-list"></div>
<input type="hidden" id="pricingSheetName">
```

- [ ] **Step 2: Render “select all” plus per-sheet checkboxes**

```js
function renderSheetOptions(sheetNames) {
  // create a "select all" checkbox and one checkbox per sheet
}
```

- [ ] **Step 3: Serialize checked values back into the hidden `pricingSheetName` field**

```js
function syncSelectedSheetNames() {
  hiddenInput.value = selectedNames.join(',');
}
```

- [ ] **Step 4: Verify browser script syntax**

Run: `npm run check`
Expected: PASS

### Task 3: Tighten Matching Logic

**Files:**
- Modify: `lib/sheet-pricing-service.js`
- Test: `tests/sheet-pricing-service.test.js`

- [ ] **Step 1: Restrict digit-only fallback when trailing alpha tokens conflict**

```js
function hasConflictingModelSuffix(text, model) {
  // reject same-digit matches when the text contains a different trailing alphabetic suffix
}
```

- [ ] **Step 2: Use the conflict check in both `isModelMatch` and `isLikelyProductDetailUrl`**

```js
if (hasConflictingModelSuffix(titleOrUrl, model)) {
  return false;
}
```

- [ ] **Step 3: Re-run targeted tests**

Run: `node --test tests/sheet-pricing-service.test.js`
Expected: PASS

### Task 4: Final Verification

**Files:**
- Modify: `public/index.html`
- Modify: `public/sheet-pricing.js`
- Modify: `lib/sheet-pricing-service.js`
- Modify: `tests/sheet-pricing-service.test.js`

- [ ] **Step 1: Run syntax and test verification**

Run: `npm run check && npm test`
Expected: PASS

- [ ] **Step 2: Review diff for scope**

Run: `git diff -- public/index.html public/sheet-pricing.js lib/sheet-pricing-service.js tests/sheet-pricing-service.test.js`
Expected: Only the sheet picker, normalization, and stricter matching changes appear.
