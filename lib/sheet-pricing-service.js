const {
    parseVietnamesePrice,
    normalizeModelText,
    computeSuggestedPricing,
    mapSheetHeaders,
    buildSheetUpdateRow,
    normalizeVietnameseText,
} = require('./sheet-pricing-utils.js');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const OPERA_MINI_USER_AGENT = 'Opera/9.80 (Android; Opera Mini/36.1.2254/191.293; U; en) Presto/2.12.423 Version/12.16';

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

function splitModelToken(value = '') {
    const normalized = normalizeModelText(value);
    const match = normalized.match(/^([A-Z]*)(\d+)([A-Z0-9]*)$/);
    if (!match) return null;
    return {
        prefix: match[1] || '',
        digits: match[2] || '',
        suffix: match[3] || '',
    };
}

function hasConflictingModelSuffix(text = '', model = '') {
    const modelParts = splitModelToken(model);
    if (!modelParts || !modelParts.digits) return false;

    const tokens = normalizeVietnameseText(text).toUpperCase().match(/[A-Z0-9]+/g) || [];
    for (const token of tokens) {
        const tokenParts = splitModelToken(token);
        if (!tokenParts) continue;
        if (tokenParts.digits !== modelParts.digits) continue;
        if (modelParts.prefix && tokenParts.prefix !== modelParts.prefix) continue;
        if (!modelParts.suffix && tokenParts.suffix) {
            return true;
        }
        if (!tokenParts.suffix || !modelParts.suffix) continue;
        if (tokenParts.suffix === modelParts.suffix) continue;
        if (tokenParts.suffix.startsWith(modelParts.suffix) || modelParts.suffix.startsWith(tokenParts.suffix)) {
            continue;
        }
        return true;
    }

    return false;
}

function isModelMatch(titleOrUrl, model, brand = '') {
    const normText = normalizeModelText(titleOrUrl);
    const normModel = normalizeModelText(model);
    if (!normModel) return false;
    
    // 1. Exact inclusion match with digit boundary safety
    if (normText.includes(normModel)) {
        const startIdx = normText.indexOf(normModel);
        const endIdx = startIdx + normModel.length;
        const prevChar = startIdx > 0 ? normText[startIdx - 1] : '';
        const nextChar = endIdx < normText.length ? normText[endIdx] : '';
        
        const isPrevDigit = /\d/.test(prevChar);
        const isNextDigit = /\d/.test(nextChar);
        if (!isPrevDigit && !isNextDigit) {
            if (!hasConflictingModelSuffix(titleOrUrl, model)) {
                return true;
            }
        }
    }

    // 2. Extract digits only from model with strict digit regex boundary
    const modelDigits = normModel.replace(/\D/g, '');
    const textDigits = normText.replace(/\D/g, '');
    
    if (modelDigits.length >= 3) {
        const digitRegex = new RegExp(`(?<!\\d)${modelDigits}(?!\\d)`);
        if (digitRegex.test(normText)) {
            if (!hasConflictingModelSuffix(titleOrUrl, model)) {
                return true;
            }
        }
    }

    // 3. Match by individual significant segments (length >= 3)
    const segments = String(model)
        .split(/[\s-_]+/)
        .map(normalizeModelText)
        .filter(s => s.length >= 3);

    if (segments.length > 0) {
        // Check if the longest segment is in the text
        const longestSegment = segments.reduce((longest, current) => current.length > longest.length ? current : longest, '');
        if (longestSegment && normText.includes(longestSegment)) {
            const startIdx = normText.indexOf(longestSegment);
            const endIdx = startIdx + longestSegment.length;
            const prevChar = startIdx > 0 ? normText[startIdx - 1] : '';
            const nextChar = endIdx < normText.length ? normText[endIdx] : '';
            
            const isPrevDigit = /\d/.test(prevChar);
            const isNextDigit = /\d/.test(nextChar);
            if (!isPrevDigit && !isNextDigit) {
                if (!hasConflictingModelSuffix(titleOrUrl, model)) {
                    return true;
                }
            }
        }
    }

    // 4. Brand-aware matching (Lenient check when brand is present and matched)
    if (brand) {
        const normBrand = normalizeModelText(brand);
        if (normBrand && normText.includes(normBrand)) {
            if (hasConflictingModelSuffix(titleOrUrl, model)) {
                return false;
            }
            if (modelDigits.length >= 3 && textDigits.length >= 3) {
                // If modelDigits has a common subsequence of length >= 3 with textDigits
                if (modelDigits.includes(textDigits)) {
                    return true;
                }
                
                // Check prefix of digits (e.g. 87131 vs 871)
                const prefixLength = Math.min(4, modelDigits.length, textDigits.length);
                if (prefixLength >= 3) {
                    const modelPrefix = modelDigits.slice(0, prefixLength);
                    const textPrefix = textDigits.slice(0, prefixLength);
                    if (modelPrefix === textPrefix) {
                        if (modelDigits.length >= textDigits.length) {
                            return true;
                        }
                    }
                }
            }
        }
    }

    return false;
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
            }
        }
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

async function fetchHtml(url, { timeout = 15000, fetchImpl = fetch, userAgent = DEFAULT_USER_AGENT } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'user-agent': userAgent,
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
    const queryPrice = encodeURIComponent(`${brand} ${model} giá`);
    const links = [];
    const seen = new Set();

    const fetchGoogleQuery = async (q) => {
        try {
            const html = await fetchHtml(`https://www.google.com/search?hl=vi&num=${Math.max(limit, 40)}&q=${q}`, {
                fetchImpl,
                timeout: 10000,
                userAgent: OPERA_MINI_USER_AGENT,
            });
            const cheerio = getCheerio();
            const $ = cheerio.load(html);
            const res = [];
            $('a[href]').each((_, element) => {
                const href = $(element).attr('href');
                const normalizedUrl = normalizeSearchHref(href);
                if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                    res.push(normalizedUrl);
                }
            });
            return res;
        } catch {
            return [];
        }
    };

    const fetchDDG = async () => {
        try {
            const ddgUrl = `https://html.duckduckgo.com/html/?q=${query}`;
            const html = await fetchHtml(ddgUrl, { fetchImpl, timeout: 10000 });
            const cheerio = getCheerio();
            const $ = cheerio.load(html);
            const res = [];

            $('.result__url').each((_, element) => {
                let href = $(element).text().trim();
                if (href) {
                    if (!href.startsWith('http')) {
                        href = 'https://' + href;
                    }
                    res.push(href);
                }
            });

            $('.result__a').each((_, element) => {
                let href = $(element).attr('href');
                if (href) {
                    if (href.includes('uddg=')) {
                        try {
                            const parsed = new URL(`https://duckduckgo.com${href}`);
                            const realUrl = parsed.searchParams.get('uddg');
                            if (realUrl) {
                                res.push(realUrl);
                            }
                        } catch {}
                    } else if (href.startsWith('http') && !href.includes('duckduckgo.com')) {
                        res.push(href);
                    }
                }
            });
            return res;
        } catch {
            return [];
        }
    };

    const fetchBing = async () => {
        try {
            const bingUrl = `https://www.bing.com/search?q=${query}&count=${Math.max(limit, 50)}`;
            const html = await fetchHtml(bingUrl, { fetchImpl, timeout: 10000 });
            const cheerio = getCheerio();
            const $ = cheerio.load(html);
            const res = [];

            $('cite').each((_, element) => {
                let href = $(element).text().trim();
                if (href) {
                    href = href.split(' ')[0].trim();
                    if (!href.startsWith('http')) {
                        href = 'https://' + href;
                    }
                    const normalizedUrl = normalizeSearchHref(href);
                    if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                        res.push(normalizedUrl);
                    }
                }
            });

            $('#b_results .b_algo h2 a').each((_, element) => {
                const href = $(element).attr('href');
                const normalizedUrl = normalizeSearchHref(href);
                if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                    res.push(normalizedUrl);
                }
            });
            return res;
        } catch {
            return [];
        }
    };

    const fetchCocCoc = async () => {
        try {
            const coccocUrl = `https://coccoc.com/search?q=${query}`;
            const html = await fetchHtml(coccocUrl, { fetchImpl, timeout: 10000 });
            const cheerio = getCheerio();
            const $ = cheerio.load(html);
            const res = [];

            $('a[href]').each((_, element) => {
                const href = $(element).attr('href');
                const normalizedUrl = normalizeSearchHref(href);
                if (normalizedUrl && /^https?:\/\//i.test(normalizedUrl)) {
                    res.push(normalizedUrl);
                }
            });
            return res;
        } catch {
            return [];
        }
    };

    const searchTasks = [
        fetchGoogleQuery(query),
        fetchGoogleQuery(queryPrice),
        fetchDDG(),
        fetchBing(),
        fetchCocCoc()
    ];
    const searchResults = await Promise.allSettled(searchTasks);

    const lists = searchResults.map(r => r.status === 'fulfilled' ? r.value : []);
    
    // Order: Google1, Google2, CocCoc, Bing, DDG
    const order = [0, 1, 4, 3, 2];
    order.forEach(idx => {
        lists[idx].forEach(url => {
            if (url && !seen.has(url)) {
                seen.add(url);
                links.push(url);
            }
        });
    });

    return links.slice(0, limit * 2);
}

function isFakePrice(parsedPrice, model) {
    if (!model) return false;
    const modelDigits = normalizeModelText(model).replace(/\D/g, '');
    if (modelDigits.length < 3) return false;

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

function collectPriceCandidates($, referencePrice, model = '') {
    const candidates = [];
    const looksLikePriceText = (text) => {
        const value = String(text || '').trim().toLowerCase();
        if (!value) return false;
        if (/(hotline|tel|phone|zalo)/i.test(value)) return false;
        if (/[₫đ]|vnd|vnđ/.test(value)) return true;
        // Support spaces, dots, or commas as thousands separators
        return /\b\d{1,3}(?:[.,\s]\d{3}){1,}\b/.test(value);
    };

    const isFakePriceText = (text) => {
        const val = String(text || '').toLowerCase();
        if (val.length > 25) return true;
        if (/(công suất|lưỡi dao|cối xay|dung tích|w|lít|lit|chén|toàn quốc|phí ship|vận chuyển|đánh giá|sản phẩm|mã|sku|model|hiệu)/i.test(val)) return true;
        return false;
    };

    const refPrice = parseVietnamesePrice(referencePrice);
    const minRange = refPrice ? Math.max(100000, refPrice * 0.55) : 100000;
    const maxRange = refPrice ? Math.min(200000000, refPrice * 1.65) : 200000000;

    // 1. JSON-LD Schema Parsing (Global Document Level)
    const extractPricesFromJsonLd = (obj) => {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            obj.forEach(extractPricesFromJsonLd);
            return;
        }

        if (obj['@type'] === 'Offer' || obj['@type'] === 'Product' || obj['@type'] === 'AggregateOffer' || obj.price !== undefined || obj.lowPrice !== undefined || obj.highPrice !== undefined) {
            const currency = obj.priceCurrency;
            if (!currency || /vnd/i.test(String(currency))) {
                const pricesToTry = [obj.price, obj.lowPrice, obj.highPrice].filter(p => p !== undefined && p !== null);
                for (const pVal of pricesToTry) {
                    const parsed = parseVietnamesePrice(pVal);
                    if (parsed && parsed >= minRange && parsed <= maxRange) {
                        if (isFakePrice(parsed, model)) continue;
                        if (!candidates.includes(parsed)) {
                            candidates.push(parsed);
                        }
                    }
                }
            }
        }

        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    extractPricesFromJsonLd(obj[key]);
                }
            }
        }
    };

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const text = $(el).html();
            if (text) {
                const data = JSON.parse(text);
                extractPricesFromJsonLd(data);
            }
        } catch {}
    });

    // 2. Global Metadata/Meta Price tags (Global Document Level, excluding related items)
    const globalSelectors = [
        'meta[property="product:price:amount"]',
        'meta[property="og:price:amount"]',
        'meta[name="twitter:data1"]',
        '[itemprop="price"]',
    ];

    globalSelectors.forEach((selector) => {
        $('html').find(selector).each((_, element) => {
            const isRelated = $(element).closest('.related, .upsell, .cross-sell, .recommend, .suggested, .product-slider, .similar, .may-like, [class*="related"], [class*="upsell"], [class*="recommend"], [class*="similar"]').length > 0;
            if (isRelated) return;

            if (selector === 'meta[name="twitter:data1"]') {
                const label = $('meta[name="twitter:label1"]').attr('content') || '';
                if (!/gia|price/i.test(label)) return;
            }

            const value = $(element).attr('content') || $(element).attr('value') || $(element).text();
            const parsed = parseVietnamesePrice(value);
            if (parsed && parsed >= minRange && parsed <= maxRange) {
                if (isFakePrice(parsed, model)) return;
                if (!candidates.includes(parsed)) {
                    candidates.push(parsed);
                }
            }
        });
    });

    // 3. Anchor DOM Scoping to H1
    let context = $('body');
    const h1 = $('h1').first();
    if (h1.length > 0) {
        let found = false;
        const mainContainers = [
            '.entry-summary',
            '.product-info',
            '.product-essential',
            '.product-single',
            '.product-detail',
            '.product-details',
            '.summary',
            'form.cart',
            '[itemtype*="Product"]',
            '.product',
        ];
        
        for (const selector of mainContainers) {
            const el = h1.closest(selector);
            if (el.length > 0) {
                context = el.first();
                found = true;
                break;
            }
        }

        if (!found) {
            let p = h1.parent();
            for (let i = 0; i < 3 && p.length > 0 && p[0].name !== 'body' && p[0].name !== 'html'; i++) {
                context = p;
                p = p.parent();
            }
        }
    } else {
        const mainContainers = [
            '.entry-summary',
            '.product-info',
            '.product-essential',
            '.product-single',
            '.product-detail',
            '.product-details',
            '.summary',
            'form.cart',
            '[itemtype*="Product"]',
            '.product',
        ];
        for (const selector of mainContainers) {
            const el = $(selector);
            if (el.length > 0) {
                context = el.first();
                break;
            }
        }
    }

    // 4. Scoped Selector Matching inside Context
    const selectorList = [
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
    ];

    selectorList.forEach((selector) => {
        let elements = context.find(selector);
        if (context.is(selector)) {
            elements = elements.add(context);
        }

        elements.each((_, element) => {
            const isRelated = $(element).closest('.related, .upsell, .cross-sell, .recommend, .suggested, .product-slider, .similar, .may-like, [class*="related"], [class*="upsell"], [class*="recommend"], [class*="similar"]').length > 0;
            if (isRelated) return;

            const isOriginalPrice = $(element).closest('del, .old-price, .compare-at-price, .original-price, .price-old, .price-compare').length > 0;
            if (isOriginalPrice) return;

            if ($(element).find('.amount, .woocommerce-Price-amount, .price-new, .sale-price, [itemprop="price"]').length > 0) {
                return;
            }

            const value = $(element).attr('content') || $(element).attr('value') || $(element).text();
            if (isFakePriceText(value)) return;
            if (!looksLikePriceText(value) && !$(element).attr('content')) return;
            const parsed = parseVietnamesePrice(value);
            if (parsed && parsed >= minRange && parsed <= maxRange) {
                if (isFakePrice(parsed, model)) return;
                if (!candidates.includes(parsed)) {
                    candidates.push(parsed);
                }
            }
        });
    });

    // 5. Scoped Leaf Nodes Text Matching (Fallback)
    if (candidates.length === 0) {
        let leafNodes = context.find('*');
        if (leafNodes.length === 0 && context.is('*')) {
            leafNodes = context;
        }

        leafNodes.each((_, element) => {
            if ($(element).children().length > 0) return;

            const isRelated = $(element).closest('.related, .upsell, .cross-sell, .recommend, .suggested, .product-slider, .similar, .may-like, [class*="related"], [class*="upsell"], [class*="recommend"], [class*="similar"]').length > 0;
            if (isRelated) return;

            const isOriginalPrice = $(element).closest('del, .old-price, .compare-at-price, .original-price, .price-old, .price-compare').length > 0;
            if (isOriginalPrice) return;

            const text = $(element).text();
            if (isFakePriceText(text)) return;
            const parentText = $(element).parent().text();
            const hasCurrency = /[₫đ]|vnd|vnđ|đồng/i.test(text) || /[₫đ]|vnd|vnđ|đồng/i.test(parentText);
            if (!hasCurrency) return;
            if (!looksLikePriceText(text)) return;
            const parsed = parseVietnamesePrice(text);
            if (parsed && parsed >= minRange && parsed <= maxRange) {
                if (isFakePrice(parsed, model)) return;
                if (!candidates.includes(parsed)) {
                    candidates.push(parsed);
                }
            }
        });
    }

    if (refPrice && candidates.length > 0) {
        candidates.sort((a, b) => Math.abs(a - refPrice) - Math.abs(b - refPrice));
    }

    return candidates;
}

function pickPriceFromScrapedProducts(products, model, brand, referencePrice) {
    const normalizedModel = normalizeModelText(model);
    if (!normalizedModel) return null;

    const refPrice = parseVietnamesePrice(referencePrice);
    const minRange = refPrice ? Math.max(100000, refPrice * 0.55) : 100000;
    const maxRange = refPrice ? Math.min(200000000, refPrice * 1.65) : 200000000;

    const enriched = (products || [])
        .map((product) => ({
            product,
            normalizedTitle: normalizeModelText(product.ten || ''),
            parsedPrice: parseVietnamesePrice(product.gia),
        }))
        .filter((entry) => entry.parsedPrice && entry.parsedPrice >= minRange && entry.parsedPrice <= maxRange && !isFakePrice(entry.parsedPrice, model));

    const exactMatch = enriched.find((entry) => isModelMatch(entry.product.ten || '', model, brand));
    if (exactMatch) return exactMatch.parsedPrice;

    return null;
}

async function extractProductPrice({ url, model, brand, referencePrice, fetchImpl = fetch }) {
    const html = await fetchHtml(url, { fetchImpl, timeout: 15000 });
    const cheerio = getCheerio();
    const $ = cheerio.load(html);

    const directCandidates = collectPriceCandidates($, referencePrice, model);
    
    // Construct a robust combined title for matching
    const titleTagText = $('title').first().text() || '';
    const h1Texts = $('h1').map((_, el) => $(el).text()).get().join(' ');
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const twitterTitle = $('meta[name="twitter:title"]').attr('content') || '';
    const combinedTitle = `${titleTagText} ${h1Texts} ${ogTitle} ${twitterTitle}`;

    const normalizedModel = normalizeModelText(model);

    if (normalizedModel) {
        const matchedTitle = isModelMatch(combinedTitle, model, brand);
        const matchedUrl = isModelMatch(url, model, brand);
        if (!matchedTitle && !matchedUrl) {
            return null;
        }
    }

    if (directCandidates.length > 0) {
        return directCandidates[0];
    }

    const scraped = getScraperCore().runCheerioScrape(html, url, 1, () => {});
    return pickPriceFromScrapedProducts(scraped, model, brand, referencePrice);
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
        referencePrice: row.salePrice,
    }));
    const shouldStop = typeof deps.shouldStop === 'function' ? deps.shouldStop : () => false;
    const linksConcurrency = Math.max(1, Number.parseInt(deps.linksConcurrency, 10) || 4);

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

    const discoveredLinks = await searchFn({
        brand: row.brand,
        model: row.model,
        limit: 20,
    });

    if (shouldStop()) {
        throw new Error('STOP_REQUESTED');
    }

    const filteredLinks = Array.from(new Set(
        discoveredLinks.filter((link) => isLikelyProductDetailUrl(link, row.model, row.brand))
    )).slice(0, 20);
    const matchedDetails = [];
    let cursor = 0;

    async function worker() {
        while (cursor < filteredLinks.length) {
            if (shouldStop()) {
                throw new Error('STOP_REQUESTED');
            }

            const currentIndex = cursor;
            cursor += 1;
            const url = filteredLinks[currentIndex];

            try {
                const price = await extractPriceFn(url, row);
                if (shouldStop()) {
                    throw new Error('STOP_REQUESTED');
                }
                if (price && price >= 100000 && price <= 200000000) {
                    matchedDetails.push({ url, price });
                }
            } catch (error) {
                if (error && error.message === 'STOP_REQUESTED') {
                    throw error;
                }
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(linksConcurrency, filteredLinks.length || 1) }, () => worker()));

    matchedDetails.sort((a, b) => a.price - b.price);
    const hasNewPrices = matchedDetails.length > 0;
    const finalPrices = hasNewPrices ? matchedDetails.map((d) => d.price) : (row.marketPrices || []);
    const pricing = computeSuggestedPricing({
        currentSalePrice: row.salePrice,
        prices: finalPrices,
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
        status: pricing.suggestedPrice ? 'success' : 'insufficient_prices',
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
            costPrice: row.values?.[mapping.costPrice] || '',
            salePrice: row.values?.[mapping.salePrice] || '',
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

    // Find the real sheet name for '18.Mã sản phẩm' in the sheet list to avoid encoding/normalization issues
    let targetSheetName = '18.Mã sản phẩm';
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
        // Fall back silently to '18.Mã sản phẩm'
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
        const codeIdx = headers.findIndex((h) => /ma san pham|ma sp/i.test(normalizeVietnameseText(h)));
        const modelIdx = headers.findIndex((h) => /model/i.test(normalizeVietnameseText(h)));

        const mapping = {};
        if (codeIdx !== -1 && modelIdx !== -1) {
            (data.rows || []).forEach((row) => {
                const code = String(row.values?.[codeIdx] || '').trim();
                const model = String(row.values?.[modelIdx] || '').trim();
                if (code && model) {
                    mapping[code] = model;
                }
            });
        }
        return mapping;
    } catch (err) {
        console.warn('Lỗi khi tải bảng ánh xạ 18.Mã sản phẩm:', err.message);
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
                    salePriceValue: parseVietnamesePrice(row.salePrice),
                    status: isValidBrand(row.brand) && isValidModel(row.model) ? 'pending' : 'skipped',
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

            const runnableRows = mergedRowsMapped.filter((row) => isValidBrand(row.brand) && isValidModel(row.model));
            job.totalRows = job.rows.length;

            const skippedRowsCount = job.rows.filter((r) => r.status === 'skipped').length;
            job.processedCount += skippedRowsCount;
            if (skippedRowsCount > 0) {
                log(`Bỏ qua ${skippedRowsCount} dòng do thiếu Thương hiệu, Model hoặc Model chỉ toàn số.`);
            }

            log(`Đã đọc ${job.rows.length} dòng từ Google Sheet. Có ${runnableRows.length} dòng hợp lệ để xử lý.`);
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

    try {
        const data = await callAppsScript({
            appsScriptUrl,
            method: 'GET',
            params: {
                action: 'readRows',
                sheetId,
                sheetName: '20. ID Haravan',
                startRow: 2,
                headerRow: 1,
            },
            fetchImpl,
        });

        const headers = data.headers || [];
        const brandIdx = headers.findIndex((h) => /thuong hieu/i.test(normalizeVietnameseText(h)));
        const modelIdx = headers.findIndex((h) => /model/i.test(normalizeVietnameseText(h)));
        const idIdx = headers.findIndex((h) => /id/i.test(normalizeVietnameseText(h)));

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
        console.warn('Lỗi khi tải bảng ánh xạ 20. ID Haravan:', err.message);
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

module.exports = {
    extractSheetId,
    isLikelyProductDetailUrl,
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
};
