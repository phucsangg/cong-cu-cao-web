const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');
const fs = require('fs');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to check if text is a valid price format
function checkIfPrice(text) {
    text = text.trim().toLowerCase();
    if (!text) return false;
    const numericOnly = text.replace(/\D/g, '');
    if (/^0\d{9}$/.test(numericOnly) || /^1800\d{4}$/.test(numericOnly) || /^1900\d{4}$/.test(numericOnly)) return false;
    const hasCurrency = text.includes('đ') || text.includes('₫') || text.includes('$') || text.includes('vnd') || text.includes('vnđ');
    const cleanText = text.replace(/[\d.,\sđ₫$%\-]/g, '').replace(/vnd|vnđ/g, '');
    if (cleanText.length > 0) return false;
    const hasDigit = /\d/.test(text);
    if (!hasDigit) return false;
    if (hasCurrency) {
        if (/[.,]\d$/.test(text.replace(/[^0-9.,]/g, '')) && !text.includes('$')) return false;
        return true;
    }
    return /^\d{1,3}([.,]\d{3})+$/.test(text);
}

// Helper to determine if an element's parent container is standard boilerplate / navigation to be excluded
const isExcluded = (id, className) => {
    const exclusions = [
        'menu', 'sidebar', 'footer', 'header', 'nav', 'aside', 'widget',
        'filter', 'banner', 'slider', 'carousel', 'breadcrumb', 'search',
        'cart', 'checkout', 'login', 'register', 'auth', 'social', 'share',
        'comment', 'review', 'rating', 'newsletter', 'subscribe', 'pagination'
    ];
    return exclusions.some(w => id.includes(w) || className.includes(w));
};

// Heuristic: get price text excluding crossed-out original prices
function getPriceText($, el) {
    const clone = $(el).clone();
    clone.find('.line, .old, .del, del, s').remove();
    clone.find('*').each((i, child) => {
        const style = $(child).attr('style') || '';
        if (style.includes('line-through')) {
            $(child).remove();
        }
    });
    return clone.text() ? clone.text().trim() : '';
}

// Check if a child represents crossed-out price
function isOriginalPriceEl($, el) {
    const className = $(el).attr('class') || '';
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    const style = $(el).attr('style') || '';
    if (className.includes('line') || className.includes('old') || className.includes('del') || tagName === 'del' || tagName === 's' || style.includes('line-through')) {
        return true;
    }
    return false;
}

// Cheerio-based DOM heuristic parser
function runCheerioScrape(html, url, pageNum, log) {
    const $ = cheerio.load(html);
    const results = [];
    const tuKhoaRac = [
        'chính sách', 'hướng dẫn', 'tin tức', 'liên hệ', 'bài viết',
        'giỏ hàng', 'tài khoản', 'showroom', 'tuyển dụng', 'địa chỉ',
        'hotline', 'góp ý', 'bảo hành', 'trả góp', 'thương hiệu',
        'nổi bật', 'cổ điển', 'xem thêm', 'danh mục', 'giới thiệu',
        'đăng ký', 'đăng nhập', 'tin công nghệ', 'hệ thống', 'sơ đồ'
    ];

    // 1. Process script-based prices (e.g. bepxanh.com productSaleSetup)
    let scriptProductsCount = 0;
    $('[class*="loadpro"]').each((i, el) => {
        const scriptText = $(el).find('script').text();
        let priceText = '';
        
        if (scriptText && scriptText.includes('productSaleSetup')) {
            const match = scriptText.match(/productSaleSetup\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']*)'/);
            if (match && match[1]) {
                const numericPrice = parseInt(match[1]) || 0;
                if (numericPrice > 0) {
                    priceText = numericPrice.toLocaleString('vi-VN') + ' ₫';
                }
            }
        }
        
        if (!priceText) return;
        
        let parent = $(el).parent();
        for (let step = 0; step < 5; step++) {
            if (!parent || parent.length === 0) break;
            const idP = parent.attr('id') || '';
            const cnP = parent.attr('class') || '';
            if (isExcluded(idP.toLowerCase(), cnP.toLowerCase())) break;
            
            const targetTitles = parent.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"],.title,.name,a').toArray();
            let titleText = '', titleHref = '';
            
            for (const titleNode of targetTitles) {
                const txt = $(titleNode).text() ? $(titleNode).text().replace(/\s+/g, ' ').trim() : '';
                if (txt && txt.length >= 8 && txt.length < 150 && !checkIfPrice(txt)) {
                    const isRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                    if (!isRac) {
                        titleText = txt;
                        let nl = $(titleNode);
                        for (let d = 0; d < 3; d++) {
                            if (nl && nl.length > 0 && nl[0].tagName.toLowerCase() === 'a') {
                                titleHref = nl.attr('href');
                                break;
                            }
                            if (nl) nl = nl.parent();
                        }
                        break;
                    }
                }
            }
            
            const images = parent.find('img').toArray();
            let imgSrc = '';
            for (const img of images) {
                const src = $(img).attr('src') || $(img).attr('data-src') ||
                    $(img).attr('data-original') || $(img).attr('lazy-src') ||
                    $(img).attr('data-lazy-src');
                if (src && !src.startsWith('data:image')) {
                    imgSrc = src;
                    break;
                }
            }
            
            if (!titleHref) {
                for (const link of parent.find('a').toArray()) {
                    const href = $(link).attr('href');
                    if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                        titleHref = href;
                        break;
                    }
                }
            }
            
            if (titleText) {
                const makeAbsolute = (u) => {
                    if (!u) return '';
                    if (u.startsWith('//')) return 'https:' + u;
                    if (!u.startsWith('http')) {
                        try { return new URL(u, url).href; } catch (e) {}
                    }
                    return u;
                };
                results.push({
                    ten: titleText,
                    gia: priceText,
                    trang: pageNum,
                    link: makeAbsolute(titleHref),
                    anh: makeAbsolute(imgSrc),
                    isOriginal: false
                });
                scriptProductsCount++;
                break;
            }
            parent = parent.parent();
        }
    });

    if (scriptProductsCount > 0) {
        log(`Đã phát hiện và giải mã ${scriptProductsCount} sản phẩm từ script-price (ví dụ: productSaleSetup).`);
    }

    // 2. Process text-based prices
    const allElements = $('*').toArray();
    const priceNodes = allElements.filter(el => {
        const text = getPriceText($, el);
        if (!checkIfPrice(text)) return false;
        
        const children = $(el).children().toArray();
        const childrenWithPrice = children.filter(c => checkIfPrice(($(c).text() || '').trim()));
        if (childrenWithPrice.length === 0) return true;
        return childrenWithPrice.every(c => isOriginalPriceEl($, c));
    });
    
    priceNodes.forEach(priceNode => {
        const rawPrice = getPriceText($, priceNode);
        let parent = $(priceNode).parent();
        
        const className = $(priceNode).attr('class') || '';
        const tagName = priceNode.tagName ? priceNode.tagName.toLowerCase() : '';
        const style = $(priceNode).attr('style') || '';
        const isOriginal = className.includes('line') || className.includes('old') || className.includes('del') || tagName === 'del' || tagName === 's' || style.includes('line-through');
        
        for (let step = 0; step < 5; step++) {
            if (!parent || parent.length === 0) break;
            const idP = parent.attr('id') || '';
            const cnP = parent.attr('class') || '';
            if (isExcluded(idP.toLowerCase(), cnP.toLowerCase())) break;
            
            const targetTitles = parent.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"],.title,.name,a').toArray();
            let titleText = '', titleHref = '';
            
            for (const titleNode of targetTitles) {
                const txt = $(titleNode).text() ? $(titleNode).text().replace(/\s+/g, ' ').trim() : '';
                if (txt && txt.length >= 8 && txt.length < 150 && txt !== rawPrice && !checkIfPrice(txt)) {
                    const isRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                    if (!isRac) {
                        titleText = txt;
                        let nl = $(titleNode);
                        for (let d = 0; d < 3; d++) {
                            if (nl && nl.length > 0 && nl[0].tagName.toLowerCase() === 'a') {
                                titleHref = nl.attr('href');
                                break;
                            }
                            if (nl) nl = nl.parent();
                        }
                        break;
                    }
                }
            }
            
            const images = parent.find('img').toArray();
            let imgSrc = '';
            for (const img of images) {
                const src = $(img).attr('src') || $(img).attr('data-src') ||
                    $(img).attr('data-original') || $(img).attr('lazy-src') ||
                    $(img).attr('data-lazy-src');
                if (src && !src.startsWith('data:image')) {
                    imgSrc = src;
                    break;
                }
            }
            
            if (!titleHref) {
                for (const link of parent.find('a').toArray()) {
                    const href = $(link).attr('href');
                    if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                        titleHref = href;
                        break;
                    }
                }
            }
            
            if (titleText) {
                const makeAbsolute = (u) => {
                    if (!u) return '';
                    if (u.startsWith('//')) return 'https:' + u;
                    if (!u.startsWith('http')) {
                        try { return new URL(u, url).href; } catch (e) {}
                    }
                    return u;
                };
                results.push({
                    ten: titleText,
                    gia: rawPrice,
                    trang: pageNum,
                    link: makeAbsolute(titleHref),
                    anh: makeAbsolute(imgSrc),
                    isOriginal
                });
                break;
            }
            parent = parent.parent();
        }
    });

    // De-duplicate
    const uniqueMap = new Map();
    results.forEach(sp => {
        const key = sp.link || sp.ten;
        if (!key) return;
        if (uniqueMap.has(key)) {
            const ex = uniqueMap.get(key);
            if (ex.isOriginal && !sp.isOriginal) {
                uniqueMap.set(key, sp);
            } else if (!ex.isOriginal && !sp.isOriginal) {
                const vn = parseInt(sp.gia.replace(/\D/g, '')) || 0;
                const ve = parseInt(ex.gia.replace(/\D/g, '')) || 0;
                if (vn > 0 && (ve === 0 || vn < ve)) uniqueMap.set(key, sp);
            }
        } else {
            uniqueMap.set(key, sp);
        }
    });

    return Array.from(uniqueMap.values());
}

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const query = event.queryStringParameters || {};
    const url = query.url;
    const paginationMode = query.paginationMode || 'url';
    const pageParam = query.pageParam || 'page';
    const pageNum = parseInt(query.pageNum) || 1;
    const isBlockResources = query.blockResources !== 'false';

    if (!url) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Lỗi: Thiếu link đường dẫn' })
        };
    }

    const logs = [];
    const log = (msg, level = 'info') => logs.push({ message: msg, level });

    log(`Bắt đầu trích xuất Trang ${pageNum}...`);

    // Build target URL
    let targetUrl = url.trim();
    if (pageNum > 1) {
        if (targetUrl.includes('?')) {
            const [base, qs] = targetUrl.split('?');
            const sp = new URLSearchParams(qs);
            sp.set(pageParam, pageNum);
            targetUrl = `${base}?${sp.toString()}`;
        } else {
            targetUrl = `${targetUrl}?${pageParam}=${pageNum}`;
        }
    }

    // ==== PATH 1: DIRECT HTTP FETCH + CHEERIO (Fast pathway, <2 seconds) ====
    try {
        log(`Thử tải trang trực tiếp qua HTTP GET...`);
        const fetchRes = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8'
            },
            signal: AbortSignal.timeout(10000) // 10 seconds timeout for direct fetch
        });

        if (fetchRes.ok) {
            const html = await fetchRes.text();
            log(`Tải trang thành công. Đang phân tích cú pháp HTML (Cheerio Heuristic)...`);
            const products = runCheerioScrape(html, targetUrl, pageNum, log);
            
            if (products.length >= 3) {
                log(`Thành công! Tìm thấy ${products.length} sản phẩm (qua kênh cào nhanh Cheerio).`, 'success');
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ products, logs })
                };
            } else {
                log(`Kênh cào nhanh tìm thấy ít sản phẩm (${products.length}). Chuyển sang trình duyệt ảo Puppeteer...`, 'warning');
            }
        } else {
            log(`Kênh cào nhanh lỗi HTTP ${fetchRes.status}. Chuyển sang trình duyệt ảo...`, 'warning');
        }
    } catch (fastErr) {
        log(`Cào nhanh không thành công hoặc timeout: ${fastErr.message}. Đang chuyển sang trình duyệt ảo...`, 'warning');
    }

    // ==== PATH 2: HEADLESS CHROMIUM + PUPPETEER (Fallback, 10-20 seconds) ====
    let browser = null;
    try {
        let executablePath;
        let launchArgs;
        let headless;

        // Thử dùng @sparticuz/chromium (serverless) trước, chỉ chạy trên AWS Lambda / Netlify production
        const isServerless = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) && process.env.NETLIFY_DEV !== 'true';
        if (isServerless) {
            try {
                log(`Đang chạy trên môi trường serverless. Đang tải thư viện trình duyệt ảo serverless...`);
                const chromiumModule = await import('@sparticuz/chromium');
                const chromium = chromiumModule.default || chromiumModule;
                const ep = await chromium.executablePath();
                if (ep) {
                    try { await fs.promises.access(ep); } catch { throw new Error(`File không tồn tại: ${ep}`); }
                    executablePath = ep;
                    launchArgs = [
                        ...chromium.args,
                        '--disable-blink-features=AutomationControlled',
                        '--disable-dev-shm-usage',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-gpu',
                        '--single-process',
                        '--no-zygote',
                        '--disable-extensions',
                        '--disable-background-networking',
                        '--disable-sync',
                        '--disable-translate',
                        '--hide-scrollbars',
                        '--mute-audio',
                        '--safebrowsing-disable-auto-update',
                    ];
                    headless = chromium.headless;
                }
            } catch (e) {
                log(`Không dùng được @sparticuz/chromium (${e.message}). Sẽ thử Chrome cài sẵn...`, 'warning');
            }
        } else {
            log(`Đang chạy trên môi trường local. Bỏ qua @sparticuz/chromium, dùng Chrome/Edge cài sẵn...`);
        }

        // Fallback: dùng Chrome cài sẵn trên máy
        if (!executablePath) {
            const localPaths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            ];
            for (const p of localPaths) {
                try {
                    await fs.promises.access(p);
                    executablePath = p;
                    break;
                } catch {}
            }
            // fallback: để puppeteer tự tìm
            if (!executablePath) {
                log('Không tìm thấy Chrome/Edge cài sẵn. Để Puppeteer tự tìm...', 'warning');
            }
            launchArgs = [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--single-process',
                '--no-zygote',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-sync',
                '--disable-translate',
                '--hide-scrollbars',
                '--mute-audio',
                '--safebrowsing-disable-auto-update',
            ];
            headless = true;
        }

        log(`Đang khởi động trình duyệt ảo (${executablePath || 'mặc định'})...`);
        browser = await puppeteer.launch({
            args: launchArgs,
            defaultViewport: { width: 1280, height: 720 },
            ...(executablePath ? { executablePath } : {}),
            headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Strict timeouts to prevent Netlify 502 (8 seconds navigation, 8 seconds selectors)
        await page.setDefaultNavigationTimeout(8000);
        await page.setDefaultTimeout(8000);
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8' });

        // Request interception for speed
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            try {
                if (req.isInterceptResolutionHandled()) return;
                const t = req.resourceType();
                const u = req.url().toLowerCase();
                if (
                    (isBlockResources && ['image', 'media', 'font', 'stylesheet'].includes(t)) ||
                    u.includes('google-analytics') || u.includes('googletagmanager') ||
                    u.includes('doubleclick') || u.includes('facebook') ||
                    u.includes('hotjar') || u.includes('pixel') ||
                    u.includes('analytics') || u.includes('adservice') ||
                    u.includes('clarity') || u.includes('zalo')
                ) {
                    req.abort().catch(() => {});
                } else {
                    req.continue().catch(() => {});
                }
            } catch (err) {
                req.continue().catch(() => {});
            }
        });

        log(`Trình duyệt ảo truy cập URL: ${targetUrl}`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        } catch (gotoErr) {
            log(`Cảnh báo: Trình duyệt ảo tải trang quá 8s. Tiến hành cào dữ liệu hiện tại...`, 'warning');
        }

        // Minimal scroll to activate lazy load: 5 steps * 100ms = 500ms
        log(`Cuộn trang ảo để tải các phần lười (lazy load)...`);
        await page.evaluate(async () => {
            const steps = 5;
            const dist = Math.ceil(document.body.scrollHeight / steps);
            for (let i = 0; i < steps; i++) {
                window.scrollBy(0, dist);
                await new Promise(r => setTimeout(r, 100));
            }
        });

        await sleep(200);

        log(`Đang chạy bóc tách dữ liệu heuristic trên trình duyệt ảo...`);
        let products = [];
        try {
            products = await page.evaluate((currentPageNum, currentUrl) => {
                const results = [];
                const tuKhoaRac = [
                    'chính sách', 'hướng dẫn', 'tin tức', 'liên hệ', 'bài viết',
                    'giỏ hàng', 'tài khoản', 'showroom', 'tuyển dụng', 'địa chỉ',
                    'hotline', 'góp ý', 'bảo hành', 'trả góp', 'thương hiệu',
                    'nổi bật', 'cổ điển', 'xem thêm', 'danh mục', 'giới thiệu',
                    'đăng ký', 'đăng nhập', 'tin công nghệ', 'hệ thống', 'sơ đồ'
                ];

                function checkIfPrice(text) {
                    text = text.trim().toLowerCase();
                    if (!text) return false;
                    const numericOnly = text.replace(/\D/g, '');
                    if (/^0\d{9}$/.test(numericOnly) || /^1800\d{4}$/.test(numericOnly) || /^1900\d{4}$/.test(numericOnly)) return false;
                    const hasCurrency = text.includes('đ') || text.includes('₫') || text.includes('$') || text.includes('vnd') || text.includes('vnđ');
                    const cleanText = text.replace(/[\d.,\sđ₫$%\-]/g, '').replace(/vnd|vnđ/g, '');
                    if (cleanText.length > 0) return false;
                    const hasDigit = /\d/.test(text);
                    if (!hasDigit) return false;
                    if (hasCurrency) {
                        if (/[.,]\d$/.test(text.replace(/[^0-9.,]/g, '')) && !text.includes('$')) return false;
                        return true;
                    }
                    return /^\d{1,3}([.,]\d{3})+$/.test(text);
                }

                const isExcluded = (id, className) => {
                    const exclusions = [
                        'menu', 'sidebar', 'footer', 'header', 'nav', 'aside', 'widget',
                        'filter', 'banner', 'slider', 'carousel', 'breadcrumb', 'search',
                        'cart', 'checkout', 'login', 'register', 'auth', 'social', 'share',
                        'comment', 'review', 'rating', 'newsletter', 'subscribe', 'pagination'
                    ];
                    return exclusions.some(w => id.includes(w) || className.includes(w));
                };

                function getPriceText(el) {
                    const clone = el.cloneNode(true);
                    const removeOldPrices = (node) => {
                        if (!node || !node.children) return;
                        Array.from(node.children).forEach(child => {
                            const cn = child.className ? String(child.className).toLowerCase() : '';
                            const tn = child.tagName ? String(child.tagName).toLowerCase() : '';
                            let lt = false;
                            try {
                                const cs = window.getComputedStyle(child);
                                lt = cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through');
                            } catch (e) {}
                            if (cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's' || lt) {
                                try { node.removeChild(child); } catch (e) {}
                            } else {
                                removeOldPrices(child);
                            }
                        });
                    };
                    removeOldPrices(clone);
                    return clone.innerText ? clone.innerText.trim() : '';
                }

                function isOriginalPriceEl(el) {
                    const cn = el.className ? String(el.className).toLowerCase() : '';
                    const tn = el.tagName ? String(el.tagName).toLowerCase() : '';
                    if (cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's') return true;
                    try {
                        const cs = window.getComputedStyle(el);
                        if (cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through')) return true;
                    } catch (e) {}
                    return false;
                }

                const allElements = Array.from(document.querySelectorAll('*'));
                const priceNodes = allElements.filter(el => {
                    const text = getPriceText(el);
                    if (!checkIfPrice(text)) return false;
                    const children = Array.from(el.children);
                    const childrenWithPrice = children.filter(c => checkIfPrice((c.innerText || '').trim()));
                    if (childrenWithPrice.length === 0) return true;
                    return childrenWithPrice.every(c => isOriginalPriceEl(c));
                });

                priceNodes.forEach(priceNode => {
                    const rawPrice = getPriceText(priceNode);
                    let parent = priceNode.parentElement;

                    const cn = priceNode.className ? String(priceNode.className).toLowerCase() : '';
                    const tn = priceNode.tagName ? String(priceNode.tagName).toLowerCase() : '';
                    let lt = false;
                    try {
                        const cs = window.getComputedStyle(priceNode);
                        lt = cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through');
                    } catch (e) {}
                    const isOriginal = cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's' || lt;

                    for (let step = 0; step < 5; step++) {
                        if (!parent) break;
                        const idP = parent.id ? String(parent.id).toLowerCase() : '';
                        const cnP = parent.className ? String(parent.className).toLowerCase() : '';
                        if (isExcluded(idP, cnP)) break;

                        const targetTitles = Array.from(parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"],.title,.name,a'));
                        let titleText = '', titleHref = '';

                        for (const titleNode of targetTitles) {
                            const txt = titleNode.innerText ? titleNode.innerText.replace(/\s+/g, ' ').trim() : '';
                            if (txt && txt.length >= 8 && txt.length < 150 && txt !== rawPrice && !checkIfPrice(txt)) {
                                const isRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                                if (!isRac) {
                                    titleText = txt;
                                    let nl = titleNode;
                                    for (let i = 0; i < 3; i++) {
                                        if (nl && nl.tagName === 'A') { titleHref = nl.getAttribute('href'); break; }
                                        if (nl) nl = nl.parentElement;
                                    }
                                    break;
                                }
                            }
                        }

                        const images = Array.from(parent.querySelectorAll('img'));
                        let imgSrc = '';
                        for (const img of images) {
                            const src = img.getAttribute('src') || img.getAttribute('data-src') ||
                                img.getAttribute('data-original') || img.getAttribute('lazy-src') ||
                                img.getAttribute('data-lazy-src');
                            if (src && !src.startsWith('data:image')) { imgSrc = src; break; }
                        }

                        if (!titleHref) {
                            for (const link of Array.from(parent.querySelectorAll('a'))) {
                                const href = link.getAttribute('href');
                                if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                                    titleHref = href; break;
                                }
                            }
                        }

                        if (titleText) {
                            const makeAbsolute = (u) => {
                                if (!u) return '';
                                if (u.startsWith('//')) return 'https:' + u;
                                if (!u.startsWith('http')) { try { return new URL(u, currentUrl).href; } catch (e) {} }
                                return u;
                            };
                            results.push({
                                ten: titleText,
                                gia: rawPrice,
                                trang: currentPageNum,
                                link: makeAbsolute(titleHref),
                                anh: makeAbsolute(imgSrc),
                                isOriginal
                            });
                            break;
                        }
                        parent = parent.parentElement;
                    }
                });

                return results;
            }, pageNum, page.url());
        } catch (evalErr) {
            log(`Lỗi khi chạy evaluate trên trình duyệt: ${evalErr.message}. Thử phân tích cú pháp HTML tĩnh từ trình duyệt...`, 'warning');
            try {
                const html = await page.content();
                products = runCheerioScrape(html, targetUrl, pageNum, log);
            } catch (cheerioErr) {
                log(`Lỗi khi phân tích cú pháp HTML tĩnh từ trình duyệt: ${cheerioErr.message}`, 'error');
                throw evalErr;
            }
        }

        // De-duplicate
        const uniqueMap = new Map();
        products.forEach(sp => {
            const key = sp.link || sp.ten;
            if (!key) return;
            if (uniqueMap.has(key)) {
                const ex = uniqueMap.get(key);
                if (ex.isOriginal && !sp.isOriginal) { uniqueMap.set(key, sp); }
                else if (!ex.isOriginal && !sp.isOriginal) {
                    const vn = parseInt(sp.gia.replace(/\D/g, '')) || 0;
                    const ve = parseInt(ex.gia.replace(/\D/g, '')) || 0;
                    if (vn > 0 && (ve === 0 || vn < ve)) uniqueMap.set(key, sp);
                }
            } else {
                uniqueMap.set(key, sp);
            }
        });

        const uniqueProducts = Array.from(uniqueMap.values());
        log(`Trình duyệt ảo hoàn thành. Tìm thấy ${uniqueProducts.length} sản phẩm.`, 'success');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ products: uniqueProducts, logs })
        };

    } catch (error) {
        log(`Lỗi trình duyệt ảo: ${error.message}`, 'error');
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message, logs })
        };
    } finally {
        if (browser !== null) {
            await browser.close().catch(() => {});
        }
    }
};
