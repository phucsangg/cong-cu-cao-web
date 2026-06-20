const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseVietnamesePrice,
    normalizeModelText,
    computeSuggestedPricing,
    mapSheetHeaders,
    buildSheetUpdateRow,
} = require('../lib/sheet-pricing-utils.js');

test('parseVietnamesePrice converts formatted VND text to integer', () => {
    assert.equal(parseVietnamesePrice('9,120,000₫'), 9120000);
    assert.equal(parseVietnamesePrice(' 11.340.000 đ '), 11340000);
    assert.equal(parseVietnamesePrice('Liên hệ'), null);
    assert.equal(parseVietnamesePrice('850'), 850000);
    assert.equal(parseVietnamesePrice(850), 850000);
    assert.equal(parseVietnamesePrice('689'), 689000);
    assert.equal(parseVietnamesePrice('1.458.000'), 1458000);
    assert.equal(parseVietnamesePrice('14.74 triệu'), 14740000);
    assert.equal(parseVietnamesePrice('14,74 tr'), 14740000);
    assert.equal(parseVietnamesePrice('14740k'), 14740000);
    assert.equal(parseVietnamesePrice('14.7k'), 14700000);
    assert.equal(parseVietnamesePrice('11800000.00'), 11800000);
    assert.equal(parseVietnamesePrice('11.800.000,00 VNĐ'), 11800000);
    assert.equal(parseVietnamesePrice('11800000.00đ'), 11800000);
    assert.equal(parseVietnamesePrice('11800000.5'), 11800000);
});

test('normalizeModelText removes separators and uppercases for matching', () => {
    assert.equal(normalizeModelText('DI-333 Pro'), 'DI333PRO');
    assert.equal(normalizeModelText(' x-nano 6 plus '), 'XNANO6PLUS');
});

test('computeSuggestedPricing keeps top 10, sets suggestedPrice to Min, and calculates summary fields', () => {
    const result = computeSuggestedPricing({
        listPrice: 12000000,
        costPrice: 9000000,
        currentSalePrice: 11040000,
        prices: [
            9000000,
            9200000,
            9300000,
            9400000,
            9500000,
            9600000,
            9700000,
            9800000,
            9900000,
            10000000,
            12000000,
        ],
    });

    assert.deepEqual(result.marketPrices, [
        9000000,
        9200000,
        9300000,
        9400000,
        9500000,
        9600000,
        9700000,
        9800000,
        9900000,
        10000000,
    ]);
    assert.equal(result.minPrice, 9000000);
    assert.equal(result.gapValue, 9000000 - 9000000); // minPrice - cost
    assert.equal(result.gapPercent, 0); // profit / minPrice
    assert.equal(result.suggestedPrice, 9000000); // Suggested Price is exactly Min
});

test('computeSuggestedPricing falls back to listPrice when currentSalePrice and suggestedPrice are empty', () => {
    const result = computeSuggestedPricing({
        listPrice: 12000000,
        costPrice: 9000000,
        currentSalePrice: '',
        prices: [], // empty prices means suggestedPrice is null
    });

    assert.equal(result.minPrice, null);
    assert.equal(result.gapValue, 12000000 - 9000000); // listPrice - costPrice
    assert.equal(result.gapPercent, (12000000 - 9000000) / 12000000); // profit / listPrice
    assert.equal(result.suggestedPrice, null);
});

test('mapSheetHeaders resolves required output columns by header name', () => {
    const headers = [
        'Mã SP',
        'Thương hiệu',
        'Model',
        'Giá niêm yết',
        'Giá vốn',
        'Giá bán',
        'Thị trường 1',
        'Thị trường 2',
        'Min',
        'Lợi nhuận',
        '% Lợi nhuận',
        'Giá đề xuất',
    ];

    const mapping = mapSheetHeaders(headers);

    assert.equal(mapping.brand, 1);
    assert.equal(mapping.model, 2);
    assert.equal(mapping.listPrice, 3);
    assert.equal(mapping.costPrice, 4);
    assert.equal(mapping.salePrice, 5);
    assert.deepEqual(mapping.marketColumns, [6, 7]);
    assert.equal(mapping.minPrice, 8);
    assert.equal(mapping.gapValue, 9);
    assert.equal(mapping.gapPercent, 10);
    assert.equal(mapping.suggestedPrice, 11);
});

test('buildSheetUpdateRow pads market columns and keeps blanks for missing values', () => {
    const row = buildSheetUpdateRow({
        marketPrices: [9120000, 9340000],
        minPrice: 9120000,
        gapValue: 500000,
        gapPercent: 0.0548245614,
        suggestedPrice: null,
    });

    assert.equal(row.length, 14);
    assert.deepEqual(row.slice(0, 4), [9120000, 9340000, '', '']);
    assert.equal(row[10], 9120000);
    assert.equal(row[11], 500000);
    assert.equal(row[12], 0.0548245614);
    assert.equal(row[13], '');
});

test('mapSheetHeaders handles parentheses and maps salePrice to Giá bán', () => {
    const headers = [
        'Mã SP',
        'Thương hiệu',
        'Model',
        'Ngành hàng',
        'Giá niêm yết (₫)',
        'Giá vốn (₫)',
        'Giá bán (₫)',
        'Giá khuyến mãi (₫)',
        'Thị trường 1',
        'Thị trường 2',
        'Min',
        'Lợi nhuận',
        '% Lợi nhuận',
        'Giá đề xuất',
    ];

    const mapping = mapSheetHeaders(headers);

    assert.equal(mapping.brand, 1);
    assert.equal(mapping.model, 2);
    assert.equal(mapping.listPrice, 4);
    assert.equal(mapping.costPrice, 5);
    assert.equal(mapping.salePrice, 6);
    assert.deepEqual(mapping.marketColumns, [8, 9]);
    assert.equal(mapping.minPrice, 10);
    assert.equal(mapping.gapValue, 11);
    assert.equal(mapping.gapPercent, 12);
    assert.equal(mapping.suggestedPrice, 13);
});

test('computeSuggestedPricing filters out low price outliers correctly', () => {
    const result = computeSuggestedPricing({
        listPrice: 12000000,
        costPrice: 9000000,
        currentSalePrice: 11040000,
        prices: [
            8000000, // Outlier (8,000,000 < 9,200,000 * 0.9)
            9200000,
            9300000,
            9400000,
        ],
    });

    assert.equal(result.outlierRemoved, true);
    assert.equal(result.minPrice, 9200000);
    assert.equal(result.suggestedPrice, 9200000);
    assert.deepEqual(result.marketPrices, [8000000, 9200000, 9300000, 9400000]); // Raw market prices still recorded
});

test('normalizeModelText normalizes dimensions (m, cm, mm) and plus symbol correctly', () => {
    assert.equal(normalizeModelText('LUVIA350 BLACK (90 cm)'), 'LUVIA350BLACK90');
    assert.equal(normalizeModelText('LUVIA-350 BLACK 900mm'), 'LUVIA350BLACK90');
    assert.equal(normalizeModelText('LUVIA-350 BLACK 0.9m'), 'LUVIA350BLACK90');
    assert.equal(normalizeModelText('KF-IH870Z+'), 'KFIH870ZPLUS');
    assert.equal(normalizeModelText('KF-IH870Z Plus'), 'KFIH870ZPLUS');
});

test('generateKeywords produces smart variants including suffixes and normalized formats', () => {
    const { generateKeywords } = require('../lib/sheet-pricing-utils.js');
    const keywords = generateKeywords('Bosch', 'WQB245B40', '08.Giặt sấy');
    const kwSet = new Set(keywords);

    assert.ok(kwSet.has('Bosch WQB245B40'));
    assert.ok(kwSet.has('WQB245B40'));
    assert.ok(kwSet.has('"WQB245B40"'));
    assert.ok(kwSet.has('Bosch WQB245B40 giá'));
    assert.ok(kwSet.has('Bosch WQB245B40 site:.vn'));
    assert.ok(kwSet.has('Máy sấy Bosch WQB245B40'));
    assert.ok(kwSet.has('Bosch Series 8 WQB245B40'));

    // Suffix variant checks: QA65QN90A -> QA65QN90
    const suffixKeywords = generateKeywords('Samsung', 'QA65QN90A', 'Tivi');
    const suffixSet = new Set(suffixKeywords);
    assert.ok(suffixSet.has('Samsung QA65QN90'));
    assert.ok(suffixSet.has('QA65QN90'));
    assert.ok(suffixSet.has('"QA65QN90"'));
});

test('calculateRelevanceScore handles scoring criteria correctly', () => {
    const { calculateRelevanceScore } = require('../lib/sheet-pricing-utils.js');

    const score1 = calculateRelevanceScore('https://shop.vn/bep-tu-kocher-di-332pro.html', 'DI-332Pro', 'Kocher');
    // +150 (exact model match), +40 (exact model), +20 (brand), +10 (hyphen), +10 (html), +10 (commercial) = 240
    assert.equal(score1, 240);

    // Negative matches for search and collection pages
    const score2 = calculateRelevanceScore('https://shop.vn/collections/bep-tu?q=kocher', 'DI-332Pro', 'Kocher');
    // contains collection, category, search terms -> penalty -50
    assert.ok(score2 < 50);

    // Conflicting suffix -> penalty -100
    const score3 = calculateRelevanceScore('https://shop.vn/kocher-di-332pro-plus.html', 'DI-332Pro', 'Kocher');
    assert.equal(score3, 0);
});

test('cleanModelSpecs strips color names and dimensions from model names', () => {
    const { cleanModelSpecs } = require('../lib/sheet-pricing-utils.js');
    assert.equal(cleanModelSpecs('K-226I Bạc-70cm'), 'K-226I');
    assert.equal(cleanModelSpecs('K-226I Bạc-90cm'), 'K-226I');
    assert.equal(cleanModelSpecs('K-226V Đen-70cm'), 'K-226V');
    assert.equal(cleanModelSpecs('K-8070I bạc-70cm'), 'K-8070I');
    assert.equal(cleanModelSpecs('K-8872V đen-90cm'), 'K-8872V');
    assert.equal(cleanModelSpecs('K-225C Pro 70cm'), 'K-225C Pro');
    assert.equal(cleanModelSpecs('K-225C Pro'), 'K-225C Pro');
    assert.equal(cleanModelSpecs('KF-HID7348II'), 'KF-HID7348II');
});

test('parseSpecificRows correctly parses comma-separated lists and ranges', () => {
    const { parseSpecificRows } = require('../lib/sheet-pricing-utils.js');
    
    const set1 = parseSpecificRows('3, 5, 20-22');
    assert.ok(set1.has(3));
    assert.ok(set1.has(5));
    assert.ok(set1.has(20));
    assert.ok(set1.has(21));
    assert.ok(set1.has(22));
    assert.equal(set1.size, 5);

    const set2 = parseSpecificRows(' 10 ');
    assert.ok(set2.has(10));
    assert.equal(set2.size, 1);

    const set3 = parseSpecificRows('');
    assert.equal(set3, null);

    const set4 = parseSpecificRows('abc, xyz-123');
    assert.equal(set4, null);
});

