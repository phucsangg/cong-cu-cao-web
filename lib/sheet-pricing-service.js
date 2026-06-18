const {
    parseVietnamesePrice,
    normalizeModelText,
    computeSuggestedPricing,
    mapSheetHeaders,
    buildSheetUpdateRow,
} = require('./sheet-pricing-utils.js');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

let cheerioModule = null;
let scraperCoreModule = null;

function getCheerio() {
    if (!cheerioModule) {
        cheerioModule = require('cheerio');
    }
    return cheerioModule;
}

function getScraperCore() {
    if (!scraperCoreModule) {
        scraperCoreModule = require('./scraper-core.js');
    }
    return scraperCoreModule;
}

function extractSheetId(sheetUrl = '') {
    const match = String(sheetUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
        throw new Error('Khong doc duoc Sheet ID tu Google Sheet URL.');
    }
    return match[1];
}

function isLikelyProductDetailUrl(url = '') {
    const normalized = String(url).toLowerCase();
    if (!normalized.startsWith('http')) return false;

    // Do not crawl search engine pages or Google help docs
    if (normalized.includes('google.com') || normalized.includes('google.com.vn') || normalized.includes('duckduckgo.com') || normalized.includes('bing.com')) {
        return false;
    }

    const blockedTerms = [
        '/search',
        '/collections',
        '/collection',
        '/category',
        '/categories',
        '/danh-muc',
        '/tag/',
        '/tags/',
        '/blogs/',
        '/blog/',
        '/tin-tuc',
        '/news/',
        '?q=',
        '&q=',
    ];

    if (blockedTerms.some((term) => normalized.includes(term))) {
        return false;
    }

    try {
        const parsed = new URL(url);
        const pathSegments = parsed.pathname.split('/').filter(Boolean);
        if (pathSegments.length === 0) return false;

        const lastSegment = pathSegments[pathSegments.length - 1];

        // Detail page paths typically contain at least one hyphen (-)
        const hasHyphens = lastSegment.includes('-');
        const hasProductKeyword = /\/(product|products|p|san-pham)\//.test(normalized);
        const hasHtmlExtension = /\.html?(?:$|[?#])/.test(normalized);

        return hasProductKeyword || hasHtmlExtension || hasHyphens;
    } catch {
        return false;
    }
}

function normalizeSearchHref(href) {
    if (!href) return null;

    if (href.startsWith('/url?')) {
        try {
            const parsed = new URL(`https://www.google.com${href}`);
            return parsed.searchParams.get('q');
        } catch {
            return null;
        }
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
        return href;
    }

    return null;
}

async function fetchHtml(url, { timeout = 15000, fetchImpl = fetch } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'user-agent': DEFAULT_USER_AGENT,
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                'cache-control': 'max-age=0',
                'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="137", "Google Chrome";v="137"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1'
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

async function searchProductLinks({ brand, model, limit = 20, fetchImpl = fetch }) {
    const query = encodeURIComponent(`${brand} ${model}`);
    let links = [];
    const seen = new Set();

    // 1. Try Google Search first
    try {
        const html = await fetchHtml(`https://www.google.com/search?hl=vi&num=${Math.max(limit, 20)}&q=${query}`, {
            fetchImpl,
            timeout: 12000,
        });

        const cheerio = getCheerio();
        const $ = cheerio.load(html);

        $('a[href]').each((_, element) => {
            const href = $(element).attr('href');
            const normalizedUrl = normalizeSearchHref(href);
            if (!normalizedUrl || seen.has(normalizedUrl)) return;
            if (!/^https?:\/\//i.test(normalizedUrl)) return;

            seen.add(normalizedUrl);
            links.push(normalizedUrl);
        });
    } catch (err) {
        // Fallback silently to other engines
    }

    // 2. Fall back to DuckDuckGo HTML Search if Google Search returned less than 3 links (due to CAPTCHA blocking)
    if (links.length < 3) {
        try {
            const ddgUrl = `https://html.duckduckgo.com/html/?q=${query}`;
            const html = await fetchHtml(ddgUrl, { fetchImpl, timeout: 10000 });
            const cheerio = getCheerio();
            const $ = cheerio.load(html);

            $('.result__url').each((_, element) => {
                let href = $(element).text().trim();
                if (href) {
                    if (!href.startsWith('http')) {
                        href = 'https://' + href;
                    }
                    if (!seen.has(href)) {
                        seen.add(href);
                        links.push(href);
                    }
                }
            });

            $('.result__a').each((_, element) => {
                let href = $(element).attr('href');
                if (href) {
                    if (href.includes('uddg=')) {
                        try {
                            const parsed = new URL(`https://duckduckgo.com${href}`);
                            const realUrl = parsed.searchParams.get('uddg');
                            if (realUrl && !seen.has(realUrl)) {
                                seen.add(realUrl);
                                links.push(realUrl);
                            }
                        } catch {}
                    } else if (href.startsWith('http') && !href.includes('duckduckgo.com')) {
                        if (!seen.has(href)) {
                            seen.add(href);
                            links.push(href);
                        }
                    }
                }
            });
        } catch (err) {
            // Fallback silently to Bing
        }
    }

    // 3. Fall back to Bing Search if still less than 3 links
    if (links.length < 3) {
        try {
            const bingUrl = `https://www.bing.com/search?q=${query}`;
            const html = await fetchHtml(bingUrl, { fetchImpl, timeout: 10000 });
            const cheerio = getCheerio();
            const $ = cheerio.load(html);

            $('cite').each((_, element) => {
                let href = $(element).text().trim();
                if (href) {
                    href = href.split(' ')[0].trim();
                    if (!href.startsWith('http')) {
                        href = 'https://' + href;
                    }
                    if (!seen.has(href)) {
                        seen.add(href);
                        links.push(href);
                    }
                }
            });

            $('#b_results .b_algo h2 a').each((_, element) => {
                const href = $(element).attr('href');
                if (href && href.startsWith('http') && !seen.has(href)) {
                    seen.add(href);
                    links.push(href);
                }
            });
        } catch (err) {
            // No more fallback engines
        }
    }

    return links.slice(0, limit * 2);
}

function collectPriceCandidates($) {
    const candidates = new Set();
    const looksLikePriceText = (text) => {
        const value = String(text || '').trim().toLowerCase();
        if (!value) return false;
        if (/(hotline|tel|phone|zalo)/i.test(value)) return false;
        if (/[₫đ]|vnd|vnđ/.test(value)) return true;
        // Support spaces, dots, or commas as thousands separators
        return /\b\d{1,3}(?:[.,\s]\d{3}){1,}\b/.test(value);
    };

    const selectorList = [
        '[itemprop="price"]',
        'meta[property="product:price:amount"]',
        'meta[property="og:price:amount"]',
        '.price',
        '.product-price',
        '.special-price',
        '.sale-price',
        '[class*="price"]',
        '[id*="price"]',
    ];

    selectorList.forEach((selector) => {
        $(selector).each((_, element) => {
            const value = $(element).attr('content') || $(element).attr('value') || $(element).text();
            if (!looksLikePriceText(value) && !$(element).attr('content')) return;
            const parsed = parseVietnamesePrice(value);
            // Ignore accessories, parts, or wrong parses below 1,000,000 VND and above 200,000,000 VND
            if (parsed && parsed >= 1000000 && parsed <= 200000000) {
                candidates.add(parsed);
            }
        });
    });

    $('body *').each((_, element) => {
        const text = $(element).text();
        // Strict check: must contain currency indicator to avoid phone numbers or spec matches
        if (!/[₫đ]|vnd|vnđ|đồng/i.test(text)) return;
        if (!looksLikePriceText(text)) return;
        const parsed = parseVietnamesePrice(text);
        if (parsed && parsed >= 1000000 && parsed <= 200000000) {
            candidates.add(parsed);
        }
    });

    return Array.from(candidates).sort((a, b) => a - b);
}

function pickPriceFromScrapedProducts(products, model) {
    const normalizedModel = normalizeModelText(model);
    if (!normalizedModel) return null;

    const enriched = (products || [])
        .map((product) => ({
            product,
            normalizedTitle: normalizeModelText(product.ten || ''),
            parsedPrice: parseVietnamesePrice(product.gia),
        }))
        .filter((entry) => entry.parsedPrice && entry.parsedPrice >= 1000000 && entry.parsedPrice <= 200000000);

    const exactMatch = enriched.find((entry) => entry.normalizedTitle.includes(normalizedModel));
    if (exactMatch) return exactMatch.parsedPrice;

    return enriched.length > 0 ? enriched.sort((a, b) => a.parsedPrice - b.parsedPrice)[0].parsedPrice : null;
}

async function extractProductPrice({ url, model, fetchImpl = fetch }) {
    const html = await fetchHtml(url, { fetchImpl, timeout: 15000 });
    const cheerio = getCheerio();
    const $ = cheerio.load(html);

    const directCandidates = collectPriceCandidates($);
    const title = $('h1').first().text() || $('title').first().text() || '';
    const normalizedModel = normalizeModelText(model);
    const normalizedTitle = normalizeModelText(title);

    if (normalizedModel && normalizedTitle && !normalizedTitle.includes(normalizedModel)) {
        const slug = normalizeModelText(url);
        if (!slug.includes(normalizedModel)) {
            return null;
        }
    }

    if (directCandidates.length > 0) {
        return directCandidates[0];
    }

    const scraped = getScraperCore().runCheerioScrape(html, url, 1, () => {});
    return pickPriceFromScrapedProducts(scraped, model);
}

function isValidBrand(brand) {
    if (!brand) return false;
    return !!String(brand).trim();
}

function isValidModel(model) {
    if (!model) return false;
    const trimmed = String(model).trim();
    if (!trimmed) return false;
    // Bỏ qua nếu model chỉ chứa các ký số (là số thuần túy)
    return !/^\d+$/.test(trimmed);
}

async function processPricingRow({ row, deps = {} }) {
    const searchFn = deps.searchProductLinks || searchProductLinks;
    const extractPriceFn = deps.extractProductPrice || ((url) => extractProductPrice({ url, model: row.model }));
    const linksConcurrency = Math.max(1, Number.parseInt(deps.linksConcurrency, 10) || 4);

    if (!row || !isValidBrand(row.brand) || !isValidModel(row.model)) {
        return {
            rowNumber: row?.rowNumber,
            status: 'skipped',
            marketPrices: [],
            matchedUrls: [],
            minPrice: null,
            gapValue: null,
            gapPercent: null,
            suggestedPrice: null,
        };
    }

    const discoveredLinks = await searchFn({
        brand: row.brand,
        model: row.model,
        limit: 20,
    });

    const filteredLinks = Array.from(new Set(discoveredLinks.filter(isLikelyProductDetailUrl))).slice(0, 20);
    const matchedUrls = [];
    const prices = [];
    let cursor = 0;

    async function worker() {
        while (cursor < filteredLinks.length) {
            const currentIndex = cursor;
            cursor += 1;
            const url = filteredLinks[currentIndex];

            try {
                const price = await extractPriceFn(url, row);
                if (price && price >= 1000000 && price <= 200000000) {
                    matchedUrls.push(url);
                    prices.push(price);
                }
            } catch {
                // Skip failed URLs so one bad site does not break the row.
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(linksConcurrency, filteredLinks.length || 1) }, () => worker()));

    const hasNewPrices = prices.length > 0;
    const finalPrices = hasNewPrices ? prices : (row.marketPrices || []);

    const pricing = computeSuggestedPricing({
        currentSalePrice: row.salePrice,
        prices: finalPrices,
    });

    return {
        rowNumber: row.rowNumber,
        productId: row.productId || '',
        brand: row.brand,
        model: row.model,
        matchedUrls,
        totalLinksCount: filteredLinks.length,
        marketPrices: pricing.marketPrices,
        hasNewPrices,
        minPrice: pricing.minPrice,
        gapValue: pricing.gapValue,
        gapPercent: pricing.gapPercent,
        suggestedPrice: pricing.suggestedPrice,
        outlierRemoved: pricing.outlierRemoved,
        status: pricing.suggestedPrice ? 'success' : 'insufficient_prices',
    };
}

async function callAppsScript({ appsScriptUrl, method = 'GET', payload = null, params = null, fetchImpl = fetch }) {
    if (!appsScriptUrl) {
        throw new Error('Thieu Apps Script URL.');
    }

    const target = new URL(appsScriptUrl);
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                target.searchParams.set(key, String(value));
            }
        });
    }

    const response = await fetchImpl(target.toString(), {
        method,
        headers: {
            'content-type': 'application/json',
        },
        body: payload ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
        throw new Error(`Apps Script loi HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data && data.ok === false) {
        throw new Error(data.error || 'Apps Script tra ve loi.');
    }

    return data;
}

async function readSheetRows({ appsScriptUrl, sheetUrl, sheetName, startRow, endRow, fetchImpl = fetch }) {
    const sheetId = extractSheetId(sheetUrl);
    const data = await callAppsScript({
        appsScriptUrl,
        method: 'GET',
        params: {
            action: 'readRows',
            sheetId,
            sheetName,
            startRow,
            endRow,
        },
        fetchImpl,
    });

    const headers = data.headers || [];
    const mapping = mapSheetHeaders(headers);

    const rows = (data.rows || []).map((row) => {
        const marketPrices = [];
        mapping.marketColumns.forEach((colIdx) => {
            const val = row.values?.[colIdx];
            const parsed = parseVietnamesePrice(val);
            if (parsed !== null && parsed > 0) {
                marketPrices.push(parsed);
            }
        });

        return {
            rowNumber: row.rowNumber,
            productId: row.values?.[mapping.productId] || '',
            brand: row.values?.[mapping.brand] || '',
            model: row.values?.[mapping.model] || '',
            costPrice: row.values?.[mapping.costPrice] || '',
            salePrice: row.values?.[mapping.salePrice] || '',
            marketPrices,
        };
    });

    return { sheetId, headers, mapping, rows };
}

async function writeSheetUpdates({ appsScriptUrl, sheetUrl, sheetName, updates, fetchImpl = fetch }) {
    const sheetId = extractSheetId(sheetUrl);
    return callAppsScript({
        appsScriptUrl,
        method: 'POST',
        payload: {
            action: 'writePricing',
            sheetId,
            sheetName,
            updates: updates.map((update) => ({
                rowNumber: update.rowNumber,
                marketPrices: update.hasNewPrices !== false ? (update.marketPrices || []) : [],
                minPrice: update.minPrice,
                gapValue: update.gapValue,
                gapPercent: update.gapPercent,
                suggestedPrice: update.suggestedPrice,
                status: update.status,
            })),
        },
        fetchImpl,
    });
}

const jobs = new Map();

function getBackgroundPricingJobStatus(jobId) {
    const job = jobs.get(jobId);
    if (!job) return null;
    return {
        id: job.id,
        status: job.status,
        totalRows: job.totalRows,
        processedCount: job.processedCount,
        successCount: job.successCount,
        errorCount: job.errorCount,
        writeCount: job.writeCount,
        logs: job.logs,
        rows: job.rows,
        lastResult: job.lastResult,
    };
}

function stopBackgroundPricingJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return false;
    job.stopRequested = true;
    return true;
}

function startBackgroundPricingJob({
    appsScriptUrl,
    sheetUrl,
    sheetName,
    startRow,
    endRow,
    rowsConcurrency,
    linksConcurrency,
    batchSize,
}) {
    const jobId = `job_${Date.now()}`;
    const job = {
        id: jobId,
        status: 'running',
        sheetUrl,
        sheetName,
        startRow: Math.max(3, parseInt(startRow, 10) || 3),
        endRow: endRow ? parseInt(endRow, 10) : null,
        rowsConcurrency: Math.max(1, parseInt(rowsConcurrency, 10) || 1),
        linksConcurrency: Math.max(1, parseInt(linksConcurrency, 10) || 5),
        batchSize: Math.max(1, parseInt(batchSize, 10) || 5),
        totalRows: 0,
        processedCount: 0,
        successCount: 0,
        errorCount: 0,
        writeCount: 0,
        logs: [],
        rows: [],
        stopRequested: false,
        lastResult: null,
    };

    jobs.set(jobId, job);

    // Run async background worker
    (async () => {
        const log = (message, level = 'info') => {
            const timestamp = new Date().toLocaleTimeString('vi-VN');
            job.logs.push({ timestamp, message, level });
            console.log(`[${jobId}] [${level.toUpperCase()}] ${message}`);
        };

        log(`Bắt đầu đọc dữ liệu từ sheet "${sheetName}"...`);
        try {
            const { sheetId, headers, mapping, rows } = await readSheetRows({
                appsScriptUrl,
                sheetUrl,
                sheetName,
                startRow: job.startRow,
                endRow: job.endRow || undefined,
            });

            // Initialize results structure
            job.rows = rows.map((row) => ({
                rowNumber: row.rowNumber,
                productId: row.productId || '',
                brand: row.brand,
                model: row.model,
                salePriceValue: parseInt(String(row.salePrice || '').replace(/\D/g, ''), 10) || null,
                status: isValidBrand(row.brand) && isValidModel(row.model) ? 'pending' : 'skipped',
                marketPrices: row.marketPrices || [],
                minPrice: null,
                gapValue: null,
                gapPercent: null,
                suggestedPrice: null,
                writtenToSheet: false,
                errorMessage: '',
            }));

            const runnableRows = rows.filter((row) => isValidBrand(row.brand) && isValidModel(row.model));
            job.totalRows = job.rows.length;
            
            const skippedRowsCount = job.rows.filter(r => r.status === 'skipped').length;
            job.processedCount += skippedRowsCount;

            if (skippedRowsCount > 0) {
                log(`Bỏ qua ${skippedRowsCount} dòng do thiếu Thương hiệu, Model hoặc Model chỉ toàn số.`);
            }

            log(`Đã đọc ${job.rows.length} dòng. Có ${runnableRows.length} dòng hợp lệ để xử lý.`);
            
            if (runnableRows.length === 0) {
                job.status = 'completed';
                log(`Không có dòng nào đủ điều kiện xử lý.`);
                return;
            }

            let cursor = 0;
            const pendingUpdates = [];
            let isWriting = false;

            const flushUpdates = async (force = false) => {
                if (pendingUpdates.length === 0) return;
                if (!force && pendingUpdates.length < job.batchSize) return;

                // Lock to ensure sequential writing
                while (isWriting) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                isWriting = true;
                const batch = pendingUpdates.splice(0, force ? pendingUpdates.length : job.batchSize);
                
                try {
                    log(`Đang ghi ${batch.length} dòng kết quả về Google Sheet...`);
                    await writeSheetUpdates({
                        appsScriptUrl,
                        sheetUrl,
                        sheetName,
                        updates: batch,
                    });
                    
                    // Mark as written
                    batch.forEach((update) => {
                        const target = job.rows.find((r) => r.rowNumber === update.rowNumber);
                        if (target) {
                            target.writtenToSheet = true;
                        }
                    });
                    
                    job.writeCount += 1;
                    log(`Đã ghi thành công ${batch.length} dòng kết quả về Google Sheet.`, 'success');
                } catch (writeErr) {
                    log(`Ghi kết quả thất bại: ${writeErr.message}`, 'error');
                } finally {
                    isWriting = false;
                }
            };

            const worker = async () => {
                while (!job.stopRequested) {
                    const idx = cursor;
                    cursor += 1;
                    if (idx >= runnableRows.length) break;

                    const row = runnableRows[idx];
                    
                    const activeItem = job.rows.find(r => r.rowNumber === row.rowNumber);
                    if (activeItem) {
                        activeItem.status = 'processing';
                    }

                    try {
                        log(`Đang xử lý dòng ${row.rowNumber}: ${row.brand} ${row.model}...`);
                        const result = await processPricingRow({
                            row,
                            deps: {
                                linksConcurrency: job.linksConcurrency,
                            },
                        });

                        if (activeItem) {
                            Object.assign(activeItem, {
                                status: result.status,
                                marketPrices: result.marketPrices,
                                minPrice: result.minPrice,
                                gapValue: result.gapValue,
                                gapPercent: result.gapPercent,
                                suggestedPrice: result.suggestedPrice,
                                matchedUrls: result.matchedUrls,
                            });
                        }

                        job.lastResult = result;
                        job.processedCount += 1;
                        if (result.status === 'success') {
                            job.successCount += 1;
                            log(`Dòng ${row.rowNumber} (${row.brand} ${row.model}) thành công: Tìm thấy ${result.totalLinksCount} cửa hàng, quét được ${result.marketPrices.length} giá. Min=${result.minPrice.toLocaleString('vi-VN')} đ, Đề xuất=${result.suggestedPrice ? result.suggestedPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'success');
                        } else {
                            job.errorCount += 1;
                            log(`Dòng ${row.rowNumber} (${row.brand} ${row.model}) thành công (thiếu giá hoặc ít hơn 3 giá): Tìm thấy ${result.totalLinksCount} cửa hàng, quét được ${result.marketPrices.length} giá. Min=${result.minPrice ? result.minPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'warning');
                        }

                        pendingUpdates.push(result);
                        await flushUpdates(false);
                    } catch (err) {
                        job.processedCount += 1;
                        job.errorCount += 1;
                        if (activeItem) {
                            activeItem.status = 'error';
                            activeItem.errorMessage = err.message;
                        }
                        log(`Lỗi xử lý dòng ${row.rowNumber} (${row.brand} ${row.model}): ${err.message}`, 'error');
                    }
                }
            };

            const workersCount = Math.min(job.rowsConcurrency, runnableRows.length);
            await Promise.all(Array.from({ length: workersCount }, () => worker()));

            // Final flush
            await flushUpdates(true);

            if (job.stopRequested) {
                job.status = 'stopped';
                log(`Job đã dừng theo yêu cầu người dùng.`);
            } else {
                job.status = 'completed';
                log(`Đã hoàn thành job pricing. Thành công: ${job.successCount}, Lỗi/Thiếu giá: ${job.errorCount}.`, 'success');
            }
        } catch (error) {
            job.status = 'error';
            log(`Lỗi cấu hình hoặc runtime của Job: ${error.message}`, 'error');
        }
    })();

    return jobId;
}

module.exports = {
    extractSheetId,
    isLikelyProductDetailUrl,
    searchProductLinks,
    extractProductPrice,
    processPricingRow,
    readSheetRows,
    writeSheetUpdates,
    startBackgroundPricingJob,
    getBackgroundPricingJobStatus,
    stopBackgroundPricingJob,
};
