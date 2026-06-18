const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractSheetId,
    isLikelyProductDetailUrl,
    processPricingRow,
} = require('../lib/sheet-pricing-service.js');

test('extractSheetId pulls spreadsheet id from Google Sheets URL', () => {
    assert.equal(
        extractSheetId('https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit?gid=0#gid=0'),
        '1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo'
    );
});

test('isLikelyProductDetailUrl rejects category and search pages', () => {
    assert.equal(isLikelyProductDetailUrl('https://example.com/bep-tu/kocher-di-333-pro.html'), true);
    assert.equal(isLikelyProductDetailUrl('https://example.com/collections/bep-tu'), false);
    assert.equal(isLikelyProductDetailUrl('https://example.com/search?q=kocher+di333pro'), false);
});

test('processPricingRow filters links, keeps top 10 prices, and builds sheet update payload', async () => {
    const result = await processPricingRow({
        row: {
            rowNumber: 3,
            productId: 'BT-010',
            brand: 'Kocher',
            model: 'DI-355',
            salePrice: '11,040,000',
        },
        deps: {
            searchProductLinks: async () => ([
                'https://shop-a.vn/products/kocher-di-355.html',
                'https://shop-b.vn/search?q=kocher+di355',
                'https://shop-c.vn/products/kocher-di-355-pro',
                'https://shop-d.vn/collections/bep-tu',
            ]),
            extractProductPrice: async (url) => {
                const values = {
                    'https://shop-a.vn/products/kocher-di-355.html': 10100000,
                    'https://shop-c.vn/products/kocher-di-355-pro': 10200000,
                };
                return values[url] || null;
            },
        },
    });

    assert.equal(result.rowNumber, 3);
    assert.deepEqual(result.matchedUrls, [
        'https://shop-a.vn/products/kocher-di-355.html',
        'https://shop-c.vn/products/kocher-di-355-pro',
    ]);
    assert.deepEqual(result.marketPrices, [10100000, 10200000]);
    assert.equal(result.minPrice, 10100000);
    assert.equal(result.gapValue, 940000);
    assert.equal(result.suggestedPrice, null);
    assert.equal(result.status, 'insufficient_prices');
});

test('processPricingRow sets success status when enough prices are found', async () => {
    const priceMap = new Map([
        ['https://a.vn/p/kocher-di-333pro', 9000000],
        ['https://b.vn/p/kocher-di-333pro', 9100000],
        ['https://c.vn/p/kocher-di-333pro', 9200000],
        ['https://d.vn/p/kocher-di-333pro', 9300000],
    ]);

    const result = await processPricingRow({
        row: {
            rowNumber: 4,
            productId: 'BT-002',
            brand: 'Kocher',
            model: 'DI-3332Pro',
            salePrice: '9,120,000',
        },
        deps: {
            searchProductLinks: async () => [...priceMap.keys()],
            extractProductPrice: async (url) => priceMap.get(url) || null,
        },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.minPrice, 9000000);
    assert.equal(result.gapValue, 120000);
    assert.equal(result.suggestedPrice, 9054500);
});

test('isLikelyProductDetailUrl accepts standard Vietnamese slug URLs', () => {
    assert.equal(isLikelyProductDetailUrl('https://bepvuson.vn/bep-tu-kocher-di-333-pro'), true);
    assert.equal(isLikelyProductDetailUrl('https://bepnamduong.vn/bep-tu/kocher-di-333-pro'), true);
    assert.equal(isLikelyProductDetailUrl('https://example.com/bep-tu-kocher-di-333-pro?utm_source=fb'), true);
});

test('processPricingRow skips rows with purely numeric models', async () => {
    const result = await processPricingRow({
        row: {
            rowNumber: 5,
            productId: 'BT-005',
            brand: 'Kocher',
            model: '123', // Purely numeric model
            salePrice: '5,000,000',
        },
        deps: {
            searchProductLinks: async () => ['https://a.vn/p/kocher-123'],
            extractProductPrice: async () => 4500000,
        }
    });

    assert.equal(result.status, 'skipped');
    assert.deepEqual(result.marketPrices, []);
    assert.equal(result.minPrice, null);
});

test('processPricingRow skips rows with missing or whitespace-only brand or model', async () => {
    const resultNoBrand = await processPricingRow({
        row: {
            rowNumber: 6,
            brand: '   ',
            model: 'DI-3332Pro',
        }
    });
    assert.equal(resultNoBrand.status, 'skipped');

    const resultNoModel = await processPricingRow({
        row: {
            rowNumber: 7,
            brand: 'Kocher',
            model: '',
        }
    });
    assert.equal(resultNoModel.status, 'skipped');
});

test('processPricingRow falls back to row.marketPrices when crawler finds 0 prices', async () => {
    const result = await processPricingRow({
        row: {
            rowNumber: 8,
            productId: 'BT-008',
            brand: 'Kocher',
            model: 'DI-333Pro',
            salePrice: '9,500,000',
            marketPrices: [9000000, 9100000, 9200000],
        },
        deps: {
            searchProductLinks: async () => [], // Return 0 links
            extractProductPrice: async () => null,
        },
    });

    assert.equal(result.hasNewPrices, false);
    assert.deepEqual(result.marketPrices, [9000000, 9100000, 9200000]);
    assert.equal(result.minPrice, 9000000);
    assert.equal(result.gapValue, 500000);
    assert.equal(result.suggestedPrice, 9054500); // (9000000 + 9100000 + 9200000)/3 * 0.995 = 9054500
    assert.equal(result.status, 'success');
});

test('processPricingRow filters out invalid prices outside range [1,000,000 - 200,000,000]', async () => {
    const priceMap = new Map([
        ['https://a.vn/p/kocher-di-333pro', 999999], // Too low, should be ignored
        ['https://b.vn/p/kocher-di-333pro', 9000000], // Valid
        ['https://c.vn/p/kocher-di-333pro', 9100000], // Valid
        ['https://d.vn/p/kocher-di-333pro', 9200000], // Valid
        ['https://e.vn/p/kocher-di-333pro', 200000001], // Too high, should be ignored
    ]);

    const result = await processPricingRow({
        row: {
            rowNumber: 9,
            productId: 'BT-009',
            brand: 'Kocher',
            model: 'DI-333Pro',
            salePrice: '9,500,000',
        },
        deps: {
            searchProductLinks: async () => [...priceMap.keys()],
            extractProductPrice: async (url) => priceMap.get(url) || null,
        },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(result.marketPrices, [9000000, 9100000, 9200000]); // Low and high prices are excluded
    assert.equal(result.minPrice, 9000000);
    assert.equal(result.suggestedPrice, 9054500);
});





