const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractSheetId,
    isLikelyProductDetailUrl,
    processPricingRow,
    loadModelMapping,
    normalizeSelectedSheetNames,
    isModelMatch,
    extractSheetNamesFromSpreadsheetHtml,
    startBackgroundPricingJob,
    getBackgroundPricingJobStatus,
    stopBackgroundPricingJob,
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
    assert.equal(isLikelyProductDetailUrl('https://bepngocbao.vn/products/may-xay-sinh-to-tefal-perfectmix-bl871d31'), false);
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

test('processPricingRow filters out invalid prices outside range [100,000 - 200,000,000]', async () => {
    const priceMap = new Map([
        ['https://a.vn/p/kocher-di-333pro', 99999], // Too low, should be ignored
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

test('processPricingRow supports products and prices under 1,000,000 VND', async () => {
    const priceMap = new Map([
        ['https://a.vn/p/tefal-bl1c0230', 550000],  // Valid
        ['https://b.vn/p/tefal-bl1c0230', 580000],  // Valid
        ['https://c.vn/p/tefal-bl1c0230', 600000],  // Valid
        ['https://d.vn/p/tefal-bl1c0230', 99000],   // Too low (< 100k)
    ]);

    const result = await processPricingRow({
        row: {
            rowNumber: 5,
            productId: 'XS-003',
            brand: 'Tefal',
            model: 'BL1C0230',
            salePrice: '689,000',
        },
        deps: {
            searchProductLinks: async () => [...priceMap.keys()],
            extractProductPrice: async (url) => priceMap.get(url) || null,
        },
    });

    assert.equal(result.status, 'success');
    assert.deepEqual(result.marketPrices, [550000, 580000, 600000]); // 99k is excluded as it is < 100k
    assert.equal(result.minPrice, 550000);
    assert.equal(result.suggestedPrice, 573783); // (550k + 580k + 600k)/3 * 0.995 = 573783.333 -> round is 573783
});

test('loadModelMapping loads mapping rows and parses columns correctly', async () => {
    const mockFetch = async () => {
        return {
            ok: true,
            json: async () => ({
                headers: ['Thương hiệu', 'Mã sản phẩm', 'Model'],
                rows: [
                    { rowNumber: 2, values: ['Tefal', '2100112290', 'G2550402'] },
                    { rowNumber: 8, values: ['Tefal', '8010001304', 'BL100230'] }
                ]
            })
        };
    };

    const mapping = await loadModelMapping({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        fetchImpl: mockFetch,
    });

    assert.deepEqual(mapping, {
        '2100112290': 'G2550402',
        '8010001304': 'BL100230',
    });
});

test('loadModelMapping requests the real 18.Mã sản phẩm sheet name', async () => {
    let requestedUrl = '';
    const mockFetch = async (url) => {
        requestedUrl = String(url);
        return {
            ok: true,
            json: async () => ({
                headers: ['Thương hiệu', 'Mã sản phẩm', 'Model'],
                rows: [],
            })
        };
    };

    await loadModelMapping({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        fetchImpl: mockFetch,
    });

    const parsed = new URL(requestedUrl);
    assert.equal(parsed.searchParams.get('sheetName'), '18.Mã sản phẩm');
});

test('normalizeSelectedSheetNames handles arrays, csv strings, and duplicates', () => {
    assert.deepEqual(
        normalizeSelectedSheetNames(['08.Giặt sấy', '12.Xay sinh tố', '08.Giặt sấy']),
        ['08.Giặt sấy', '12.Xay sinh tố']
    );
    assert.deepEqual(
        normalizeSelectedSheetNames('08.Giặt sấy, 12.Xay sinh tố ,08.Giặt sấy'),
        ['08.Giặt sấy', '12.Xay sinh tố']
    );
    assert.deepEqual(normalizeSelectedSheetNames(''), []);
});

test('extractSheetNamesFromSpreadsheetHtml parses visible sheet tab captions', () => {
    const html = `
        <div class="docs-sheet-tab-caption">08.Giặt sấy</div>
        <div class="docs-sheet-tab-caption">12.Xay sinh tố</div>
        <div class="docs-sheet-tab-caption">18.Mã sản phẩm</div>
    `;

    assert.deepEqual(extractSheetNamesFromSpreadsheetHtml(html), [
        '08.Giặt sấy',
        '12.Xay sinh tố',
        '18.Mã sản phẩm',
    ]);
});

test('isLikelyProductDetailUrl with model and expanded keywords', () => {
    // Model in URL check should bypass standard checks and return true
    assert.equal(isLikelyProductDetailUrl('https://example.com/p/bl1c0230', 'BL1C0230'), true);
    // Custom keywords checks
    assert.equal(isLikelyProductDetailUrl('https://example.com/sp/may-xay', ''), true);
    assert.equal(isLikelyProductDetailUrl('https://example.com/ct/san-pham-hot', ''), true);
});

test('processPricingRow checks cleaned numeric codes (float string like 123.0)', async () => {
    const result = await processPricingRow({
        row: {
            rowNumber: 10,
            productId: 'BT-010',
            brand: 'Kocher',
            model: '123.0',
            salePrice: '9,000,000',
        },
        deps: {
            searchProductLinks: async () => [],
            extractProductPrice: async () => null,
        }
    });
    // It should be skipped because '123' is purely numeric and has no mapping,
    // so isValidModel evaluates cleanNumericCode('123.0') -> '123' -> purely numeric -> skipped.
    assert.equal(result.status, 'skipped');
});

test('brand-aware prefix model matching matches short model names under the same brand', () => {
    // Import isModelMatch from sheet-pricing-service
    const { isModelMatch } = require('../lib/sheet-pricing-service.js');
    
    // Exact brand match + prefix digit sequence match
    assert.equal(isModelMatch('Máy xay sinh tố Tefal BL871D', 'BL871D31', 'Tefal'), true);
    assert.equal(isModelMatch('Tefal BL871', 'BL871D31', 'Tefal'), true);
    
    // Different brand shouldn't match if it doesn't match standard inclusion/digit rules
    assert.equal(isModelMatch('Panasonic BL871D', 'BL871D31', 'Tefal'), false);
    
    // Different model series in same brand shouldn't match (DT8105 vs DT8100)
    assert.equal(isModelMatch('Bàn ủi hơi nước Tefal DT8105', 'DT8100', 'Tefal'), false);
});

test('model matching rejects same digits with conflicting suffix letters', () => {
    assert.equal(isModelMatch('Bosch WQG24570GB', 'WQG24570SG', 'Bosch'), false);
    assert.equal(
        isLikelyProductDetailUrl('https://shop.vn/p/bosch-wqg24570gb', 'WQG24570SG', 'Bosch'),
        false
    );
});

test('isFakePrice correctly identifies prices derived from model digits', () => {
    const { isFakePrice } = require('../lib/sheet-pricing-service.js');
    
    // Fake price 871,316 contains BL871D31 digits (87131)
    assert.equal(isFakePrice(871316, 'BL871D31'), true);
    
    // Fake price 102,303 contains BL1C0230 digits (10230)
    assert.equal(isFakePrice(102303, 'BL1C0230'), true);
    
    // Real price is fine
    assert.equal(isFakePrice(1890000, 'BL871D31'), false);
    assert.equal(isFakePrice(689000, 'BL1C0230'), false);
});

test('startBackgroundPricingJob stops before starting the next row after stop is requested', async () => {
    let releaseFirstRow;
    let firstRowStarted = false;
    let secondRowStarted = false;

    const firstRowDone = new Promise((resolve) => {
        releaseFirstRow = resolve;
    });

    const jobId = startBackgroundPricingJob({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        sheetName: '08.Giặt sấy',
        rowsConcurrency: 1,
        linksConcurrency: 1,
        batchSize: 10,
        deps: {
            loadModelMapping: async () => ({}),
            readSheetRows: async () => ({
                rows: [
                    { rowNumber: 3, productId: 'A', brand: 'Bosch', model: 'WQB245B40', salePrice: '25,000,000', marketPrices: [] },
                    { rowNumber: 4, productId: 'B', brand: 'Bosch', model: 'WQG24570SG', salePrice: '18,000,000', marketPrices: [] },
                ],
            }),
            processPricingRow: async ({ row, deps }) => {
                if (row.rowNumber === 3) {
                    firstRowStarted = true;
                    await firstRowDone;
                    if (deps.shouldStop && deps.shouldStop()) {
                        throw new Error('STOP_REQUESTED');
                    }
                    return {
                        rowNumber: 3,
                        productId: 'A',
                        brand: 'Bosch',
                        model: 'WQB245B40',
                        matchedUrls: [],
                        matchedDetails: [],
                        totalLinksCount: 0,
                        marketPrices: [23900000, 24000000, 24100000],
                        hasNewPrices: true,
                        minPrice: 23900000,
                        gapValue: 1100000,
                        gapPercent: 0.044,
                        suggestedPrice: 23979667,
                        outlierRemoved: false,
                        status: 'success',
                    };
                }

                secondRowStarted = true;
                return {
                    rowNumber: 4,
                    productId: 'B',
                    brand: 'Bosch',
                    model: 'WQG24570SG',
                    matchedUrls: [],
                    matchedDetails: [],
                    totalLinksCount: 0,
                    marketPrices: [16500000, 16600000, 16700000],
                    hasNewPrices: true,
                    minPrice: 16500000,
                    gapValue: 1500000,
                    gapPercent: 0.083,
                    suggestedPrice: 16517000,
                    outlierRemoved: false,
                    status: 'success',
                };
            },
            writeSheetUpdates: async () => ({ updated: 1 }),
        },
    });

    for (let i = 0; i < 20 && !firstRowStarted; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(firstRowStarted, true);

    assert.equal(stopBackgroundPricingJob(jobId), true);
    releaseFirstRow();

    for (let i = 0; i < 40; i += 1) {
        const status = getBackgroundPricingJobStatus(jobId);
        if (status && status.status === 'stopped') {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const status = getBackgroundPricingJobStatus(jobId);
    assert.equal(status.status, 'stopped');
    assert.equal(secondRowStarted, false);
});

test('model matching rejects partial digit sequence matches like WQG245 for WQG24570GB', () => {
    const { isModelMatch } = require('../lib/sheet-pricing-service.js');
    // WQG245 has digits 245, WQG24570GB has digits 24570. They should not match because digits conflict.
    assert.equal(isModelMatch('Bosch WQG24570GB', 'WQG245', 'Bosch'), false);
    // BL871 (digits 871) vs BL871D31 (digits 87131) without brand match prefix
    assert.equal(isModelMatch('Máy xay sinh tố Panasonic BL871D31', 'BL871', 'Panasonic'), false);
});

test('loadModelMapping resolves sheet name via listSheets to prevent unicode mismatches', async () => {
    const requestedSheetNames = [];
    const mockFetch = async (url) => {
        const parsed = new URL(String(url));
        const action = parsed.searchParams.get('action');
        if (action === 'listSheets') {
            return {
                ok: true,
                json: async () => ({
                    ok: true,
                    sheets: ['08.Giặt sấy', '18.Mã sản phẩm'] // decomposed unicode version
                })
            };
        }
        if (action === 'readRows') {
            requestedSheetNames.push(parsed.searchParams.get('sheetName'));
            return {
                ok: true,
                json: async () => ({
                    headers: ['Thương hiệu', 'Mã sản phẩm', 'Model'],
                    rows: [
                        { rowNumber: 2, values: ['Tefal', '2100112290', 'G2550402'] }
                    ]
                })
            };
        }
        return { ok: false };
    };

    const mapping = await loadModelMapping({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        fetchImpl: mockFetch,
    });

    assert.deepEqual(mapping, { '2100112290': 'G2550402' });
    assert.deepEqual(requestedSheetNames, ['18.Mã sản phẩm']);
});

test('startBackgroundPricingJob includes successfully matched details in logs passed to writeSheetUpdates', async () => {
    let capturedLogs = null;
    let capturedUpdates = null;

    const jobId = startBackgroundPricingJob({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        sheetName: '08.Giặt sấy',
        rowsConcurrency: 1,
        linksConcurrency: 1,
        batchSize: 1,
        deps: {
            loadModelMapping: async () => ({}),
            readSheetRows: async () => ({
                rows: [
                    { rowNumber: 3, productId: 'A', brand: 'Bosch', model: 'WQB245B40', salePrice: '25,000,000', marketPrices: [] },
                ],
            }),
            processPricingRow: async () => {
                return {
                    rowNumber: 3,
                    productId: 'A',
                    brand: 'Bosch',
                    model: 'WQB245B40',
                    matchedUrls: ['https://example.com/bosch-wqb245b40'],
                    matchedDetails: [
                        { url: 'https://example.com/bosch-wqb245b40', price: 23900000 }
                    ],
                    totalLinksCount: 1,
                    marketPrices: [23900000],
                    hasNewPrices: true,
                    minPrice: 23900000,
                    gapValue: 1100000,
                    gapPercent: 0.044,
                    suggestedPrice: null,
                    status: 'insufficient_prices',
                };
            },
            writeSheetUpdates: async ({ updates, logs }) => {
                capturedUpdates = updates;
                capturedLogs = logs;
                return { updated: 1 };
            },
        },
    });

    // Wait for the job to complete
    for (let i = 0; i < 50; i += 1) {
        const status = getBackgroundPricingJobStatus(jobId);
        if (status && status.status === 'completed') {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(capturedUpdates.length, 1);
    assert.equal(capturedUpdates[0].rowNumber, 3);
    
    assert.ok(Array.isArray(capturedLogs));
    assert.equal(capturedLogs.length, 1);
    assert.equal(capturedLogs[0].brand, 'Bosch');
    assert.equal(capturedLogs[0].model, 'WQB245B40');
    assert.equal(capturedLogs[0].price, 23900000);
    assert.equal(capturedLogs[0].url, 'https://example.com/bosch-wqb245b40');
});




