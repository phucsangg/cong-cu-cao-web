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
});

test('normalizeModelText removes separators and uppercases for matching', () => {
    assert.equal(normalizeModelText('DI-333 Pro'), 'DI333PRO');
    assert.equal(normalizeModelText(' x-nano 6 plus '), 'XNANO6PLUS');
});

test('computeSuggestedPricing keeps top 10, removes low outlier, and calculates summary fields', () => {
    const result = computeSuggestedPricing({
        currentSalePrice: 11040000,
        prices: [
            8000000,
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
        8000000,
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
    assert.equal(result.outlierRemoved, 8000000);
    assert.equal(result.minPrice, 9200000);
    assert.equal(result.gapValue, 1840000);
    assert.equal(result.gapPercent, 0.2);
    assert.equal(result.suggestedPrice, 9253500);
});

test('computeSuggestedPricing returns blank suggestion when fewer than 3 valid prices remain', () => {
    const result = computeSuggestedPricing({
        currentSalePrice: 5000000,
        prices: [5100000, 5200000],
    });

    assert.equal(result.minPrice, 5100000);
    assert.equal(result.suggestedPrice, null);
    assert.equal(result.gapValue, -100000);
    assert.equal(result.gapPercent, -100000 / 5100000);
});

test('mapSheetHeaders resolves required output columns by header name', () => {
    const headers = [
        'Mã SP',
        'Thương hiệu',
        'Model',
        'Giá vốn',
        'Giá bán',
        'Thị trường 1',
        'Thị trường 2',
        'Min',
        'GAP',
        '%GAP',
        'Giá đề xuất',
    ];

    const mapping = mapSheetHeaders(headers);

    assert.equal(mapping.brand, 1);
    assert.equal(mapping.model, 2);
    assert.equal(mapping.salePrice, 4);
    assert.deepEqual(mapping.marketColumns, [5, 6]);
    assert.equal(mapping.minPrice, 7);
    assert.equal(mapping.gapValue, 8);
    assert.equal(mapping.gapPercent, 9);
    assert.equal(mapping.suggestedPrice, 10);
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
        'GAP',
        '%GAP',
        'Giá đề xuất',
    ];

    const mapping = mapSheetHeaders(headers);

    assert.equal(mapping.brand, 1);
    assert.equal(mapping.model, 2);
    // Maps to 'Giá bán (₫)' at index 6
    assert.equal(mapping.salePrice, 6);
    assert.deepEqual(mapping.marketColumns, [8, 9]);
    assert.equal(mapping.minPrice, 10);
    assert.equal(mapping.gapValue, 11);
    assert.equal(mapping.gapPercent, 12);
    assert.equal(mapping.suggestedPrice, 13);
});

