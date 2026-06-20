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
    syncHaravanIds,
    loadHaravanMapping,
    updateHaravanVariantPrice,
    sendTelegramNotification,
    writeHaravanLog,
    updateSheetSalePrice,
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
            costPrice: '9,000,000',
            salePrice: '11,040,000',
        },
        deps: {
            searchProductLinks: async () => ([
                'https://shop-a.vn/products/kocher-di-355.html',
                'https://shop-b.vn/search?q=kocher+di355',
                'https://shop-c.vn/products/kocher-di-355-b.html',
                'https://shop-d.vn/collections/bep-tu',
            ]),
            extractProductPrice: async (url) => {
                const values = {
                    'https://shop-a.vn/products/kocher-di-355.html': 10100000,
                    'https://shop-c.vn/products/kocher-di-355-b.html': 10200000,
                };
                return values[url] || null;
            },
        },
    });

    assert.equal(result.rowNumber, 3);
    assert.deepEqual(result.matchedUrls, [
        'https://shop-a.vn/products/kocher-di-355.html',
        'https://shop-c.vn/products/kocher-di-355-b.html',
    ]);
    assert.deepEqual(result.marketPrices, [10100000, 10200000]);
    assert.equal(result.minPrice, 10100000);
    assert.equal(result.gapValue, 2040000); // 11,040,000 - 9,000,000
    assert.equal(result.suggestedPrice, 10100000);
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
            costPrice: '8,000,000',
            salePrice: '9,120,000',
        },
        deps: {
            searchProductLinks: async () => [...priceMap.keys()],
            extractProductPrice: async (url) => priceMap.get(url) || null,
        },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.minPrice, 9000000);
    assert.equal(result.gapValue, 1120000); // 9,120,000 - 8,000,000
    assert.equal(result.suggestedPrice, 9000000);
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
            costPrice: '1,000,000',
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
            costPrice: '1,000,000',
        }
    });
    assert.equal(resultNoBrand.status, 'skipped');

    const resultNoModel = await processPricingRow({
        row: {
            rowNumber: 7,
            brand: 'Kocher',
            model: '',
            costPrice: '1,000,000',
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
            costPrice: '8,500,000',
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
    assert.equal(result.gapValue, 1000000); // 9,500,000 - 8,500,000
    assert.equal(result.suggestedPrice, 9000000); // Min
    assert.equal(result.status, 'success');
});

test('processPricingRow filters out invalid prices outside range [100,000 - 2,000,000,000]', async () => {
    const priceMap = new Map([
        ['https://a.vn/p/kocher-di-333pro', 99999], // Too low, should be ignored
        ['https://b.vn/p/kocher-di-333pro', 9000000], // Valid
        ['https://c.vn/p/kocher-di-333pro', 9100000], // Valid
        ['https://d.vn/p/kocher-di-333pro', 9200000], // Valid
        ['https://e.vn/p/kocher-di-333pro', 2000000001], // Too high, should be ignored
    ]);

    const result = await processPricingRow({
        row: {
            rowNumber: 9,
            productId: 'BT-009',
            brand: 'Kocher',
            model: 'DI-333Pro',
            costPrice: '1,000,000',
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
    assert.equal(result.suggestedPrice, 9000000);
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
            costPrice: '500,000',
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
    assert.equal(result.suggestedPrice, 550000);
});

test('loadModelMapping loads mapping rows and parses columns correctly', async () => {
    const mockFetch = async () => {
        return {
            ok: true,
            json: async () => ({
                headers: Array(15).fill(''),
                rows: [
                    { rowNumber: 3, values: [...Array(13).fill(''), '2100112290', 'G2550402'] },
                    { rowNumber: 4, values: [...Array(13).fill(''), '8010001304', 'BL100230'] }
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

test('loadModelMapping requests the real LOG sheet name', async () => {
    let requestedUrl = '';
    const mockFetch = async (url) => {
        requestedUrl = String(url);
        return {
            ok: true,
            json: async () => ({
                headers: Array(15).fill(''),
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
    assert.equal(parsed.searchParams.get('sheetName'), 'LOG');
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
            costPrice: '1,000,000',
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

test('model matching accepts letters suffix followed by digit in title/URL', () => {
    const { isModelMatch } = require('../lib/sheet-pricing-service.js');
    assert.equal(isModelMatch('Bếp từ đôi Eurosun EU-T210Pro 2 vùng nấu 3600W', 'EU-T210 Pro', 'Eurosun'), true);
    assert.equal(isModelMatch('https://ctluxhome.vn/bep-tu-eurosun-eu-t210pro-2-vung-nau-3600w-2.html', 'EU-T210 Pro', 'Eurosun'), true);
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
    assert.equal(isFakePrice(14202000, 'KF-IH202IC'), false);
    assert.equal(isFakePrice(13320000, 'DI-332Pro'), false);
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
                    { rowNumber: 3, productId: 'A', brand: 'Bosch', model: 'WQB245B40', costPrice: '1,000,000', salePrice: '25,000,000', marketPrices: [] },
                    { rowNumber: 4, productId: 'B', brand: 'Bosch', model: 'WQG24570SG', costPrice: '1,000,000', salePrice: '18,000,000', marketPrices: [] },
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
                    sheets: ['08.Giặt sấy', 'LOG']
                })
            };
        }
        if (action === 'readRows') {
            requestedSheetNames.push(parsed.searchParams.get('sheetName'));
            return {
                ok: true,
                json: async () => ({
                    headers: Array(15).fill(''),
                    rows: [
                        { rowNumber: 4, values: [...Array(13).fill(''), '2100112290', 'G2550402'] }
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
    assert.deepEqual(requestedSheetNames, ['LOG']);
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
                    { rowNumber: 3, productId: 'A', brand: 'Bosch', model: 'WQB245B40', costPrice: '1,000,000', salePrice: '25,000,000', marketPrices: [] },
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

test('syncHaravanIds fetches pages from Haravan and writes them via Apps Script', async () => {
    let capturedAppsScriptPayload = null;

    const mockFetch = async (url, options = {}) => {
        const urlStr = String(url);
        
        // Mock Haravan API
        if (urlStr.includes('admin/products.json')) {
            const parsed = new URL(urlStr);
            const page = parseInt(parsed.searchParams.get('page'), 10);
            
            if (page === 1) {
                return {
                    ok: true,
                    json: async () => ({
                        products: [
                            {
                                title: 'Tefal Blender',
                                vendor: 'Tefal',
                                variants: [
                                    { sku: 'BL871D31', id: 12345, price: '1,500,000' }
                                ]
                            }
                        ]
                    })
                };
            }
            
            // End of pages
            return {
                ok: true,
                json: async () => ({ products: [] })
            };
        }

        // Mock Apps Script
        if (urlStr.includes('example/exec')) {
            const body = JSON.parse(options.body || '{}');
            if (body.action === 'writeHaravanIds') {
                capturedAppsScriptPayload = body;
                return {
                    ok: true,
                    json: async () => ({ ok: true, written: body.rows.length })
                };
            }
        }

        return { ok: false };
    };

    const result = await syncHaravanIds({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        haravanShopUrl: 'https://bepngocbao.myharavan.com',
        haravanAccessToken: 'mock-token',
        fetchImpl: mockFetch,
    });

    assert.equal(result.ok, true);
    assert.equal(result.fetched, 1);
    assert.equal(result.written, 1);

    assert.ok(capturedAppsScriptPayload);
    assert.equal(capturedAppsScriptPayload.action, 'writeHaravanIds');
    assert.equal(capturedAppsScriptPayload.sheetId, '1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo');
    assert.deepEqual(capturedAppsScriptPayload.rows, [
        {
            product_name: 'Tefal Blender',
            brand: 'Tefal',
            model: 'BL871D31',
            variant_id: 12345,
        }
    ]);
});

test('syncHaravanIds model extraction fallback when SKU/Barcode missing', async () => {
    let capturedPayload = null;

    const mockFetch = async (url, options = {}) => {
        const urlStr = String(url);
        
        // Mock Haravan API - page 1
        if (urlStr.includes('admin/products.json')) {
            const parsed = new URL(urlStr);
            const page = parseInt(parsed.searchParams.get('page'), 10);
            
            if (page === 1) {
                return {
                    ok: true,
                    json: async () => ({
                        products: [
                            {
                                title: 'MÁY RỬA CHÉN BOSCH SMS4IVI01P CHÍNH HÃNG',
                                vendor: 'Bosch',
                                variants: [
                                    { sku: '', barcode: '', id: 111 }
                                ]
                            },
                            {
                                title: 'NỒI CHIÊN KHÔNG DẦU TEFAL',
                                vendor: 'Tefal',
                                variants: [
                                    { sku: ' ', barcode: null, id: 222 }
                                ]
                            }
                        ]
                    })
                };
            }
            
            return {
                ok: true,
                json: async () => ({ products: [] })
            };
        }
        
        // Mock Apps Script
        if (urlStr.includes('example/exec')) {
            capturedPayload = JSON.parse(options.body || '{}');
            return {
                ok: true,
                json: async () => ({ ok: true, written: capturedPayload.rows.length })
            };
        }
        
        return { ok: false };
    };

    const result = await syncHaravanIds({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        haravanShopUrl: 'https://bepngocbao.myharavan.com',
        haravanAccessToken: 'mock-token',
        fetchImpl: mockFetch,
    });

    assert.equal(result.ok, true);
    assert.equal(result.fetched, 2);
    assert.ok(capturedPayload);
    assert.deepEqual(capturedPayload.rows, [
        {
            product_name: 'MÁY RỬA CHÉN BOSCH SMS4IVI01P CHÍNH HÃNG',
            brand: 'Bosch',
            model: 'SMS4IVI01P', // Extracted via regex
            variant_id: 111,
        },
        {
            product_name: 'NỒI CHIÊN KHÔNG DẦU TEFAL',
            brand: 'Tefal',
            model: 'CHIÊN KHÔNG DẦU', // Extracted via cleanProductName (prefix "NỒI" and brand "TEFAL" removed)
            variant_id: 222,
        }
    ]);
});

test('syncHaravanIds model extraction with new patterns and brand auto-detection', async () => {
    let capturedPayload = null;

    const mockFetch = async (url, options = {}) => {
        const urlStr = String(url);
        
        // Mock Haravan API - page 1
        if (urlStr.includes('admin/products.json')) {
            const parsed = new URL(urlStr);
            const page = parseInt(parsed.searchParams.get('page'), 10);
            
            if (page === 1) {
                return {
                    ok: true,
                    json: async () => ({
                        products: [
                            {
                                // Pattern: \b[A-Z]{2,}\d+[A-Z0-9\-]*\b
                                title: 'Bếp từ Bosch PIE631FB1E cao cấp',
                                vendor: '', // Test title brand auto-detect (bosch -> Bosch)
                                variants: [
                                    { sku: '', barcode: '', id: 101 }
                                ]
                            },
                            {
                                // Pattern: \b\d+[A-Z]{2,}[A-Z0-9\-]*\b
                                title: 'Lò nướng Hafele 53RPM-A',
                                vendor: 'Hafele',
                                variants: [
                                    { sku: '', barcode: '', id: 102 }
                                ]
                            },
                            {
                                // Pattern: \b[A-Z]+\-\d+[A-Z0-9\-]*\b
                                title: 'Vòi rửa chén Konox KN-1234',
                                vendor: 'Konox',
                                variants: [
                                    { sku: '', barcode: '', id: 103 }
                                ]
                            },
                            {
                                // Pattern: \b[A-Z0-9]+\-[A-Z0-9]+\b
                                title: 'Khóa cửa Kluger K3-A9',
                                vendor: 'Kluger',
                                variants: [
                                    { sku: '', barcode: '', id: 104 }
                                ]
                            },
                            {
                                // Pattern: \bH\d{2,}[A-Z0-9\-]*\b
                                title: 'Hút mùi Canzy H789-Pro',
                                vendor: 'Canzy',
                                variants: [
                                    { sku: '', barcode: '', id: 105 }
                                ]
                            }
                        ]
                    })
                };
            }
            
            return {
                ok: true,
                json: async () => ({ products: [] })
            };
        }
        
        // Mock Apps Script
        if (urlStr.includes('example/exec')) {
            capturedPayload = JSON.parse(options.body || '{}');
            return {
                ok: true,
                json: async () => ({ ok: true, written: capturedPayload.rows.length })
            };
        }
        
        return { ok: false };
    };

    const result = await syncHaravanIds({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        haravanShopUrl: 'https://bepngocbao.myharavan.com',
        haravanAccessToken: 'mock-token',
        fetchImpl: mockFetch,
    });

    assert.equal(result.ok, true);
    assert.equal(result.fetched, 5);
    assert.ok(capturedPayload);

    assert.deepEqual(capturedPayload.rows, [
        {
            product_name: 'Bếp từ Bosch PIE631FB1E cao cấp',
            brand: 'Bosch', // Auto-detected from title and formatted in Title case
            model: 'PIE631FB1E',
            variant_id: 101,
        },
        {
            product_name: 'Lò nướng Hafele 53RPM-A',
            brand: 'Hafele',
            model: '53RPM-A',
            variant_id: 102,
        },
        {
            product_name: 'Vòi rửa chén Konox KN-1234',
            brand: 'Konox',
            model: 'KN-1234',
            variant_id: 103,
        },
        {
            product_name: 'Khóa cửa Kluger K3-A9',
            brand: 'Kluger',
            model: 'K3-A9',
            variant_id: 104,
        },
        {
            product_name: 'Hút mùi Canzy H789-Pro',
            brand: 'Canzy',
            model: 'H789-PRO', // Capitalized in model extraction
            variant_id: 105,
        }
    ]);
});

test('loadHaravanMapping parses sheet 20 data into key-value map', async () => {
    const mockFetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('action=readRows')) {
            return {
                ok: true,
                json: async () => ({
                    headers: ['Tên sản phẩm', 'Thương hiệu', 'Model', 'ID'],
                    rows: [
                        { values: ['Bếp Bosch', 'Bosch', 'SMS4IVI01P', '1171221460'] },
                        { values: ['Vòi Konox', 'Konox', 'KN-1234', '1171221461'] }
                    ]
                })
            };
        }
        return { ok: false };
    };

    const mapping = await loadHaravanMapping({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        fetchImpl: mockFetch
    });

    assert.deepEqual(mapping, {
        'BOSCH_SMS4IVI01P': '1171221460',
        'KONOX_KN1234': '1171221461'
    });
});

test('updateHaravanVariantPrice makes correct PUT request to Haravan', async () => {
    let capturedUrl = null;
    let capturedOptions = null;

    const mockFetch = async (url, options = {}) => {
        capturedUrl = String(url);
        capturedOptions = options;
        return {
            ok: true,
            json: async () => ({ ok: true })
        };
    };

    const result = await updateHaravanVariantPrice({
        haravanShopUrl: 'https://bepngocbao.myharavan.com',
        haravanAccessToken: 'my-token',
        variantId: '1171221460',
        price: '15000000',
        fetchImpl: mockFetch
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(capturedUrl, 'https://bepngocbao.myharavan.com/admin/variants/1171221460.json');
    assert.equal(capturedOptions.method, 'PUT');
    assert.equal(capturedOptions.headers['Authorization'], 'Bearer my-token');
    assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
    
    const body = JSON.parse(capturedOptions.body);
    assert.deepEqual(body, {
        variant: {
            id: 1171221460,
            price: '15000000'
        }
    });
});

test('processPricingRow mock crawls for sheet 21.Test', async () => {
    const result = await processPricingRow({
        row: {
            rowNumber: 3,
            productId: 'TS-001',
            brand: 'Cleer',
            model: 'test',
            costPrice: '50,000',
            salePrice: '100,000',
            sheetName: '21.Test',
        }
    });

    assert.equal(result.status, 'success');
    assert.equal(result.minPrice, 100000);
    assert.equal(result.suggestedPrice, 100000);
    assert.equal(result.totalLinksCount, 10);
    assert.ok(Array.isArray(result.marketPrices));
    assert.equal(result.marketPrices.length, 10);
    assert.equal(result.marketPrices[0], 100000);
    assert.equal(result.matchedUrls[0], 'https://mock-market-test.vn/cleer-test-p1');
});

test('sendTelegramNotification dispatches correct POST request to Telegram API', async () => {
    let capturedUrl = null;
    let capturedOptions = null;

    const mockFetch = async (url, options = {}) => {
        capturedUrl = String(url);
        capturedOptions = options;
        return {
            ok: true,
            json: async () => ({ ok: true, result: { message_id: 99 } })
        };
    };

    const result = await sendTelegramNotification({
        telegramBotToken: '123456:mocktoken',
        telegramChatId: '-100200300',
        message: 'Hello <b>World</b>',
        fetchImpl: mockFetch
    });

    assert.deepEqual(result, { ok: true, result: { message_id: 99 } });
    assert.equal(capturedUrl, 'https://api.telegram.org/bot123456:mocktoken/sendMessage');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers['Content-Type'], 'application/json');

    const body = JSON.parse(capturedOptions.body);
    assert.deepEqual(body, {
        chat_id: '-100200300',
        text: 'Hello <b>World</b>',
        parse_mode: 'HTML'
    });
});

test('writeHaravanLog dispatches correct POST request to Apps Script API', async () => {
    let capturedUrl = null;
    let capturedOptions = null;

    const mockFetch = async (url, options = {}) => {
        capturedUrl = String(url);
        capturedOptions = options;
        return {
            ok: true,
            json: async () => ({ ok: true, written: 1 })
        };
    };

    const result = await writeHaravanLog({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        brand: 'Bosch',
        model: 'SMS4IVI01P',
        price: '15000000',
        status: 'Thành công',
        fetchImpl: mockFetch
    });

    assert.deepEqual(result, { ok: true, written: 1 });
    assert.ok(capturedUrl.includes('example/exec'));
    assert.equal(capturedOptions.method, 'POST');

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.action, 'writeHaravanLog');
    assert.equal(body.sheetId, '1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo');
    assert.equal(body.brand, 'Bosch');
    assert.equal(body.model, 'SMS4IVI01P');
    assert.equal(body.price, '15000000');
    assert.equal(body.status, 'Thành công');
});

test('updateSheetSalePrice dispatches correct POST request to Apps Script API', async () => {
    let capturedUrl = null;
    let capturedOptions = null;

    const mockFetch = async (url, options = {}) => {
        capturedUrl = String(url);
        capturedOptions = options;
        return {
            ok: true,
            json: async () => ({ ok: true })
        };
    };

    const result = await updateSheetSalePrice({
        appsScriptUrl: 'https://script.google.com/macros/s/example/exec',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo/edit',
        sheetName: '08.Giặt sấy',
        rowNumber: 3,
        price: '23900000',
        fetchImpl: mockFetch
    });

    assert.deepEqual(result, { ok: true });
    assert.ok(capturedUrl.includes('example/exec'));
    assert.equal(capturedOptions.method, 'POST');

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.action, 'updateSalePrice');
    assert.equal(body.sheetId, '1DglC7bv2hZPfwb-bXPaO3iuDClfVKFCizfHqqiUNqMo');
    assert.equal(body.sheetName, '08.Giặt sấy');
    assert.equal(body.rowNumber, 3);
    assert.equal(body.price, 23900000);
});

test('scoreProductUrl correctly evaluates relevance of product detail URLs', () => {
    const { scoreProductUrl } = require('../lib/sheet-pricing-service.js');
    
    // Exact model and brand in URL
    const high = scoreProductUrl('https://kocher.vn/bep-tu/bep-tu-di-332pro/', 'DI-332Pro', 'Kocher');
    // Brand and model digits, but not exact model format
    const mid = scoreProductUrl('https://www.dienmayxanh.com/bep-tu/bep-tu-doi-am-kocher-di-332-pro-5000w', 'DI-332Pro', 'Kocher');
    // Just brand, no model
    const low = scoreProductUrl('https://meta.vn/kocher.html', 'DI-332Pro', 'Kocher');
    // Random page, no brand or model
    const zero = scoreProductUrl('https://kocher.vn/gioi-thieu/', 'DI-332Pro', 'Kocher');

    assert.ok(high >= mid, `high: ${high} should be >= mid: ${mid}`);
    assert.ok(mid > low, `mid: ${mid} should be greater than low: ${low}`);
    assert.ok(low > zero, `low: ${low} should be greater than zero: ${zero}`);
});

test('extractProductPrice filters out discount amounts and related product slider prices', async () => {
    const { extractProductPrice } = require('../lib/sheet-pricing-service.js');

    const htmlContent = `
        <html>
            <head><title>Bếp từ Kocher DI-332Pro chính hãng</title></head>
            <body>
                <h1>Bếp từ Kocher DI-332Pro</h1>
                <!-- Main product price block -->
                <div class="product-info-main">
                    <span class="special-price">Giá khuyến mại: <span class="price">10.400.000đ</span></span>
                    <span class="old-price"><del>16.550.000đ</del></span>
                    
                    <!-- Discount amount badge - should be blocked! -->
                    <div class="discount-badge">Tiết kiệm: <span class="price">6.150.000đ</span></div>
                </div>

                <!-- Related products slider - should be blocked! -->
                <div class="swiper-container product-related-slider">
                    <div class="swiper-wrapper">
                        <div class="swiper-slide product-item">
                            <h3>Bếp từ Kocher DI-336Pro</h3>
                            <span class="price">9.100.000đ</span>
                        </div>
                        <div class="swiper-slide product-item">
                            <h3>Bếp từ Kocher DI-333SE</h3>
                            <div class="discount">Giảm 3.400.000đ</div>
                            <span class="price">12.550.000đ</span>
                        </div>
                    </div>
                </div>
            </body>
        </html>
    `;

    const mockFetch = async () => {
        return {
            ok: true,
            text: async () => htmlContent
        };
    };

    const price = await extractProductPrice({
        url: 'https://example-shop.com/kocher-di-332pro',
        model: 'DI-332Pro',
        brand: 'Kocher',
        referencePrice: '7,600,000',
        fetchImpl: mockFetch
    });

    // It should extract 10,400,000 VND (not 6,150,000 or 9,100,000 or 3,400,000)
    assert.equal(price, 10400000);
});

test('extractProductPrice returns null and does not fall back to unrelated product prices if main product price is missing', async () => {
    const { extractProductPrice } = require('../lib/sheet-pricing-service.js');

    const htmlContent = `
        <html>
            <head><title>Bếp từ đôi Spelier STL 220C chính hãng</title></head>
            <body>
                <h1>Bếp từ đôi Spelier STL 220C</h1>
                
                <!-- Main product price is contact only -->
                <div class="product-info-main">
                    <span class="price-contact">Giá: Liên hệ</span>
                </div>

                <!-- Related products slider - has prices, but should NOT be picked up because they do not match model Spelier STL 220C -->
                <div class="related-products">
                    <div class="product-item">
                        <h3>Máy hút mùi Sevilla SV-70T2S</h3>
                        <span class="price">5.250.000₫</span>
                    </div>
                </div>
            </body>
        </html>
    `;

    const mockFetch = async () => {
        return {
            ok: true,
            text: async () => htmlContent
        };
    };

    const price = await extractProductPrice({
        url: 'https://example-shop.com/spelier-stl-220c',
        model: 'STL-220C',
        brand: 'Spelier',
        referencePrice: '7,000,000',
        fetchImpl: mockFetch
    });

    // It should return null (skip the link), not the Sevilla price (5,250,000đ)
    assert.equal(price, null);
});

test('isModelMatch handles suffix conflicts correctly (X-NANO 8 vs X-NANO 8 Plus)', () => {
    const { isModelMatch } = require('../lib/sheet-pricing-service.js');
    
    // 1. Text has suffix, Model has no suffix -> should NOT match
    assert.equal(isModelMatch('https://kocher.vn/bep-tu/bep-tu-kocher-x-nano-8-plus/', 'X-NANO 8', 'Kocher'), false);
    assert.equal(isModelMatch('Bếp từ Kocher X-Nano 8 Plus chính hãng', 'X-NANO 8', 'Kocher'), false);
    
    // 2. Model has suffix, Text has no suffix -> should NOT match
    assert.equal(isModelMatch('https://kocher.vn/bep-tu/bep-tu-kocher-x-nano-8/', 'X-NANO 8 Plus', 'Kocher'), false);
    assert.equal(isModelMatch('Bếp từ Kocher X-Nano 8 chính hãng', 'X-NANO 8 Plus', 'Kocher'), false);
 
    // 3. Both have suffix -> should match
    assert.equal(isModelMatch('https://kocher.vn/bep-tu/bep-tu-kocher-x-nano-8-plus/', 'X-NANO 8 Plus', 'Kocher'), true);
    assert.equal(isModelMatch('Bếp từ Kocher X-Nano 8 Plus chính hãng', 'X-NANO 8 Plus', 'Kocher'), true);
    
    // 4. Regular matches regular
    assert.equal(isModelMatch('Bếp từ Kocher X-Nano 8 chính hãng', 'X-NANO 8', 'Kocher'), true);
    assert.equal(isModelMatch('https://kocher.vn/bep-tu/bep-tu-kocher-x-nano-8/', 'X-NANO 8', 'Kocher'), true);
});

test('isModelMatch handles prefix conflicts correctly (SMM T170N vs SPM T170)', () => {
    const { isModelMatch } = require('../lib/sheet-pricing-service.js');
    
    // Conflicting prefixes should NOT match
    assert.equal(isModelMatch('https://showroomspelier.vn/bep-tu/bep-tu-doi-spelier-spm-t170k-plus-lap-am/', 'SMM T170N', 'Spelier'), false);
    assert.equal(isModelMatch('https://speliervietnam.com.vn/san-pham/bep-tu-doi-spelier-spm-t-170n/', 'SMM T170N', 'Spelier'), false);
    
    // Matching prefixes should match
    assert.equal(isModelMatch('https://speliervietnam.com.vn/san-pham/bep-tu-doi-spelier-spm-t-170n/', 'SPM T170N', 'Spelier'), true);
    assert.equal(isModelMatch('https://tongkhobep.com.vn/san-pham/bep-tu-kocher-di-333se-bao-hanh-3-nam/', 'DI-333SE', 'Kocher'), true);
    assert.equal(isModelMatch('https://tongkhobep.com.vn/san-pham/bep-tu-kocher-dib4-333se-bao-hanh-3-nam/', 'DI-333SE', 'Kocher'), false);
});

test('extractProductPrice ignores discount badge like on tongkhobep.com.vn', async () => {
    const { extractProductPrice } = require('../lib/sheet-pricing-service.js');

    const htmlContent = `
        <div class="price-wrapper style1">
            <p class="price product-page-price price-on-sale">
                <ins><span class="woocommerce-Price-amount amount"><bdi>12.550.000<span class="woocommerce-Price-currencySymbol">₫</span></bdi></span></ins>
                <del><span class="woocommerce-Price-amount amount"><bdi>15.950.000<span class="woocommerce-Price-currencySymbol">₫</span></bdi></span></del>
            </p>
        </div>
        <span class="percent-deal1">Giảm <span><span class="woocommerce-Price-amount amount"><bdi>3.400.000<span class="woocommerce-Price-currencySymbol">₫</span></bdi></span></span></span>
    `;

    const mockFetch = async () => {
        return {
            ok: true,
            text: async () => htmlContent
        };
    };

    const price = await extractProductPrice({
        url: 'https://tongkhobep.com.vn/san-pham/bep-tu-kocher-di-333se-bao-hanh-3-nam/',
        model: 'DI-333SE',
        brand: 'Kocher',
        referencePrice: '10,000,000',
        fetchImpl: mockFetch
    });

    // Should extract the actual sale price (12.550.000), not the discount amount (3.400.000)
    assert.equal(price, 12550000);
});

test('searchProductLinks performs sequential fallback and respects pagination', async () => {
    const { searchProductLinks } = require('../lib/sheet-pricing-service.js');
    const urlsRequested = [];
    const mockFetch = async (url) => {
        urlsRequested.push(url);
        if (url.includes('google.com')) {
            return {
                ok: true,
                text: async () => `
                    <html>
                        <body>
                            <a href="/url?q=https://google-result-1.com/p">Link 1</a>
                            <a href="/url?q=https://google-result-2.com/p">Link 2</a>
                        </body>
                    </html>
                `
            };
        }
        if (url.includes('bing.com')) {
            if (url.includes('first=1')) {
                return {
                    ok: true,
                    text: async () => `
                        <html>
                            <body>
                                <cite>https://bing-result-1.com/p</cite>
                                <cite>https://bing-result-2.com/p</cite>
                                <cite>https://bing-result-3.com/p</cite>
                                <cite>https://bing-result-4.com/p</cite>
                                <cite>https://bing-result-5.com/p</cite>
                                <cite>https://bing-result-6.com/p</cite>
                            </body>
                        </html>
                    `
                };
            } else {
                return {
                    ok: true,
                    text: async () => `
                        <html>
                            <body>
                                <cite>https://bing-result-7.com/p</cite>
                                <cite>https://bing-result-8.com/p</cite>
                            </body>
                        </html>
                    `
                };
            }
        }
        return { ok: true, text: async () => '' };
    };

    const links = await searchProductLinks({
        brand: 'Kocher',
        model: 'DI-332Pro',
        limit: 5,
        fetchImpl: mockFetch
    });

    assert.ok(urlsRequested.some(u => u.includes('google.com') && u.includes('start=0')));
    assert.ok(!urlsRequested.some(u => u.includes('google.com') && u.includes('start=40')));
    assert.ok(urlsRequested.some(u => u.includes('bing.com') && u.includes('first=1')));
    assert.ok(urlsRequested.some(u => u.includes('bing.com') && u.includes('first=51')));
    assert.ok(urlsRequested.some(u => u.includes('duckduckgo.com')));
    assert.ok(urlsRequested.some(u => u.includes('coccoc.com')));

    assert.ok(links.includes('https://google-result-1.com/p'));
    assert.ok(links.includes('https://bing-result-1.com/p'));
    assert.ok(links.includes('https://bing-result-7.com/p'));
});

test('isModelMatch handles compound suffixes (e.g. KF-IH870Z vs KF-IH870Z Plus)', () => {
    const { isModelMatch } = require('../lib/sheet-pricing-service.js');
    assert.equal(isModelMatch('Bếp từ Kaff KF-IH870Z Plus', 'KF-IH870Z Plus', 'Kaff'), true);
    assert.equal(isModelMatch('Bếp từ Kaff KF-IH870Z', 'KF-IH870Z Plus', 'Kaff'), false);
    assert.equal(isModelMatch('Bếp từ Kaff KF-IH870Z Plus', 'KF-IH870Z', 'Kaff'), false);
    assert.equal(isModelMatch('Bếp từ Kaff KF-IH870Z', 'KF-IH870Z', 'Kaff'), true);
});

test('extractProductPrice ignores discount badge with underscores like on digigo.vn', async () => {
    const { extractProductPrice } = require('../lib/sheet-pricing-service.js');
    const htmlContent = `
        <div class="product-info-main">
            <div class="price-wrapper">
                <span class="woocommerce-Price-amount amount"><bdi>3.590.000&nbsp;<span class="woocommerce-Price-currencySymbol">₫</span></bdi></span>
            </div>
            <div class="devvn_price_tiet_kiem">
                <span class="t">Tiết kiệm:</span>
                <span class="c"><span class="woocommerce-Price-amount amount"><bdi>3.000.000&nbsp;<span class="woocommerce-Price-currencySymbol">₫</span></bdi></span></span>
            </div>
        </div>
    `;

    const mockFetch = async () => {
        return {
            ok: true,
            text: async () => htmlContent
        };
    };

    const price = await extractProductPrice({
        url: 'https://digigo.vn/may-hut-mui-am-tu-hawonkoo-hrh-703/',
        model: 'HRH-703',
        brand: 'Hawonkoo',
        referencePrice: '3,000,000',
        fetchImpl: mockFetch
    });

    assert.equal(price, 3590000);
});

test('searchProductLinks falls back when only low-quality links are found', async () => {
    const { searchProductLinks } = require('../lib/sheet-pricing-service.js');
    const urlsRequested = [];
    const mockFetch = async (url) => {
        urlsRequested.push(url);
        if (url.includes('google.com')) {
            return {
                ok: true,
                text: async () => `
                    <html>
                        <body>
                            <!-- Low quality links (will fail isLikelyProductDetailUrl since they don't contain model and have no hyphens/html) -->
                            <a href="https://kocher.vn">Home</a>
                            <a href="https://facebook.com">Facebook</a>
                        </body>
                    </html>
                `
            };
        }
        if (url.includes('bing.com')) {
            return {
                ok: true,
                text: async () => `
                    <html>
                        <body>
                            <!-- Still low quality -->
                            <cite>https://meta.vn</cite>
                        </body>
                    </html>
                `
            };
        }
        if (url.includes('duckduckgo.com')) {
            return {
                ok: true,
                text: async () => `
                    <html>
                        <body>
                            <!-- High quality likely link -->
                            <a class="result__a" href="https://duckduckgo.com/l/?uddg=https://kocher.vn/bep-tu-di-332pro.html">Result</a>
                        </body>
                    </html>
                `
            };
        }
        return { ok: true, text: async () => '' };
    };

    const links = await searchProductLinks({
        brand: 'Kocher',
        model: 'DI-332Pro',
        limit: 5,
        fetchImpl: mockFetch
    });

    // It should have called Google, Bing, and DDG because the previous ones only returned low quality links
    assert.ok(urlsRequested.some(u => u.includes('google.com')));
    assert.ok(urlsRequested.some(u => u.includes('bing.com')));
    assert.ok(urlsRequested.some(u => u.includes('duckduckgo.com')));
    
    assert.ok(links.includes('https://kocher.vn'));
    assert.ok(links.includes('https://meta.vn'));
    assert.ok(links.includes('https://kocher.vn/bep-tu-di-332pro.html'));
});

test('processPricingRow processes normally and sets gapValue and gapPercent to null if costPrice is missing', async () => {
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
            costPrice: '', // Missing cost price
            salePrice: '9,120,000',
        },
        deps: {
            searchProductLinks: async () => [...priceMap.keys()],
            extractProductPrice: async (url) => priceMap.get(url) || null,
        },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.minPrice, 9000000);
    assert.equal(result.gapValue, null);
    assert.equal(result.gapPercent, null);
});

test('startBackgroundPricingJob does not skip rows with missing costPrice', async () => {
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
                    { rowNumber: 3, productId: 'A', brand: 'Bosch', model: 'WQB245B40', costPrice: '', salePrice: '25,000,000', marketPrices: [] },
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
                    gapValue: null,
                    gapPercent: null,
                    suggestedPrice: null,
                    status: 'insufficient_prices',
                };
            },
            writeSheetUpdates: async ({ updates }) => {
                capturedUpdates = updates;
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
    assert.equal(capturedUpdates[0].gapValue, null);
    assert.equal(capturedUpdates[0].gapPercent, null);
});

test('isLikelyProductDetailUrl rejects unrelated blog or news pages when model is provided', () => {
    const model = 'WQB245B40';
    const brand = 'Bosch';
    // Contain model -> true
    assert.equal(isLikelyProductDetailUrl('https://example.com/p/bosch-wqb245b40', model, brand), true);
    // Contain model digits (>=4) -> true
    assert.equal(isLikelyProductDetailUrl('https://example.com/sp/may-say-24540-chinh-hang.html', model, brand), true);
    // Contain brand and product keyword -> true
    assert.equal(isLikelyProductDetailUrl('https://example.com/products/bosch-dryer-new', model, brand), true);
    // Contain model token of length >=3 -> true
    assert.equal(isLikelyProductDetailUrl('https://example.com/say-kho-wqb-say-quan-ao.html', model, brand), true);
    
    // Completely unrelated blog post -> false (even if it has hyphens/html extension)
    assert.equal(isLikelyProductDetailUrl('https://vietnamnet.vn/tin-tuc-trong-ngay-12345.html', model, brand), false);
    assert.equal(isLikelyProductDetailUrl('https://example.com/chinh-sach-bao-hanh-san-pham.html', model, brand), false);
});

test('searchProductLinks skips subsequent pagination pages but always queries all search engines', async () => {
    const { searchProductLinks } = require('../lib/sheet-pricing-service.js');
    const urlsRequested = [];
    const mockFetch = async (url) => {
        urlsRequested.push(url);
        if (url.includes('google.com')) {
            return {
                ok: true,
                text: async () => {
                    // Generate 12 links containing the model
                    let linksHtml = '';
                    for (let i = 1; i <= 12; i++) {
                        linksHtml += `<a href="/url?q=https://shop.vn/kocher-di-332pro-p${i}.html">Link ${i}</a>\n`;
                    }
                    return `<html><body>${linksHtml}</body></html>`;
                }
            };
        }
        if (url.includes('bing.com')) {
            return {
                ok: true,
                text: async () => {
                    // Generate 3 links on Bing page 1
                    let linksHtml = '';
                    for (let i = 1; i <= 3; i++) {
                        linksHtml += `<cite>https://shop-bing.vn/kocher-di-332pro-p${i}.html</cite>\n`;
                    }
                    return `<html><body>${linksHtml}</body></html>`;
                }
            };
        }
        return { ok: true, text: async () => '' };
    };

    const links = await searchProductLinks({
        brand: 'Kocher',
        model: 'DI-332Pro',
        limit: 5,
        fetchImpl: mockFetch
    });

    // Google page 1 (start=0) should be requested
    assert.ok(urlsRequested.some(u => u.includes('google.com') && u.includes('start=0')));
    // Google page 2 (start=40) should NOT be requested (early exit within pagination)
    assert.ok(!urlsRequested.some(u => u.includes('google.com') && u.includes('start=40')));
    
    // Bing page 1 (first=1) should still be requested
    assert.ok(urlsRequested.some(u => u.includes('bing.com') && u.includes('first=1')));
    // Bing page 2 (first=51) should NOT be requested (early exit within pagination)
    assert.ok(!urlsRequested.some(u => u.includes('bing.com') && u.includes('first=51')));

    // DDG and CocCoc should still be requested (always queries all engines)
    assert.ok(urlsRequested.some(u => u.includes('duckduckgo.com')));
    assert.ok(urlsRequested.some(u => u.includes('coccoc.com')));

    assert.ok(links.length >= 15);
});

test('processPricingRow crawls up to 20 links and keeps the top 10 lowest prices', async () => {
    // Generate 25 mock links
    const links = [];
    const priceMap = new Map();
    for (let i = 1; i <= 25; i++) {
        const url = `https://shop-test-${i}.vn/bep-tu-kocher-di-332pro`;
        links.push(url);
        // Let price for shop i be: 10000000 + i * 100000
        // E.g., shop 1 has 10.1M, shop 2 has 10.2M, ..., shop 25 has 12.5M
        priceMap.set(url, 10000000 + i * 100000);
    }

    const result = await processPricingRow({
        row: {
            rowNumber: 15,
            productId: 'TEST-20',
            brand: 'Kocher',
            model: 'DI-332Pro',
            costPrice: '8,000,000',
            salePrice: '12,000,000',
        },
        deps: {
            searchProductLinks: async () => links,
            extractProductPrice: async (url) => priceMap.get(url) || null,
        }
    });

    // It should have crawled the first 20 links (slice 0, 20)
    assert.equal(result.totalLinksCount, 20);
    
    // It should extract top 10 lowest prices
    assert.equal(result.marketPrices.length, 10);
    
    // The lowest 10 prices should be: 10.1M, 10.2M, ..., 11.0M
    for (let i = 0; i < 10; i++) {
        assert.equal(result.marketPrices[i], 10000000 + (i + 1) * 100000);
    }
});




