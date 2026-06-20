const {
    parseVietnamesePrice,
    normalizeModelText,
    computeSuggestedPricing,
    mapSheetHeaders,
    buildSheetUpdateRow,
    normalizeVietnameseText,
    splitModelToken,
    matchesPrefix,
    getFullPrefix,
    hasConflictingModelPrefix,
    hasConflictingModelSuffix,
    isModelMatch,
    getCategoryKeyword,
    getNormalizedModelVariants,
    generateKeywords,
    calculateRelevanceScore,
} = require('./sheet-pricing-utils.js');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const DESKTOP_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
];

const OPERA_MINI_USER_AGENTS = [
    'Opera/9.80 (Android; Opera Mini/36.1.2254/191.293; U; en) Presto/2.12.423 Version/12.16',
    'Opera/9.80 (Android; Opera Mini/19.0.2254/191.293; U; vi) Presto/2.12.423 Version/12.16',
    'Opera/9.80 (iPhone; Opera Mini/8.0.0/191.293; U; en) Presto/2.12.423 Version/12.16',
    'Opera/9.80 (BlackBerry; Opera Mini/8.0.0/191.293; U; en) Presto/2.12.423 Version/12.16',
];

const DEFAULT_USER_AGENT = DESKTOP_USER_AGENTS[0];

function getRandomDesktopUserAgent() {
    return DESKTOP_USER_AGENTS[Math.floor(Math.random() * DESKTOP_USER_AGENTS.length)];
}

function getRandomOperaMiniUserAgent() {
    return OPERA_MINI_USER_AGENTS[Math.floor(Math.random() * OPERA_MINI_USER_AGENTS.length)];
}

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

function decodeHtmlEntities(text = '') {
    return String(text)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function normalizeSelectedSheetNames(sheetName) {
    const rawItems = Array.isArray(sheetName)
        ? sheetName
        : String(sheetName || '').split(',');

    return Array.from(
        new Set(
            rawItems
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        )
    );
}

function extractSheetNamesFromSpreadsheetHtml(html = '') {
    const names = [];
    const seen = new Set();

    const addName = (value) => {
        const name = decodeHtmlEntities(String(value || '').trim());
        if (!name || seen.has(name)) return;
        seen.add(name);
        names.push(name);
    };

    const captionMatches = html.matchAll(/docs-sheet-tab-caption">([^<]+)</g);
    for (const match of captionMatches) {
        addName(match[1]);
    }

    if (names.length === 0) {
        const jsonMatches = html.matchAll(/\[0,0,"([^"]+)"\]/g);
        for (const match of jsonMatches) {
            addName(match[1]);
        }
    }

    return names;
}

function extractSheetId(sheetUrl = '') {
    const match = String(sheetUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
        throw new Error('Khong doc duoc Sheet ID tu Google Sheet URL.');
    }
    return match[1];
}

function cleanNumericCode(val) {
    let s = String(val || '').trim();
    if (s.endsWith('.0')) {
        s = s.slice(0, -2);
    }
    return s;
}

function scoreProductUrl(url = '', model = '', brand = '') {
    return calculateRelevanceScore(url, model, brand);
}

function isLikelyProductDetailUrl(url = '', model = '', brand = '') {
    const normalized = String(url).toLowerCase();
    if (!normalized.startsWith('http')) return false;

    // Do not crawl search engine pages, Google help docs, or excluded domains (like bepngocbao.vn)
    if (
        normalized.includes('google.com') ||
        normalized.includes('google.com.vn') ||
        normalized.includes('duckduckgo.com') ||
        normalized.includes('bing.com') ||
        normalized.includes('coccoc.com') ||
        normalized.includes('bepngocbao.vn')
    ) {
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
        '/gioi-thieu',
        '/about',
        '/lien-he',
        '/contact',
        '/huong-dan',
        '/chinh-sach',
        '/tuyen-dung',
        '/tuyen_dung',
        '/gio-hang',
        '/cart',
        '/checkout',
        '/payment',
        '/agency',
        '/dai-ly',
        '/he-thong-cua-hang',
        '/store-locator',
        '/tin-khuyen-mai',
        '/khuyen-mai',
        '/khuyen_mai',
        '/uu-dai',
        '/dieu-khoan',
        '/terms-of-use',
        '/privacy-policy',
        '/policy/',
        '/chinh-sach-',
    ];

    if (blockedTerms.some((term) => normalized.includes(term))) {
        return false;
    }

    // High confidence if model is in the URL
    if (model) {
        if (hasConflictingModelSuffix(url, model)) {
            return false;
        }

        const normModel = normalizeModelText(model);
        const normUrl = normalizeModelText(url);
        if (normModel && normUrl.includes(normModel)) {
            return true;
        }
        
        // Also check if model digits are in the URL
        const modelDigits = normModel.replace(/\D/g, '');
        if (modelDigits.length >= 4 && normUrl.includes(modelDigits)) {
            return true;
        }

        // Brand-aware URL matching (lenient check)
        if (brand) {
            const normBrand = normalizeModelText(brand);
            if (normBrand && normUrl.includes(normBrand)) {
                if (modelDigits.length >= 3) {
                    const prefixLength = Math.min(4, modelDigits.length);
                    const modelPrefix = modelDigits.slice(0, prefixLength);
                    if (normUrl.includes(modelPrefix)) {
                        return true;
                    }
                }
                
                const hasProductKeyword = /\/(product|products|p|sp|san-pham|ct|chi-tiet|detail|item|shop|store)\//.test(normalized);
                if (hasProductKeyword) {
                    return true;
                }
            }
        }

        // Also check if any model token of length >= 3 is in the URL, along with product keyword/html/hyphen
        const tokens = (model.match(/[a-zA-Z]+|\d+/g) || []).filter(t => t.length >= 3);
        const hasTokenMatch = tokens.some(t => normUrl.includes(normalizeModelText(t)));
        if (hasTokenMatch) {
            try {
                const parsed = new URL(url);
                const pathSegments = parsed.pathname.split('/').filter(Boolean);
                if (pathSegments.length > 0) {
                    const lastSegment = pathSegments[pathSegments.length - 1];
                    const hasHyphens = lastSegment.includes('-');
                    const hasProductKeyword = /\/(product|products|p|sp|san-pham|ct|chi-tiet|detail|item|shop|store)\//.test(normalized);
                    const hasHtmlExtension = /\.html?(?:$|[?#])/.test(normalized);
                    if (hasProductKeyword || hasHtmlExtension || hasHyphens) {
                        return true;
                    }
                }
            } catch {}
        }

        // If a model is provided and none of the checks pass, it's not a likely URL for this product
        return false;
    }

    try {
        const parsed = new URL(url);
        const pathSegments = parsed.pathname.split('/').filter(Boolean);
        if (pathSegments.length === 0) return false;

        const lastSegment = pathSegments[pathSegments.length - 1];

        // Detail page paths typically contain at least one hyphen (-)
        const hasHyphens = lastSegment.includes('-');
        const hasProductKeyword = /\/(product|products|p|sp|san-pham|ct|chi-tiet|detail|item|shop|store)\//.test(normalized);
        const hasHtmlExtension = /\.html?(?:$|[?#])/.test(normalized);

        return hasProductKeyword || hasHtmlExtension || hasHyphens;
    } catch {
        return false;
    }
}

function decodeBingRedirect(bingUrl) {
    try {
        const urlObj = new URL(bingUrl);
        if (urlObj.hostname.includes('bing.com') && urlObj.pathname === '/ck/a') {
            const u = urlObj.searchParams.get('u');
            if (u) {
                let base64Part = u;
                if (u.startsWith('a1')) {
                    base64Part = u.substring(2);
                } else if (u.startsWith('a')) {
                    base64Part = u.substring(1);
                }
                const padding = (4 - (base64Part.length % 4)) % 4;
                const paddedBase64 = base64Part + '='.repeat(padding);
                const normalizedBase64 = paddedBase64.replace(/-/g, '+').replace(/_/g, '/');
                const decoded = Buffer.from(normalizedBase64, 'base64').toString('utf-8');
                if (decoded.startsWith('http')) {
                    return decoded;
                }
            }
        }
    } catch {
        // Fall back to original URL
    }
    return bingUrl;
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
        if (href.includes('bing.com/ck/a')) {
            return decodeBingRedirect(href);
        }
        return href;
    }

    return null;
}

class RequestQueue {
    constructor(maxConcurrency = 5) {
        this.maxConcurrency = maxConcurrency;
        this.running = 0;
        this.queue = [];
    }

    async add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.next();
        });
    }

    next() {
        while (this.running < this.maxConcurrency && this.queue.length > 0) {
            const { fn, resolve, reject } = this.queue.shift();
            this.running++;
            fn()
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    this.running--;
                    this.next();
                });
        }
    }
}

const fetchQueue = new RequestQueue(5);

async function fetchHtml(url, { timeout = 15000, fetchImpl = fetch, userAgent = DEFAULT_USER_AGENT } = {}) {
    return fetchQueue.add(() => fetchHtmlWithRetry(url, { timeout, fetchImpl, userAgent }, 2));
}

let totalRequestsMade = 0;
let totalCacheHits = 0;

async function fetchHtmlWithRetry(url, options, retriesLeft) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 15000);

    try {
        totalRequestsMade++;
        const response = await options.fetchImpl(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'user-agent': options.userAgent,
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
    } catch (err) {
        if (retriesLeft > 0) {
            await new Promise((r) => setTimeout(r, 500));
            return fetchHtmlWithRetry(url, options, retriesLeft - 1);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// Local Cache System (Phần 11)
const fs = require('fs');
const path = require('path');

class CacheStore {
    constructor() {
        const tmpDir = process.env.TEMP || '/tmp';
        this.filePath = path.join(tmpDir, 'crawldata-cache.json');
        this.data = {
            keywords: {},
            html: {},
            prices: {},
            searchResults: {},
            urlMap: {},
            selectors: {},
        };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf8');
                const parsed = JSON.parse(raw);
                this.data = {
                    keywords: parsed.keywords || {},
                    html: parsed.html || {},
                    prices: parsed.prices || {},
                    searchResults: parsed.searchResults || {},
                    urlMap: parsed.urlMap || {},
                    selectors: parsed.selectors || {},
                };
            }
        } catch (e) {}
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data), 'utf8');
        } catch (e) {}
    }

    get(type, key, ttlHours) {
        const entry = this.data[type]?.[key];
        if (!entry) return null;
        const ageMs = Date.now() - entry.timestamp;
        if (ageMs > ttlHours * 60 * 60 * 1000) {
            delete this.data[type][key];
            this.save();
            return null;
        }
        totalCacheHits++;
        return entry.value;
    }

    set(type, key, value) {
        if (!this.data[type]) this.data[type] = {};
        this.data[type][key] = {
            value,
            timestamp: Date.now(),
        };
        this.save();
    }

    clear() {
        this.data = {
            keywords: {},
            html: {},
            prices: {},
            searchResults: {},
            urlMap: {},
            selectors: {},
        };
        this.save();
    }

    getSearchResult(model) {
        const entry = this.data.searchResults?.[model];
        if (!entry) return null;
        const ageMs = Date.now() - entry.timestamp;
        if (ageMs > 7 * 24 * 60 * 60 * 1000) { // 7 days TTL
            delete this.data.searchResults[model];
            this.save();
            return null;
        }
        totalCacheHits++;
        return entry.value;
    }

    setSearchResult(model, urls) {
        if (!this.data.searchResults) this.data.searchResults = {};
        this.data.searchResults[model] = {
            value: urls,
            timestamp: Date.now(),
        };
        this.save();
    }

    getUrlsForModel(model) {
        const entry = this.data.urlMap?.[model];
        if (!entry) return [];
        totalCacheHits++;
        return Object.values(entry).map(item => item.url);
    }

    setUrlForModelDomain(model, domain, url) {
        if (!this.data.urlMap) this.data.urlMap = {};
        if (!this.data.urlMap[model]) this.data.urlMap[model] = {};
        this.data.urlMap[model][domain] = {
            url,
            timestamp: Date.now(),
        };
        this.save();
    }

    getSelectorForDomain(domain) {
        const entry = this.data.selectors?.[domain];
        return entry ? entry.value : null;
    }

    setSelectorForDomain(domain, selector) {
        if (!this.data.selectors) this.data.selectors = {};
        this.data.selectors[domain] = {
            value: selector,
            timestamp: Date.now(),
        };
        this.save();
    }

    getHtml(url) {
        return this.get('html', url, 12);
    }

    setHtml(url, htmlContent) {
        this.set('html', url, htmlContent);
    }

    getPrice(url) {
        return this.get('prices', url, 12);
    }

    setPrice(url, price) {
        this.set('prices', url, price);
    }
}

const pricingCache = new CacheStore();

async function getCachedSearchLinks(engine, q, fetcherFn) {
    const cacheKey = `${engine}:${q}`;
    const cached = pricingCache.get('keywords', cacheKey, 24);
    if (cached) {
        return cached;
    }
    const urls = await fetcherFn(q);
    pricingCache.set('keywords', cacheKey, urls);
    return urls;
}

let activeSearchPromise = Promise.resolve();

async function searchProductLinks({ brand, model, limit = 20, fetchImpl = fetch, sheetName, sourceMap }) {
    const parentPromise = activeSearchPromise;
    let resolveLock;
    activeSearchPromise = new Promise((resolve) => {
        resolveLock = resolve;
    });

    try {
        await parentPromise;
    } catch {
        // Ignore errors in previous searches
    }

    try {
        const cachedResult = pricingCache.getSearchResult(model);
        if (cachedResult) {
            if (sourceMap) {
                cachedResult.forEach(url => sourceMap.set(url, 'Cache'));
            }
            return cachedResult;
        }

        const cleanBrand = String(brand || '').trim();
        const cleanModel = String(model || '').trim();
        const brandModel = cleanBrand ? `${cleanBrand} ${cleanModel}` : cleanModel;

        // Define progressive keywords (Phần 1)
        const step1Keywords = cleanBrand ? [
            brandModel,
            `${brandModel} giá`,
            `${brandModel} khuyến mãi`,
            `${brandModel} site:.vn`
        ] : [
            cleanModel,
            `${cleanModel} giá`,
            `${cleanModel} site:.vn`
        ];

        const step2Keywords = cleanBrand ? [
            cleanModel,
            `"${cleanModel}"`,
            `${cleanModel} giá`,
            `${cleanModel} site:.vn`
        ] : [];

        const allKws = generateKeywords(brand, model, sheetName);
        const step3Keywords = allKws.filter(k => !step1Keywords.includes(k) && !step2Keywords.includes(k));

        const steps = [step1Keywords, step2Keywords, step3Keywords].filter(s => s.length > 0);
        const engines = ['google', 'bing', 'ddg', 'coccoc'];

        const accumulatedLinks = [];
        const seen = new Set();

        const addLinks = (newLinks, engineName) => {
            newLinks.forEach((url) => {
                if (url && !seen.has(url)) {
                    seen.add(url);
                    accumulatedLinks.push(url);
                    if (sourceMap) {
                        sourceMap.set(url, engineName);
                    }
                }
            });
        };

        const hasEnoughUrls = () => {
            const count = accumulatedLinks.filter(url => isLikelyProductDetailUrl(url, model, brand)).length;
            return count >= 10;
        };

        outerLoop:
        for (const stepKws of steps) {
            for (const engine of engines) {
                for (const q of stepKws) {
                    if (hasEnoughUrls()) {
                        break outerLoop;
                    }

                    let engineLinks = [];
                    if (engine === 'google') {
                        engineLinks = await getCachedSearchLinks('google', q, async (queryVal) => {
                            const urls = [];
                            const googlePages = [0, 40, 80];
                            for (const start of googlePages) {
                                if (start > 0 && urls.filter(l => isLikelyProductDetailUrl(l, model, brand)).length >= 10) {
                                    break;
                                }
                                try {
                                    const html = await fetchHtml(`https://www.google.com/search?hl=vi&num=40&start=${start}&q=${encodeURIComponent(queryVal)}`, {
                                        fetchImpl,
                                        timeout: 4000,
                                        userAgent: getRandomOperaMiniUserAgent(),
                                    });
                                    const cheerio = getCheerio();
                                    const $ = cheerio.load(html);
                                    let count = 0;
                                    $('a[href]').each((_, element) => {
                                        const href = $(element).attr('href');
                                        const normalizedUrl = normalizeSearchHref(href);
                                        if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                                            urls.push(normalizedUrl);
                                            count++;
                                        }
                                    });
                                    if (count < 5) break;
                                    await new Promise((resolve) => setTimeout(resolve, 300));
                                } catch {
                                    break;
                                }
                            }
                            return urls;
                        });
                        addLinks(engineLinks, 'Google');
                    } else if (engine === 'bing') {
                        engineLinks = await getCachedSearchLinks('bing', q, async (queryVal) => {
                            const urls = [];
                            const bingPages = [1, 51];
                            for (const first of bingPages) {
                                if (first > 1 && urls.filter(l => isLikelyProductDetailUrl(l, model, brand)).length >= 10) {
                                    break;
                                }
                                try {
                                    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(queryVal)}&count=50&first=${first}`;
                                    const html = await fetchHtml(bingUrl, {
                                        fetchImpl,
                                        timeout: 4000,
                                        userAgent: getRandomDesktopUserAgent(),
                                    });
                                    const cheerio = getCheerio();
                                    const $ = cheerio.load(html);
                                    let count = 0;
                                    $('cite').each((_, element) => {
                                        let href = $(element).text().trim();
                                        if (href) {
                                            href = href.split(' ')[0].trim();
                                            if (!href.startsWith('http')) {
                                                href = 'https://' + href;
                                            }
                                            const normalizedUrl = normalizeSearchHref(href);
                                            if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                                                urls.push(normalizedUrl);
                                                count++;
                                            }
                                        }
                                    });
                                    $('#b_results .b_algo h2 a').each((_, element) => {
                                        const href = $(element).attr('href');
                                        const normalizedUrl = normalizeSearchHref(href);
                                        if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                                            urls.push(normalizedUrl);
                                            count++;
                                        }
                                    });
                                    if (count < 5) break;
                                    await new Promise((resolve) => setTimeout(resolve, 300));
                                } catch {
                                    break;
                                }
                            }
                            return urls;
                        });
                        addLinks(engineLinks, 'Bing');
                    } else if (engine === 'ddg') {
                        engineLinks = await getCachedSearchLinks('ddg', q, async (queryVal) => {
                            const urls = [];
                            try {
                                const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryVal)}`;
                                const html = await fetchHtml(ddgUrl, {
                                    fetchImpl,
                                    timeout: 4000,
                                    userAgent: getRandomDesktopUserAgent(),
                                });
                                const cheerio = getCheerio();
                                const $ = cheerio.load(html);
                                $('.result__url').each((_, element) => {
                                    let href = $(element).text().trim();
                                    if (href) {
                                        if (!href.startsWith('http')) {
                                            href = 'https://' + href;
                                        }
                                        const normalizedUrl = normalizeSearchHref(href);
                                        if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                                            urls.push(normalizedUrl);
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
                                                if (realUrl) urls.push(realUrl);
                                            } catch {}
                                        } else if (href.startsWith('http') && !href.includes('duckduckgo.com')) {
                                            urls.push(href);
                                        }
                                    }
                                });
                            } catch {}
                            return urls;
                        });
                        addLinks(engineLinks, 'DuckDuckGo');
                    } else if (engine === 'coccoc') {
                        engineLinks = await getCachedSearchLinks('coccoc', q, async (queryVal) => {
                            const urls = [];
                            try {
                                const coccocUrl = `https://coccoc.com/search?q=${encodeURIComponent(queryVal)}`;
                                const html = await fetchHtml(coccocUrl, {
                                    fetchImpl,
                                    timeout: 4000,
                                    userAgent: getRandomDesktopUserAgent(),
                                });
                                const cheerio = getCheerio();
                                const $ = cheerio.load(html);
                                $('a[href]').each((_, element) => {
                                    const href = $(element).attr('href');
                                    const normalizedUrl = normalizeSearchHref(href);
                                    if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                                        urls.push(normalizedUrl);
                                    }
                                });
                            } catch {}
                            return urls;
                        });
                        addLinks(engineLinks, 'CocCoc');
                    }
                }
            }
        }

        pricingCache.setSearchResult(model, accumulatedLinks);
        return accumulatedLinks;
    } finally {
        resolveLock();
    }
}

function isFakePrice(parsedPrice, model) {
    if (!model) return false;
    const modelDigits = normalizeModelText(model).replace(/\D/g, '');
    if (modelDigits.length < 3) return false;

    if (typeof parsedPrice === 'number' && parsedPrice % 1000 === 0) {
        return false;
    }

    const priceDigits = String(parsedPrice);
    
    // If the price digits contain the entire model digits
    if (priceDigits.includes(modelDigits)) {
        return true;
    }
    
    // If the model digits contain the price digits (length >= 4)
    if (modelDigits.includes(priceDigits) && priceDigits.length >= 4) {
        return true;
    }
    
    return false;
}

// XML Sitemap & Feed Discovery (Phần 2)
async function discoverSitemapLinks(domain, model, brand, fetchImpl = fetch) {
    const paths = [
        '/sitemap.xml',
        '/sitemap_products.xml',
        '/product-sitemap.xml',
        '/products.xml',
        '/feed.xml',
        '/rss.xml'
    ];
    const foundUrls = [];
    const normModel = normalizeModelText(model).toLowerCase();
    if (!normModel) return [];

    const cleanModelDigits = normModel.replace(/\D/g, '');

    const checkPath = async (path) => {
        const url = `https://${domain}${path}`;
        
        let text = pricingCache.get('html', url, 12);
        if (!text) {
            try {
                text = await fetchHtml(url, {
                    fetchImpl,
                    timeout: 3000,
                    userAgent: getRandomDesktopUserAgent(),
                });
                pricingCache.set('html', url, text);
            } catch (e) {
                return;
            }
        }

        if (!text || text.length < 100) return;

        // Parse sub-sitemaps
        const sitemapIndexMatches = text.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/gi);
        const subSitemaps = [];
        for (const match of sitemapIndexMatches) {
            subSitemaps.push(match[1].trim());
        }

        if (subSitemaps.length > 0) {
            const productSubSitemaps = subSitemaps.filter(loc => 
                loc.toLowerCase().includes('product') || 
                loc.toLowerCase().includes('san-pham') ||
                loc.toLowerCase().includes('post')
            ).slice(0, 5);
            
            const subProbes = productSubSitemaps.map(async (subUrl) => {
                let subText = pricingCache.get('html', subUrl, 12);
                if (!subText) {
                    try {
                        subText = await fetchHtml(subUrl, {
                            fetchImpl,
                            timeout: 3000,
                            userAgent: getRandomDesktopUserAgent(),
                        });
                        pricingCache.set('html', subUrl, subText);
                    } catch {
                        return;
                    }
                }
                if (subText) {
                    extractUrlsFromXml(subText);
                }
            });
            await Promise.all(subProbes);
        } else {
            extractUrlsFromXml(text);
        }
    };

    const extractUrlsFromXml = (xmlText) => {
        const matches = xmlText.matchAll(/<(loc|link)>([^<]+)<\/\2>/gi);
        for (const match of matches) {
            const locUrl = match[2].trim();
            if (/^https?:\/\//i.test(locUrl)) {
                const normLocUrl = normalizeModelText(locUrl).toLowerCase();
                if (normLocUrl.includes(normModel)) {
                    if (isLikelyProductDetailUrl(locUrl, model, brand)) {
                        foundUrls.push(locUrl);
                    }
                } else if (cleanModelDigits.length >= 4 && normLocUrl.includes(cleanModelDigits)) {
                    if (isLikelyProductDetailUrl(locUrl, model, brand)) {
                        foundUrls.push(locUrl);
                    }
                }
            }
        }
    };

    await Promise.all(paths.map(checkPath));
    return foundUrls;
}

// Page Content Verification (Phần 5)
function verifyPageContent($, url, model, brand) {
    const title = $('title').first().text() || '';
    const h1s = $('h1').map((_, el) => $(el).text()).get().join(' ');
    const h2s = $('h2').map((_, el) => $(el).text()).get().join(' ');
    const metaTitle = $('meta[name="title"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const twitterTitle = $('meta[name="twitter:title"]').attr('content') || '';
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';

    const schemaNames = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const text = $(el).html();
            if (text) {
                const data = JSON.parse(text);
                const extractNames = (obj) => {
                    if (!obj || typeof obj !== 'object') return;
                    if (Array.isArray(obj)) {
                        obj.forEach(extractNames);
                        return;
                    }
                    if (obj['@type'] === 'Product' && obj.name) {
                        schemaNames.push(String(obj.name));
                    }
                    for (const key in obj) {
                        if (typeof obj[key] === 'object') {
                            extractNames(obj[key]);
                        }
                    }
                };
                extractNames(data);
            }
        } catch (e) {}
    });

    const combinedTitle = `${title} ${h1s} ${h2s} ${metaTitle} ${ogTitle} ${twitterTitle} ${schemaNames.join(' ')}`;
    const combinedDesc = `${metaDesc} ${ogDesc}`;

    const normModel = normalizeModelText(model);
    if (!normModel) return { valid: false, reason: 'Empty model' };

    const matchedTitle = isModelMatch(combinedTitle, model, brand);
    const matchedUrl = isModelMatch(url, model, brand);
    
    if (!matchedTitle && !matchedUrl) {
        const normBrand = normalizeModelText(brand);
        if (normBrand && normalizeModelText(combinedTitle).includes(normBrand)) {
            return { valid: false, reason: 'Only brand matched, model missing' };
        }
        return { valid: false, reason: 'Model not found' };
    }

    if (hasConflictingModelSuffix(combinedTitle, model) || hasConflictingModelSuffix(url, model)) {
        return { valid: false, reason: 'Conflicting suffix found (extended model)' };
    }
    if (hasConflictingModelPrefix(combinedTitle, model, brand) || hasConflictingModelPrefix(url, model, brand)) {
        return { valid: false, reason: 'Conflicting prefix found' };
    }

    return { valid: true };
}

// Advanced Price Extractor (Phần 6, 7 & 8)
function extractPriceAdvanced($, html, model, url, referencePrice) {
    const isKocher = url && /kocher\.vn/i.test(url);
    const refPrice = parseVietnamesePrice(referencePrice);
    const minRange = refPrice ? Math.max(100000, refPrice * 0.3) : 100000;
    const maxRange = refPrice ? Math.min(2000000000, refPrice * 2.0) : 2000000000;

    const isValid = (p) => {
        if (!p) return false;
        if (p < minRange || p > maxRange) return false;
        if (isFakePrice(p, model)) return false;
        return true;
    };

    const isJunkNode = (el) => {
        const isRelated = $(el).closest('.related, .upsell, .cross-sell, .recommend, .suggested, .product-slider, .similar, .may-like, .swiper-slide, .swiper-container, .slick-slide, .slick-track, .owl-item, .owl-stage, .carousel, .slider, [class*="related"], [class*="upsell"], [class*="recommend"], [class*="similar"], [class*="slider"], [class*="carousel"], [class*="swiper"], [class*="slick"], [class*="owl"]').length > 0;
        if (isRelated) return true;

        const isOriginalPrice = $(el).closest('del, .old-price, .compare-at-price, .original-price, .price-old, .price-compare').length > 0;
        if (isOriginalPrice) return true;

        let current = $(el);
        for (let i = 0; i < 4 && current.length > 0 && current[0].name !== 'body'; i++) {
            const classStr = current.attr('class') || '';
            const idStr = current.attr('id') || '';
            const nodeText = current.clone().children().remove().end().text() || '';
            const combined = `${classStr} ${idStr} ${nodeText}`.toLowerCase();
            const normalized = normalizeVietnameseText(combined);
            
            if (/(tiet[\s_-]*kiem|save|saving|discount|giam[\s_-]*gia|tra[\s_-]*gop|monthly|installment|related[\s_-]*product|similar[\s_-]*product|combo)/i.test(normalized)) {
                return true;
            }
            current = current.parent();
        }
        return false;
    };

    // 1. JSON-LD Schema
    if (!isKocher) {
        let jsonLdPrice = null;
        const extractFromJson = (obj) => {
            if (jsonLdPrice) return;
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach(extractFromJson);
                return;
            }
            if (obj['@type'] === 'Offer' || obj['@type'] === 'Product' || obj['@type'] === 'AggregateOffer' || obj.price !== undefined || obj.lowPrice !== undefined || obj.highPrice !== undefined) {
                const currency = obj.priceCurrency;
                if (!currency || /vnd/i.test(String(currency))) {
                    const pricesToTry = [obj.price, obj.lowPrice, obj.highPrice].filter(p => p !== undefined && p !== null);
                    for (const pVal of pricesToTry) {
                        const parsed = parseVietnamesePrice(pVal);
                        if (isValid(parsed)) {
                            jsonLdPrice = parsed;
                            return;
                        }
                    }
                }
            }
            for (const key in obj) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    extractFromJson(obj[key]);
                }
            }
        };

        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const text = $(el).html();
                if (text) {
                    const data = JSON.parse(text);
                    extractFromJson(data);
                }
            } catch {}
        });

        if (jsonLdPrice) return jsonLdPrice;
    }

    // 2. Microdata (itemprop="price")
    let microdataPrice = null;
    $('[itemprop="price"]').each((_, el) => {
        if (isJunkNode(el)) return;
        const val = $(el).attr('content') || $(el).attr('value') || $(el).text();
        const parsed = parseVietnamesePrice(val);
        if (isValid(parsed)) {
            microdataPrice = parsed;
            return false;
        }
    });
    if (microdataPrice) return microdataPrice;

    // 3. OpenGraph og:price:amount
    let ogPrice = null;
    const ogSelectors = [
        'meta[property="product:price:amount"]',
        'meta[property="product:price"]',
        'meta[property="og:price:amount"]',
        'meta[property="og:price"]',
    ];
    for (const sel of ogSelectors) {
        const val = $(sel).attr('content');
        const parsed = parseVietnamesePrice(val);
        if (isValid(parsed)) {
            ogPrice = parsed;
            break;
        }
    }
    if (ogPrice) return ogPrice;

    // 4. Meta tags
    let metaPrice = null;
    $('meta').each((_, el) => {
        const name = $(el).attr('name') || $(el).attr('property') || '';
        if (/price|gia/i.test(name)) {
            const val = $(el).attr('content');
            const parsed = parseVietnamesePrice(val);
            if (isValid(parsed)) {
                metaPrice = parsed;
                return false;
            }
        }
    });
    if (metaPrice) return metaPrice;

    // 4. Domain Selector Cache (Phần 5)
    let domain = '';
    try {
        domain = new URL(url).hostname.toLowerCase();
    } catch (e) {}

    if (domain) {
        const learnedSelector = pricingCache.getSelectorForDomain(domain);
        if (learnedSelector) {
            let foundCachedPrice = null;
            $(learnedSelector).each((_, el) => {
                if (isJunkNode(el)) return;
                const val = $(el).attr('content') || $(el).attr('value') || $(el).text();
                const parsed = parseVietnamesePrice(val);
                if (isValid(parsed)) {
                    foundCachedPrice = parsed;
                    return false;
                }
            });
            if (foundCachedPrice) return foundCachedPrice;
        }
    }

    // 5. Generic HTML Scan (Phần 10)
    // 5a. JS State Scanning
    let jsStatePrice = null;
    $('script').each((_, el) => {
        if (jsStatePrice) return;
        const text = $(el).html() || '';
        if (!text) return;
        
        const containsState = /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|APP_STATE|__PRELOADED_STATE__/i.test(text);
        if (!containsState) return;

        let jsonStr = text;
        const assignmentMatch = text.match(/(?:window\.)?(?:__INITIAL_STATE__|APP_STATE|__PRELOADED_STATE__)\s*=\s*(\{[\s\S]*?\});?\s*(?:<\/script>|$)/i);
        if (assignmentMatch) {
            jsonStr = assignmentMatch[1];
        }

        try {
            const cleanJson = (str) => {
                const start = str.indexOf('{');
                if (start === -1) return null;
                let braceCount = 0;
                let inString = false;
                let escape = false;
                for (let i = start; i < str.length; i++) {
                    const char = str[i];
                    if (escape) {
                        escape = false;
                        continue;
                    }
                    if (char === '\\') {
                         escape = true;
                         continue;
                    }
                    if (char === '"') {
                         inString = !inString;
                         continue;
                    }
                    if (!inString) {
                         if (char === '{') braceCount++;
                         if (char === '}') {
                              braceCount--;
                              if (braceCount === 0) {
                                   return str.substring(start, i + 1);
                              }
                         }
                    }
                }
                return null;
            };
            const targetJson = cleanJson(jsonStr);
            if (targetJson) {
                const data = JSON.parse(targetJson);
                
                const findPriceInObj = (obj) => {
                    if (!obj || typeof obj !== 'object') return null;
                    const priceKeys = ['offerPrice', 'finalPrice', 'specialPrice', 'salePrice', 'price'];
                    for (const key of priceKeys) {
                        if (obj[key] !== undefined && obj[key] !== null) {
                            const parsed = parseVietnamesePrice(obj[key]);
                            if (isValid(parsed)) return parsed;
                        }
                    }
                    if (Array.isArray(obj)) {
                        for (const item of obj) {
                            const val = findPriceInObj(item);
                            if (val) return val;
                        }
                    } else {
                        for (const k in obj) {
                            if (Object.prototype.hasOwnProperty.call(obj, k)) {
                                const val = findPriceInObj(obj[k]);
                                if (val) return val;
                            }
                        }
                    }
                    return null;
                };
                
                const found = findPriceInObj(data);
                if (found) {
                    jsStatePrice = found;
                }
            }
        } catch (e) {}
    });
    if (jsStatePrice) return jsStatePrice;

    // 7. Common HTML CSS classes
    const htmlSelectors = [
        'ins .woocommerce-Price-amount',
        'ins .amount',
        'ins',
        '.price-new',
        '.price-amount',
        '.current-price',
        '.special-price',
        '.sale-price',
        '.woocommerce-Price-amount',
        '.amount',
        '.price',
        '.product-price',
        '.gia-ban',
        '.giaban',
        '.gia-khuyen-mai',
        '.gia-km',
        '.price-current',
        '.pro-price',
        '.product-price-new',
        '.price-box',
        '[class*="price-new"]',
        '[class*="current-price"]',
        '[class*="special-price"]',
        '.gia_ban',
        '.gia_khuyen_mai',
        '.gia_km',
        '.gia',
    ];

    for (const sel of htmlSelectors) {
        let foundPrice = null;
        $(sel).each((_, el) => {
            if (isJunkNode(el)) return;
            const val = $(el).attr('content') || $(el).attr('value') || $(el).text();
            const parsed = parseVietnamesePrice(val);
            if (isValid(parsed)) {
                foundPrice = parsed;
                return false;
            }
        });
        if (foundPrice) {
            // Learn selector for this domain (Phần 5)
            if (domain) {
                pricingCache.setSelectorForDomain(domain, sel);
            }
            return foundPrice;
        }
    }

    // Leaf nodes text matching
    let leafPrice = null;
    $('*').each((_, el) => {
        if ($(el).children().length > 0) return;
        if (isJunkNode(el)) return;

        const text = $(el).text();
        const hasCurrency = /[₫đ]|vnd|vnđ|đồng/i.test(text);
        if (!hasCurrency) return;

        const parsed = parseVietnamesePrice(text);
        if (isValid(parsed)) {
            leafPrice = parsed;
            return false;
        }
    });

    return leafPrice;
}

async function extractProductPrice({ url, model, brand, referencePrice, fetchImpl = fetch }) {
    const cachedPrice = pricingCache.getPrice(url); // PHẦN 9: cache url -> extracted_price
    if (cachedPrice !== null) {
        return cachedPrice;
    }

    const delayMs = 150 + Math.floor(Math.random() * 350);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    let html = pricingCache.getHtml(url); // PHẦN 8: cache url -> html
    if (!html) {
        try {
            html = await fetchHtml(url, { fetchImpl, timeout: 8000 });
            pricingCache.setHtml(url, html);
        } catch (error) {
            return null;
        }
    }

    const cheerio = getCheerio();
    const $ = cheerio.load(html);

    const verifyResult = verifyPageContent($, url, model, brand);
    if (!verifyResult.valid) {
        return null;
    }

    const price = extractPriceAdvanced($, html, model, url, referencePrice);
    pricingCache.setPrice(url, price);
    return price;
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
    return !/^\d+$/.test(cleanNumericCode(trimmed));
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

    let data;
    if (typeof response.text === 'function') {
        const rawText = await response.text();
        try {
            data = JSON.parse(rawText);
        } catch {
            if (/khong tim thay trang|tep ma ban yeu cau khong ton tai|requested file does not exist/i.test(normalizeVietnameseText(rawText))) {
                throw new Error('Apps Script URL khong ton tai hoac deployment /exec da bi thay doi.');
            }
            throw new Error('Apps Script khong tra ve JSON hop le. Kiem tra lai deployment web app /exec.');
        }
    } else {
        data = await response.json();
    }

    if (data && data.ok === false) {
        const actionName = params?.action || payload?.action || '';
        if (actionName === 'listSheets' && /action get khong hop le/i.test(normalizeVietnameseText(data.error || ''))) {
            throw new Error('Apps Script deployment hien tai chua ho tro listSheets qua GET. Hay redeploy ban moi cua web app.');
        }
        throw new Error(data.error || 'Apps Script tra ve loi.');
    }

    return data;
}

async function processPricingRow({ row, deps = {} }) {
    const searchFn = deps.searchProductLinks || searchProductLinks;
    const extractPriceFn = deps.extractProductPrice || ((url) => extractProductPrice({
        url,
        model: row.model,
        brand: row.brand,
        referencePrice: row.costPrice,
        fetchImpl: deps.fetchImpl || fetch,
    }));
    const shouldStop = typeof deps.shouldStop === 'function' ? deps.shouldStop : () => false;
    const linksConcurrency = Math.max(1, Number.parseInt(deps.linksConcurrency, 10) || 4);
    if (fetchQueue && fetchQueue.maxConcurrency < linksConcurrency) {
        fetchQueue.maxConcurrency = linksConcurrency;
    }

    if (!row || !isValidBrand(row.brand) || !isValidModel(row.model)) {
        return {
            rowNumber: row?.rowNumber,
            status: 'skipped',
            marketPrices: [],
            matchedUrls: [],
            matchedDetails: [],
            minPrice: null,
            gapValue: null,
            gapPercent: null,
            suggestedPrice: null,
        };
    }

    // Intercept mock pricing for 21.Test sheet
    const isTestSheet = row.sheetName && /21\.test/i.test(normalizeVietnameseText(row.sheetName));
    if (isTestSheet) {
        const mockDetails = Array.from({ length: 10 }, (_, i) => ({
            url: `https://mock-market-test.vn/cleer-test-p${i + 1}`,
            price: 100000,
        }));
        const pricing = computeSuggestedPricing({
            listPrice: row.listPrice,
            costPrice: row.costPrice,
            currentSalePrice: row.salePrice || 100000,
            prices: mockDetails.map(d => d.price),
        });

        return {
            rowNumber: row.rowNumber,
            productId: row.productId || '',
            brand: row.brand,
            model: row.model,
            matchedUrls: mockDetails.map((d) => d.url),
            matchedDetails: mockDetails,
            totalLinksCount: mockDetails.length,
            marketPrices: pricing.marketPrices,
            hasNewPrices: true,
            minPrice: pricing.minPrice,
            gapValue: pricing.gapValue,
            gapPercent: pricing.gapPercent,
            suggestedPrice: pricing.suggestedPrice,
            outlierRemoved: pricing.outlierRemoved,
            status: 'success',
        };
    }

    if (shouldStop()) {
        throw new Error('STOP_REQUESTED');
    }

    const startRequests = totalRequestsMade;
    const startCacheHits = totalCacheHits;
    const startTime = Date.now();

    let allFilteredLinks = [];
    let isCacheHit = false;
    const sourceMap = new Map();

    // Cache 2 URL map lookup (Phần 4)
    const cachedUrls = pricingCache.getUrlsForModel(row.model);
    if (cachedUrls && cachedUrls.length > 0) {
        allFilteredLinks = cachedUrls;
        isCacheHit = true;
        cachedUrls.forEach(url => sourceMap.set(url, 'Cache URL Map'));
    } else {
        // Run progressive search (Phần 1 & 2)
        const discoveredLinks = await searchFn({
            brand: row.brand,
            model: row.model,
            limit: 20,
            sheetName: row.sheetName,
            sourceMap,
            fetchImpl: deps.fetchImpl || fetch,
        });

        if (shouldStop()) {
            throw new Error('STOP_REQUESTED');
        }

        // XML Sitemap discovery - fallback only if < 10 discovered links
        const likelyLinks = discoveredLinks.filter(link => isLikelyProductDetailUrl(link, row.model, row.brand));
        let allSitemapLinks = [];
        if (likelyLinks.length < 10) {
            const uniqueDomains = Array.from(new Set(
                discoveredLinks.map(link => {
                    try {
                        return new URL(link).hostname;
                    } catch {
                        return null;
                    }
                }).filter(Boolean)
            )).slice(0, 10);

            const sitemapLinksPromises = uniqueDomains.map(async (domain) => {
                try {
                    const urls = await discoverSitemapLinks(domain, row.model, row.brand, deps.fetchImpl || fetch);
                    urls.forEach(url => {
                        sourceMap.set(url, 'Sitemap');
                    });
                    return urls;
                } catch {
                    return [];
                }
            });
            const sitemapLinksResults = await Promise.all(sitemapLinksPromises);
            allSitemapLinks = sitemapLinksResults.flat();
        }

        const mergedLinks = Array.from(new Set([...discoveredLinks, ...allSitemapLinks]));
        allFilteredLinks = mergedLinks.filter((link) => isLikelyProductDetailUrl(link, row.model, row.brand));
    }

    const searchTimeMs = Date.now() - startTime;
    const crawlStartTime = Date.now();

    // Relevance scoring and top 50 selection (Phần 3 & 4)
    const scoredLinks = allFilteredLinks.map(url => ({
        url,
        score: calculateRelevanceScore(url, row.model, row.brand)
    }));

    scoredLinks.sort((a, b) => b.score - a.score);
    const topScoredLinks = scoredLinks.slice(0, 50);
    const filteredLinks = topScoredLinks.map(item => item.url);

    const matchedDetails = [];
    let crawlCacheHits = 0;
    const BATCH_SIZE = 10;
    let batchIndex = 0;

    // Progressive Crawling (Phần 6)
    while (batchIndex < filteredLinks.length) {
        if (matchedDetails.length >= 5) {
            break; // Stop crawling if we have found at least 5 valid prices
        }

        const batch = filteredLinks.slice(batchIndex, batchIndex + BATCH_SIZE);
        batchIndex += BATCH_SIZE;

        const batchResults = [];
        let nextBatchIndex = 0;

        const runBatchWorker = async () => {
            while (nextBatchIndex < batch.length) {
                if (shouldStop()) {
                    throw new Error('STOP_REQUESTED');
                }
                const url = batch[nextBatchIndex++];
                if (!url) break;

                try {
                    // Pre-crawled cache checks (for stats)
                    const hasHtmlCache = pricingCache.getHtml(url) !== null;
                    const hasPriceCache = pricingCache.getPrice(url) !== null;
                    if (hasHtmlCache || hasPriceCache) {
                        crawlCacheHits++;
                    }

                    const price = await extractPriceFn(url, row);
                    if (shouldStop()) {
                        throw new Error('STOP_REQUESTED');
                    }
                    if (price && price >= 100000 && price <= 2000000000) {
                        // Update cache URL maps for success URL (Phần 4)
                        try {
                            const host = new URL(url).hostname.toLowerCase();
                            pricingCache.setUrlForModelDomain(row.model, host, url);
                        } catch (e) {}

                        batchResults.push({ url, price });
                    }
                } catch (error) {
                    if (error && error.message === 'STOP_REQUESTED') {
                        throw error;
                    }
                }
            }
        };

        const workersCount = Math.min(linksConcurrency, batch.length);
        const workers = Array.from({ length: workersCount }, () => runBatchWorker());
        await Promise.all(workers);

        batchResults.forEach(res => {
            if (res) {
                matchedDetails.push(res);
            }
        });
    }

    matchedDetails.sort((a, b) => a.price - b.price);
    const hasNewPrices = matchedDetails.length > 0;
    const finalPrices = hasNewPrices ? matchedDetails.map((d) => d.price) : (row.marketPrices || []);
    const pricing = computeSuggestedPricing({
        listPrice: row.listPrice,
        costPrice: row.costPrice,
        currentSalePrice: row.salePrice,
        prices: finalPrices,
    });

    const crawlTimeMs = Date.now() - crawlStartTime;
    const endRequests = totalRequestsMade;
    const endCacheHits = totalCacheHits;

    const runRequests = endRequests - startRequests;
    const runCacheHits = endCacheHits - startCacheHits;
    const totalRuns = runRequests + runCacheHits;
    const cacheHitRatePercent = totalRuns > 0 ? Math.round((runCacheHits / totalRuns) * 100) : 0;
    const savedRequests = (isCacheHit ? 4 : 0) + crawlCacheHits;
    const savedTimeMs = (isCacheHit ? 1500 : 0) + (crawlCacheHits * 500);

    const stats = {
        searchTimeMs,
        crawlTimeMs,
        requestsMade: runRequests,
        cacheHits: runCacheHits,
        validUrlsCount: filteredLinks.length,
        validPricesCount: matchedDetails.length,
        savedRequests,
        savedTimeMs,
        cacheHitRatePercent
    };

    // Debug logging information (Phần 12)
    const keywordsUsed = generateKeywords(row.brand, row.model, row.sheetName).slice(0, 3).join(', ');
    const pricingLogs = [];
    
    filteredLinks.forEach(url => {
        const engine = sourceMap.get(url) || 'Search Engine';
        const relScore = calculateRelevanceScore(url, row.model, row.brand);
        const matchEntry = matchedDetails.find(d => d.url === url);
        const priceFound = matchEntry ? matchEntry.price : null;
        let rejectReason = '';
        if (!matchEntry) {
            rejectReason = 'Model mismatch or price not found';
        }

        pricingLogs.push({
            keyword: keywordsUsed,
            'search engine': engine,
            url,
            'relevance score': relScore,
            'model match score': relScore >= 40 ? 100 : 0,
            'extracted price': priceFound,
            'reject reason': rejectReason,
        });
    });

    // Add stats log at the end of pricingLogs
    pricingLogs.push({
        keyword: 'STATISTICS SUMMARY',
        'search engine': 'System Stats',
        url: `Hit rate: ${cacheHitRatePercent}%, Requests: ${runRequests}, Saved requests: ${savedRequests}`,
        'relevance score': 0,
        'model match score': 0,
        'extracted price': null,
        'reject reason': `Search time: ${searchTimeMs}ms, Crawl time: ${crawlTimeMs}ms, Saved time: ${savedTimeMs}ms`
    });

    return {
        rowNumber: row.rowNumber,
        productId: row.productId || '',
        brand: row.brand,
        model: row.model,
        matchedUrls: matchedDetails.map((d) => d.url),
        matchedDetails,
        totalLinksCount: filteredLinks.length,
        marketPrices: pricing.marketPrices,
        hasNewPrices,
        minPrice: pricing.minPrice,
        gapValue: pricing.gapValue,
        gapPercent: pricing.gapPercent,
        suggestedPrice: pricing.suggestedPrice,
        outlierRemoved: pricing.outlierRemoved,
        status: finalPrices.length >= 3 ? 'success' : 'insufficient_prices',
        pricingLogs,
        stats
    };
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
            listPrice: mapping.listPrice !== -1 ? (row.values?.[mapping.listPrice] || '') : '',
            costPrice: mapping.costPrice !== -1 ? (row.values?.[mapping.costPrice] || '') : '',
            salePrice: mapping.salePrice !== -1 ? (row.values?.[mapping.salePrice] || '') : '',
            marketPrices,
        };
    });

    return { sheetId, headers, mapping, rows };
}

async function writeSheetUpdates({ appsScriptUrl, sheetUrl, sheetName, updates, logs = [], fetchImpl = fetch }) {
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
            logs,
        },
        fetchImpl,
    });
}

async function listSpreadsheetSheets({ appsScriptUrl, sheetUrl, fetchImpl = fetch }) {
    const sheetId = extractSheetId(sheetUrl);
    try {
        return await callAppsScript({
            appsScriptUrl,
            method: 'GET',
            params: {
                action: 'listSheets',
                sheetId,
            },
            fetchImpl,
        });
    } catch (error) {
        const normalizedMessage = normalizeVietnameseText(error.message || '');
        const canFallbackToPublicHtml =
            normalizedMessage.includes('listsheets qua get') ||
            normalizedMessage.includes('khong ton tai hoac deployment') ||
            normalizedMessage.includes('khong tra ve json hop le') ||
            normalizedMessage.includes('apps script loi http 404');

        if (!canFallbackToPublicHtml) {
            throw error;
        }

        const html = await fetchHtml(sheetUrl, { fetchImpl, timeout: 15000 });
        const sheets = extractSheetNamesFromSpreadsheetHtml(html);
        if (sheets.length === 0) {
            throw error;
        }

        return { ok: true, sheets, source: 'public-html-fallback' };
    }
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



async function loadModelMapping({ appsScriptUrl, sheetUrl, fetchImpl = fetch }) {
    if (!appsScriptUrl || !sheetUrl) return {};
    const sheetId = extractSheetId(sheetUrl);

    // Find the real sheet name for 'LOG' in the sheet list to avoid encoding/normalization issues
    let targetSheetName = 'LOG';
    try {
        const sheetListRes = await listSpreadsheetSheets({ appsScriptUrl, sheetUrl, fetchImpl });
        if (sheetListRes && Array.isArray(sheetListRes.sheets)) {
            const normalizedTarget = normalizeVietnameseText(targetSheetName).replace(/[^a-z0-9]/g, '');
            const matchedName = sheetListRes.sheets.find(name => {
                const normalizedName = normalizeVietnameseText(name).replace(/[^a-z0-9]/g, '');
                return normalizedName === normalizedTarget;
            });
            if (matchedName) {
                targetSheetName = matchedName;
            }
        }
    } catch (err) {
        // Fall back silently to 'LOG'
    }

    try {
        const data = await callAppsScript({
            appsScriptUrl,
            method: 'GET',
            params: {
                action: 'readRows',
                sheetId,
                sheetName: targetSheetName,
                startRow: 3,
                headerRow: 2,
            },
            fetchImpl,
        });

        // Headers are for the whole sheet, but "FIX MODEL SỐ" starts from Column M (index 12), so we look at columns M, N, O
        const codeIdx = 13;
        const modelIdx = 14;

        const mapping = {};
        (data.rows || []).forEach((row) => {
            const code = String(row.values?.[codeIdx] || '').trim();
            const model = String(row.values?.[modelIdx] || '').trim();
            if (code && model) {
                const cleanedCode = cleanNumericCode(code);
                mapping[cleanedCode] = model;
            }
        });
        return mapping;
    } catch (err) {
        console.warn('Lỗi khi tải bảng ánh xạ FIX MODEL SỐ từ sheet LOG:', err.message);
        return {};
    }
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
    deps = {},
}) {
    const loadModelMappingFn = deps.loadModelMapping || loadModelMapping;
    const readSheetRowsFn = deps.readSheetRows || readSheetRows;
    const writeSheetUpdatesFn = deps.writeSheetUpdates || writeSheetUpdates;
    const processPricingRowFn = deps.processPricingRow || processPricingRow;

    const jobId = `job_${Date.now()}`;
    const job = {
        id: jobId,
        status: 'running',
        sheetUrl,
        sheetName,
        startRow: Math.max(3, parseInt(startRow, 10) || 3),
        endRow: endRow ? parseInt(endRow, 10) : null,
        rowsConcurrency: Math.max(1, parseInt(rowsConcurrency, 10) || 5),
        linksConcurrency: Math.max(1, parseInt(linksConcurrency, 10) || 10),
        batchSize: Math.max(1, parseInt(batchSize, 10) || 10),
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

    (async () => {
        const log = (message, level = 'info') => {
            const timestamp = new Date().toLocaleTimeString('vi-VN');
            job.logs.push({ timestamp, message, level });
            console.log(`[${jobId}] [${level.toUpperCase()}] ${message}`);
        };

        const sheetNames = normalizeSelectedSheetNames(sheetName);
        if (sheetNames.length === 0) {
            job.status = 'error';
            log('Lỗi: Tên sheet không hợp lệ.', 'error');
            return;
        }

        log(`Bắt đầu đọc dữ liệu từ các sheet: ${sheetNames.join(', ')}...`);
        try {
            log('Đang tải bảng ánh xạ model từ sheet 18.Mã sản phẩm...');
            const modelMapping = await loadModelMappingFn({ appsScriptUrl, sheetUrl });
            const mappingKeys = Object.keys(modelMapping);
            if (mappingKeys.length > 0) {
                log(`Đã tải thành công ${mappingKeys.length} ánh xạ model từ 18.Mã sản phẩm.`, 'success');
            } else {
                log('Không tìm thấy ánh xạ model nào hoặc lỗi tải 18.Mã sản phẩm.', 'warning');
            }

            const fetchPromises = sheetNames.map(async (name) => {
                const data = await readSheetRowsFn({
                    appsScriptUrl,
                    sheetUrl,
                    sheetName: name,
                    startRow: job.startRow,
                    endRow: job.endRow || undefined,
                });
                return (data.rows || []).map((r) => ({ ...r, sheetName: name }));
            });

            const allResults = await Promise.all(fetchPromises);
            const mergedRows = allResults.flat();
            const mergedRowsMapped = mergedRows.map((row) => {
                const cleanedModel = cleanNumericCode(row.model);
                let model = String(row.model || '').trim();
                let mapped = false;
                if (/^\d+$/.test(cleanedModel) && modelMapping[cleanedModel]) {
                    model = modelMapping[cleanedModel];
                    mapped = true;
                }
                return { ...row, model, originalModel: row.model || '', mappedModel: mapped };
            });

            job.rows = mergedRowsMapped.map((row) => {
                if (row.mappedModel) {
                    log(`Dòng ${row.rowNumber} [${row.sheetName}]: Ánh xạ model số ${row.originalModel} thành ${row.model}.`);
                }
                return {
                    rowNumber: row.rowNumber,
                    sheetName: row.sheetName,
                    productId: row.productId || '',
                    brand: row.brand,
                    model: row.model,
                    originalModel: row.originalModel,
                    listPrice: row.listPrice || '',
                    costPrice: row.costPrice || '',
                    salePrice: row.salePrice || '',
                    salePriceValue: parseVietnamesePrice(row.salePrice),
                    status: (isValidBrand(row.brand) && isValidModel(row.model)) ? 'pending' : 'skipped',
                    marketPrices: row.marketPrices || [],
                    matchedDetails: [],
                    minPrice: null,
                    gapValue: null,
                    gapPercent: null,
                    suggestedPrice: null,
                    writtenToSheet: false,
                    errorMessage: '',
                };
            });

            const runnableRows = mergedRowsMapped.filter((row) => 
                isValidBrand(row.brand) && 
                isValidModel(row.model)
            );
            job.totalRows = job.rows.length;

            const skippedRowsCount = job.rows.filter((r) => r.status === 'skipped').length;
            job.processedCount += skippedRowsCount;
            if (skippedRowsCount > 0) {
                log(`Bỏ qua ${skippedRowsCount} dòng do thiếu Thương hiệu hoặc Model, hoặc Model chỉ toàn số.`);
            }

            log(`Đã đọc ${job.rows.length} dòng từ Google Sheet. Có ${runnableRows.length} dòng hợp lệ để xử lý.`);
            const totalConcurrency = job.rowsConcurrency * job.linksConcurrency;
            if (fetchQueue) {
                fetchQueue.maxConcurrency = Math.max(5, totalConcurrency);
                log(`Thiết lập độ ưu tiên đa luồng tải trang: ${job.rowsConcurrency} dòng song song, ${job.linksConcurrency} liên kết song song mỗi dòng (Tổng số luồng tải tối đa: ${fetchQueue.maxConcurrency}).`);
            }
            if (runnableRows.length === 0) {
                job.status = 'completed';
                log('Không có dòng nào đủ điều kiện xử lý.');
                return;
            }

            let cursor = 0;
            const pendingUpdates = [];
            let isWriting = false;

            const flushUpdates = async (force = false) => {
                if (pendingUpdates.length === 0) return;
                if (!force && pendingUpdates.length < job.batchSize) return;

                while (isWriting) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }

                isWriting = true;
                const batch = pendingUpdates.splice(0, force ? pendingUpdates.length : job.batchSize);

                try {
                    const updatesBySheet = {};
                    batch.forEach((update) => {
                        if (!updatesBySheet[update.sheetName]) {
                            updatesBySheet[update.sheetName] = [];
                        }
                        updatesBySheet[update.sheetName].push(update);
                    });

                    log(`Đang ghi ${batch.length} dòng kết quả về Google Sheet...`);
                    await Promise.all(Object.entries(updatesBySheet).map(async ([name, sheetUpdates]) => {
                        const sheetLogs = [];
                        sheetUpdates.forEach((u) => {
                            if (u.matchedDetails && u.matchedDetails.length > 0) {
                                u.matchedDetails.forEach((detail) => {
                                    sheetLogs.push({
                                        timestamp: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
                                        brand: u.brand || '',
                                        model: u.model || '',
                                        price: detail.price,
                                        url: detail.url,
                                    });
                                });
                            }
                        });

                        await writeSheetUpdatesFn({
                            appsScriptUrl,
                            sheetUrl,
                            sheetName: name,
                            updates: sheetUpdates.map((u) => ({
                                rowNumber: u.rowNumber,
                                marketPrices: u.marketPrices,
                                hasNewPrices: u.hasNewPrices,
                                minPrice: u.minPrice,
                                gapValue: u.gapValue,
                                gapPercent: u.gapPercent,
                                suggestedPrice: u.suggestedPrice,
                                status: u.status,
                            })),
                            logs: sheetLogs,
                        });
                    }));

                    batch.forEach((update) => {
                        const target = job.rows.find((r) => r.sheetName === update.sheetName && r.rowNumber === update.rowNumber);
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
                    const activeItem = job.rows.find((r) => r.sheetName === row.sheetName && r.rowNumber === row.rowNumber);
                    if (activeItem) {
                        activeItem.status = 'processing';
                    }

                    try {
                        log(`Đang xử lý dòng ${row.rowNumber} [${row.sheetName}]: ${row.brand} ${row.model}...`);
                        const result = await processPricingRowFn({
                            row: {
                                rowNumber: row.rowNumber,
                                brand: row.brand,
                                model: row.model,
                                listPrice: row.listPrice,
                                costPrice: row.costPrice,
                                salePrice: row.salePrice,
                                marketPrices: row.marketPrices,
                                sheetName: row.sheetName,
                            },
                            deps: {
                                linksConcurrency: job.linksConcurrency,
                                shouldStop: () => job.stopRequested,
                            },
                        });

                        if (job.stopRequested) {
                            if (activeItem && activeItem.status === 'processing') {
                                activeItem.status = 'skipped';
                                activeItem.errorMessage = 'Đã dừng theo yêu cầu người dùng.';
                            }
                            break;
                        }

                        if (activeItem) {
                            Object.assign(activeItem, {
                                status: result.status,
                                marketPrices: result.marketPrices,
                                minPrice: result.minPrice,
                                gapValue: result.gapValue,
                                gapPercent: result.gapPercent,
                                suggestedPrice: result.suggestedPrice,
                                matchedUrls: result.matchedUrls,
                                matchedDetails: result.matchedDetails,
                                pricingLogs: result.pricingLogs,
                            });
                        }

                        job.lastResult = result;
                        job.processedCount += 1;
                        if (result.status === 'success') {
                            job.successCount += 1;
                            log(`Dòng ${row.rowNumber} [${row.sheetName}] (${row.brand} ${row.model}) thành công: Tìm thấy ${result.totalLinksCount} cửa hàng, quét được ${result.marketPrices.length} giá. Min=${result.minPrice.toLocaleString('vi-VN')} đ, Đề xuất=${result.suggestedPrice ? result.suggestedPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'success');
                        } else {
                            job.errorCount += 1;
                            log(`Dòng ${row.rowNumber} [${row.sheetName}] (${row.brand} ${row.model}) thành công (thiếu giá hoặc ít hơn 3 giá): Tìm thấy ${result.totalLinksCount} cửa hàng, quét được ${result.marketPrices.length} giá. Min=${result.minPrice ? result.minPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'warning');
                        }

                        pendingUpdates.push({
                            rowNumber: result.rowNumber,
                            sheetName: row.sheetName,
                            brand: row.brand,
                            model: row.model,
                            marketPrices: result.marketPrices,
                            hasNewPrices: result.hasNewPrices,
                            minPrice: result.minPrice,
                            gapValue: result.gapValue,
                            gapPercent: result.gapPercent,
                            suggestedPrice: result.suggestedPrice,
                            status: result.status,
                            matchedDetails: result.matchedDetails,
                        });
                        await flushUpdates(false);
                    } catch (err) {
                        if (err && err.message === 'STOP_REQUESTED') {
                            if (activeItem) {
                                activeItem.status = 'skipped';
                                activeItem.errorMessage = 'Đã dừng theo yêu cầu người dùng.';
                            }
                            break;
                        }

                        job.processedCount += 1;
                        job.errorCount += 1;
                        if (activeItem) {
                            activeItem.status = 'error';
                            activeItem.errorMessage = err.message;
                        }
                        log(`Lỗi xử lý dòng ${row.rowNumber} [${row.sheetName}] (${row.brand} ${row.model}): ${err.message}`, 'error');
                    }
                }
            };

            const workersCount = Math.min(job.rowsConcurrency, runnableRows.length);
            await Promise.all(Array.from({ length: workersCount }, () => worker()));
            await flushUpdates(true);

            if (job.stopRequested) {
                job.status = 'stopped';
                log('Job đã dừng theo yêu cầu người dùng.');
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

const HARAVAN_BRANDS = new Set([
    "bosch",
    "hafele",
    "tefal",
    "konox",
    "kluger",
    "canzy",
    "eurosun",
    "junger",
    "kocher",
    "grandx",
    "toshiba",
    "supor",
    "garis",
    "kaff"
]);

const REMOVE_WORDS = new Set([
    "máy",
    "rửa",
    "chén",
    "bát",
    "vòi",
    "khóa",
    "hút",
    "mùi",
    "bếp",
    "tủ",
    "lò",
    "nồi",
    "chảo",
    "bộ",
    "inox",
    "cao",
    "cấp",
    "âm",
    "đơn",
    "đôi",
    "điện",
    "từ",
    "gas"
]);

function isRealModel(value) {
    if (!value) return false;
    const strVal = String(value).trim().toUpperCase();
    if (strVal.length < 3) return false;
    const hasLetter = /[A-Z]/.test(strVal);
    const hasNumber = /\d/.test(strVal);
    return hasLetter && hasNumber;
}

function cleanText(text) {
    let str = String(text);
    str = str.replace(/\[[^\]]+\]/g, " ");
    str = str.replace(/\([^)]*\)/g, " ");
    str = str.replace(/\|/g, " ");
    str = str.replace(/\s+/g, " ");
    return str.trim();
}

function extractModelRegex(name = '') {
    const patterns = [
        /\b[A-Z]{2,}\d+[A-Z0-9\-]*\b/g,
        /\b\d+[A-Z]{2,}[A-Z0-9\-]*\b/g,
        /\b[A-Z]+-\d+[A-Z0-9\-]*\b/g,
        /\b[A-Z0-9]+-[A-Z0-9]+\b/g,
        /\bH\d{2,}[A-Z0-9\-]*\b/g
    ];

    const upperName = String(name).toUpperCase();
    for (const pattern of patterns) {
        const matches = upperName.match(pattern);
        if (matches && matches.length > 0) {
            matches.sort((a, b) => b.length - a.length);
            return matches[0];
        }
    }
    return null;
}

function extractCommercialName(name, brand) {
    let text = cleanText(name);
    if (brand) {
        const escapedBrand = String(brand).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const brandRegex = new RegExp(escapedBrand, 'gi');
        text = text.replace(brandRegex, " ");
    }

    const words = text.split(/\s+/);
    const filteredWords = [];
    for (const word of words) {
        if (!word) continue;
        const wLower = word.toLowerCase();
        if (REMOVE_WORDS.has(wLower)) {
            continue;
        }
        filteredWords.push(word);
    }

    let result = filteredWords.join(" ");
    result = result.replace(/\s+/g, " ");
    return result.trim();
}

function detectBrand(product = {}) {
    const vendor = String(product.vendor || '').trim();
    if (vendor) {
        return vendor;
    }

    const title = String(product.title || '').toLowerCase();
    for (const brand of HARAVAN_BRANDS) {
        if (title.includes(brand)) {
            return brand.charAt(0).toUpperCase() + brand.slice(1);
        }
    }
    return "";
}

function extractModel(product = {}, variant = {}) {
    const sku = String(variant.sku || '').trim();
    if (isRealModel(sku)) {
        return sku;
    }

    const barcode = String(variant.barcode || '').trim();
    if (isRealModel(barcode)) {
        return barcode;
    }

    const title = product.title || '';
    const regexModel = extractModelRegex(title);
    if (regexModel) {
        return regexModel;
    }

    const brand = detectBrand(product);
    return extractCommercialName(title, brand);
}

async function syncHaravanIds({ appsScriptUrl, sheetUrl, haravanShopUrl, haravanAccessToken, fetchImpl = fetch }) {
    if (!appsScriptUrl || !sheetUrl || !haravanShopUrl || !haravanAccessToken) {
        throw new Error('Thiếu cấu hình Apps Script URL, Sheet URL, Haravan Shop URL hoặc Access Token.');
    }

    let shopUrl = String(haravanShopUrl).trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(shopUrl)) {
        shopUrl = `https://${shopUrl}`;
    }
    const token = String(haravanAccessToken).trim();
    const sheetId = extractSheetId(sheetUrl);

    let page = 1;
    const rows = [];

    while (true) {
        const url = `${shopUrl}/admin/products.json?limit=250&page=${page}`;
        const response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Haravan API returned HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const products = data.products || [];
        if (products.length === 0) {
            break;
        }

        for (const product of products) {
            const brand = detectBrand(product);
            const productName = product.title || '';
            const variants = product.variants || [];
            
            for (const variant of variants) {
                const model = extractModel(product, variant);
                const variantId = variant.id || '';
                
                rows.push({
                    product_name: productName,
                    brand: brand,
                    model: model,
                    variant_id: variantId,
                });
            }
        }

        page += 1;
        // Safety break to prevent infinite loop
        if (page > 100) break;
    }

    const writeResult = await callAppsScript({
        appsScriptUrl,
        method: 'POST',
        payload: {
            action: 'writeHaravanIds',
            sheetId,
            rows,
        },
        fetchImpl,
    });

    return {
        ok: true,
        fetched: rows.length,
        written: writeResult.written || 0,
    };
}

async function loadHaravanMapping({ appsScriptUrl, sheetUrl, fetchImpl = fetch }) {
    if (!appsScriptUrl || !sheetUrl) return {};
    const sheetId = extractSheetId(sheetUrl);

    let targetSheetName = 'ID Haravan';
    let isFallback = false;
    try {
        const sheetListRes = await listSpreadsheetSheets({ appsScriptUrl, sheetUrl, fetchImpl });
        if (sheetListRes && Array.isArray(sheetListRes.sheets)) {
            const hasTarget = sheetListRes.sheets.some(name => {
                const norm = normalizeVietnameseText(name).replace(/[^a-z0-9]/g, '');
                return norm === '20idharavan' || norm === 'idharavan';
            });
            if (!hasTarget) {
                const fallbackSheet = sheetListRes.sheets.find(name => {
                    const norm = normalizeVietnameseText(name).replace(/[^a-z0-9]/g, '');
                    return norm.includes('tonghopsanpham');
                }) || sheetListRes.sheets[0];
                if (fallbackSheet) {
                    targetSheetName = fallbackSheet;
                    isFallback = true;
                }
            }
        }
    } catch (err) {
        // Fall back silently
    }

    try {
        const data = await callAppsScript({
            appsScriptUrl,
            method: 'GET',
            params: {
                action: 'readRows',
                sheetId,
                sheetName: targetSheetName,
                startRow: 2,
                headerRow: 1,
            },
            fetchImpl,
        });

        const headers = data.headers || [];
        const brandIdx = headers.findIndex((h) => /thuong hieu/i.test(normalizeVietnameseText(h)));
        const modelIdx = headers.findIndex((h) => /model/i.test(normalizeVietnameseText(h)));
        const idIdx = headers.findIndex((h) => {
            const norm = normalizeVietnameseText(h);
            if (isFallback) {
                return /id haravan|haravan id|variant id/i.test(norm);
            } else {
                return /id/i.test(norm);
            }
        });

        const mapping = {};
        if (brandIdx !== -1 && modelIdx !== -1 && idIdx !== -1) {
            (data.rows || []).forEach((row) => {
                const brand = String(row.values?.[brandIdx] || '').trim();
                const model = String(row.values?.[modelIdx] || '').trim();
                const variantId = String(row.values?.[idIdx] || '').trim();
                if (brand && model && variantId) {
                    const key = `${normalizeModelText(brand)}_${normalizeModelText(model)}`;
                    mapping[key] = variantId;
                }
            });
        }
        return mapping;
    } catch (err) {
        console.warn(`Lỗi khi tải bảng ánh xạ Haravan từ sheet ${targetSheetName}:`, err.message);
        return {};
    }
}

async function updateHaravanVariantPrice({ haravanShopUrl, haravanAccessToken, variantId, price, fetchImpl = fetch }) {
    if (!haravanShopUrl || !haravanAccessToken || !variantId || !price) {
        throw new Error('Thiếu thông tin cấu hình hoặc dữ liệu cập nhật giá Haravan.');
    }

    let shopUrl = String(haravanShopUrl).trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(shopUrl)) {
        shopUrl = `https://${shopUrl}`;
    }
    const token = String(haravanAccessToken).trim();
    const cleanPrice = String(price).replace(/\D/g, '');

    const url = `${shopUrl}/admin/variants/${variantId}.json`;
    const response = await fetchImpl(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            variant: {
                id: Number(variantId),
                price: cleanPrice,
            }
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Haravan API returned HTTP ${response.status}: ${text || response.statusText}`);
    }

    return await response.json();
}

async function sendTelegramNotification({ telegramBotToken, telegramChatId, message, fetchImpl = fetch }) {
    const token = String(telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = String(telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();

    if (!token || !chatId) {
        return { ok: false, error: 'Thiếu Telegram Bot Token hoặc Chat ID.' };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Telegram API returned HTTP ${response.status}: ${text || response.statusText}`);
    }

    return await response.json();
}

async function writeHaravanLog({ appsScriptUrl, sheetUrl, brand, model, price, status, fetchImpl = fetch }) {
    if (!appsScriptUrl || !sheetUrl) {
        throw new Error('Thiếu cấu hình Apps Script hoặc Sheet URL.');
    }
    const sheetId = extractSheetId(sheetUrl);

    const writeResult = await callAppsScript({
        appsScriptUrl,
        method: 'POST',
        payload: {
            action: 'writeHaravanLog',
            sheetId,
            brand,
            model,
            price,
            status,
            timestamp: new Date().toLocaleString('vi-VN'),
        },
        fetchImpl,
    });

    return writeResult;
}

async function updateSheetSalePrice({ appsScriptUrl, sheetUrl, sheetName, rowNumber, price, fetchImpl = fetch }) {
    if (!appsScriptUrl || !sheetUrl || !sheetName || !rowNumber || !price) {
        throw new Error('Thiếu thông tin cấu hình hoặc dữ liệu cập nhật giá bán Google Sheet.');
    }
    const sheetId = extractSheetId(sheetUrl);

    const writeResult = await callAppsScript({
        appsScriptUrl,
        method: 'POST',
        payload: {
            action: 'updateSalePrice',
            sheetId,
            sheetName,
            rowNumber: Number(rowNumber),
            price: Number(price),
        },
        fetchImpl,
    });

    return writeResult;
}

module.exports = {
    extractSheetId,
    isLikelyProductDetailUrl,
    scoreProductUrl,
    searchProductLinks,
    extractProductPrice,
    processPricingRow,
    loadModelMapping,
    readSheetRows,
    writeSheetUpdates,
    listSpreadsheetSheets,
    extractSheetNamesFromSpreadsheetHtml,
    startBackgroundPricingJob,
    getBackgroundPricingJobStatus,
    stopBackgroundPricingJob,
    normalizeSelectedSheetNames,
    isModelMatch,
    isFakePrice,
    syncHaravanIds,
    loadHaravanMapping,
    updateHaravanVariantPrice,
    sendTelegramNotification,
    writeHaravanLog,
    updateSheetSalePrice,
    pricingCache,
};
