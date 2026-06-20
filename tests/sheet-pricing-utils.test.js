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
    assert.equal(result.gapValue, 11040000 - 9000000); // sale - cost
    assert.equal(result.gapPercent, (11040000 - 9000000) / 11040000); // profit / sale
    assert.equal(result.suggestedPrice, 9000000); // Suggested Price is Min
});

test('computeSuggestedPricing falls back to listPrice when currentSalePrice is empty', () => {
    const result = computeSuggestedPricing({
        listPrice: 12000000,
        costPrice: 9000000,
        currentSalePrice: '',
        prices: [9000000, 9200000],
    });

    assert.equal(result.minPrice, 9000000);
    assert.equal(result.gapValue, 12000000 - 9000000); // listPrice - costPrice
    assert.equal(result.gapPercent, (12000000 - 9000000) / 12000000); // profit / listPrice
    assert.equal(result.suggestedPrice, 9000000);
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
