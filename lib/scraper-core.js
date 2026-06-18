const cheerio = require('cheerio');
const fs = require('fs');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to check if a URL is a homepage
function isHomepage(urlStr) {
    try {
        const parsed = new URL(urlStr);
        const path = parsed.pathname.toLowerCase();
        return path === '/' || path === '' || path === '/index.html' || path === '/index.php' || path === '/index.htm';
    } catch (e) {
        return false;
    }
}

// Helper to check if a category link matches the user's target product categories
function matchesCategory(text, path) {
    const cleanText = (text || '').toLowerCase().trim();
    const cleanPath = (path || '').toLowerCase().trim();
    
    const keywords = [
        'bếp', 'bep', 'gas', 'ga', 'hút mùi', 'hut mui', 'rửa chén', 'rua chen', 'rửa bát', 'rua bat',
        'lò nướng', 'lo nuong', 'vi sóng', 'vi song', 'chậu', 'chau', 'vòi', 'voi', 'tủ lạnh', 'tu lanh',
        'máy giặt', 'may giat', 'máy sấy', 'may say', 'nồi', 'noi', 'chảo', 'chao', 'siêu tốc', 'sieu toc',
        'máy xay', 'may xay', 'máy ép', 'may ep', 'bàn ủi', 'ban ui', 'bàn là', 'ban la', 'hút bụi', 'hut bui',
        'quạt', 'quat', 'gia dụng', 'gia dung', 'tủ đông', 'tu dong', 'lò vi sóng', 'lo vi song', 'chén bát',
        'chen bat', 'chậu rửa', 'chau rua', 'vòi rửa', 'voi rua', 'âm tủ', 'am tu'
    ];

    return keywords.some(kw => cleanText.includes(kw) || cleanPath.includes(kw.replace(/\s+/g, '-')));
}

// Helper to extract category links using Cheerio
function extractCategoryLinksCheerio(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();
    let hostname = '';
    try {
        hostname = new URL(baseUrl).hostname;
    } catch (e) {
        return [];
    }

    const selector = 'nav a, #nav a, [id*="nav"] a, [class*="nav"] a, [id*="menu"] a, [class*="menu"] a, [id*="category"] a, [class*="category"] a, [id*="categories"] a, [class*="categories"] a, .megamenu a';

    $(selector).each((i, el) => {
        let href = $(el).attr('href');
        if (!href) return;
        href = href.trim();
        if (href.startsWith('javascript:') || href.startsWith('#')) return;

        let absoluteUrl = '';
        try {
            absoluteUrl = new URL(href, baseUrl).href;
        } catch (e) {
            return;
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(absoluteUrl);
        } catch (e) {
            return;
        }

        if (parsedUrl.hostname !== hostname) return;

        const path = parsedUrl.pathname.toLowerCase();
        
        // Match user requested product categories only
        const txt = $(el).text() || '';
        if (!matchesCategory(txt, path)) return;

        // Exclude standard non-category pages
        const exclusions = [
            '/tin-tuc', '/lien-he', '/gioi-thieu', '/cart', '/checkout', '/login', 
            '/register', '/account', '/search', '/tin-cong-nghe', '/chinh-sach',
            '/huong-dan', '/tuyen-dung', '/show-room', '/bao-hanh', '/tra-gop',
            '/he-thong-dai-ly', '/hinh-thuc-mua-hang', '/hinh-thuc-thanh-toan',
            '/dieu-khoan-su-dung', '/chinh-sach-bao-mat', '/chinh-sach-doi-tra',
            '/chinh-sach-giao-nhan', '/chinh-sach-bao-mat-thong-tin', '/taikhoan'
        ];
        
        if (path === '/' || path === '' || path === '/index.html' || path === '/index.php' || path === '/index.htm') return;
        
        if (exclusions.some(exc => path.includes(exc))) return;

        // Add URL without query string
        links.add(parsedUrl.origin + parsedUrl.pathname);
    });

    const uniqueLinks = Array.from(links);
    
    // Heuristic: filter out subcategory links if the parent category link exists.
    const filteredLinks = uniqueLinks.filter(url => {
        try {
            const p = new URL(url).pathname.replace('.html', '').toLowerCase();
            const hasParent = uniqueLinks.some(otherUrl => {
                if (otherUrl === url) return false;
                const otherP = new URL(otherUrl).pathname.replace('.html', '').toLowerCase();
                if (otherP.length >= p.length) return false;
                return p.startsWith(otherP + '-') || p.includes('/' + otherP + '-');
            });
            return !hasParent;
        } catch (e) {
            return true;
        }
    });

    // Limit to max 150 categories to protect client execution
    return filteredLinks.slice(0, 150);
}

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

// Helper to determine if an element is a layout container rather than a single product container
const isLayoutContainer = (id, className, tagName) => {
    const t = (tagName || '').toLowerCase();
    if (t === 'body' || t === 'html' || t === 'main' || t === 'section' || t === 'article' || t === 'aside' || t === 'header' || t === 'footer') {
        return true;
    }
    const c = (className || '').toLowerCase();
    const i = (id || '').toLowerCase();
    
    if (c.includes('item') || i.includes('item') || c.includes('col-') || i.includes('col-')) {
        return false;
    }
    
    const layoutTerms = ['grid', 'row', 'list', 'layout', 'content', 'body', 'main', 'wrapper'];
    return layoutTerms.some(w => c.includes(w) || i.includes(w));
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

// Helper to find DOM distance between two elements in Cheerio
function getCheerioDistance(nodeA, nodeB) {
    const pathA = [];
    let currA = nodeA;
    while (currA) {
        pathA.push(currA);
        currA = currA.parent;
    }

    const pathB = [];
    let currB = nodeB;
    while (currB) {
        pathB.push(currB);
        currB = currB.parent;
    }

    let lca = null;
    let indexA = -1;
    let indexB = -1;

    for (let i = 0; i < pathA.length; i++) {
        const idx = pathB.indexOf(pathA[i]);
        if (idx !== -1) {
            lca = pathA[i];
            indexA = i;
            indexB = idx;
            break;
        }
    }

    if (lca === null) return Infinity;
    return indexA + indexB;
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
        'đăng ký', 'đăng nhập', 'tin công nghệ', 'hệ thống', 'sơ đồ',
        'khuyến mãi', 'khuyen mai', 'ưu đãi', 'uu dai', 'nhập mã', 'nhap ma',
        'mã giảm giá', 'ma giam gia', 'quà tặng', 'qua tang', 'thông số', 'thong so',
        'kỹ thuật', 'ky thuat', 'mô tả', 'mo ta', 'chi tiết', 'chi tiet', 'đặc điểm', 'dac diem'
    ];

    // 1. Process script-based prices (e.g. bepxanh.com productSaleSetup)
    let scriptProductsCount = 0;
    $('script').each((i, el) => {
        const scriptText = $(el).text();
        if (scriptText && scriptText.includes('productSaleSetup')) {
            let priceText = '';
            const match = scriptText.match(/productSaleSetup\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']*)'/);
            if (match && match[1]) {
                const numericPrice = parseInt(match[1]) || 0;
                if (numericPrice > 0) {
                    priceText = numericPrice.toLocaleString('vi-VN') + ' ₫';
                }
            }
            
            if (!priceText) return;
            
            let parent = $(el).parent();
            for (let step = 0; step < 5; step++) {
                if (!parent || parent.length === 0) break;
                const idP = parent.attr('id') || '';
                const cnP = parent.attr('class') || '';
                const tagP = parent.prop('tagName') || '';
                if (isExcluded(idP.toLowerCase(), cnP.toLowerCase()) || isLayoutContainer(idP, cnP, tagP)) break;
                
                const targetTitles = parent.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"],.title,.name,a').toArray();
                let candidates = [];
                for (const titleNode of targetTitles) {
                    const txt = $(titleNode).text() ? $(titleNode).text().replace(/\s+/g, ' ').trim() : '';
                    if (txt && txt.length >= 8 && txt.length < 150 && !checkIfPrice(txt)) {
                        const isRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                        if (!isRac) {
                            const dist = getCheerioDistance(el, titleNode);
                            candidates.push({ node: titleNode, text: txt, dist });
                        }
                    }
                }
                
                let titleText = '', titleHref = '';
                if (candidates.length > 0) {
                    candidates.sort((a, b) => a.dist - b.dist);
                    const best = candidates[0];
                    titleText = best.text;
                    let nl = $(best.node);
                    for (let d = 0; d < 3; d++) {
                        if (nl && nl.length > 0 && nl[0].tagName.toLowerCase() === 'a') {
                            titleHref = nl.attr('href');
                            break;
                        }
                        if (nl) nl = nl.parent();
                    }
                }
                
                if (titleText && !titleHref) {
                    let links = parent.find('a').toArray();
                    let bestLink = null;
                    let minLinkDist = Infinity;
                    for (const link of links) {
                        const href = $(link).attr('href');
                        if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                            const dist = getCheerioDistance(el, link);
                            if (dist < minLinkDist) {
                                minLinkDist = dist;
                                bestLink = href;
                            }
                        }
                    }
                    titleHref = bestLink || '';
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
                        anh: '',
                        isOriginal: false
                    });
                    scriptProductsCount++;
                    break;
                }
                parent = parent.parent();
            }
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
            const tagP = parent.prop('tagName') || '';
            if (isExcluded(idP.toLowerCase(), cnP.toLowerCase()) || isLayoutContainer(idP, cnP, tagP)) break;
            
            const targetTitles = parent.find('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"],.title,.name,a').toArray();
            let candidates = [];
            for (const titleNode of targetTitles) {
                const txt = $(titleNode).text() ? $(titleNode).text().replace(/\s+/g, ' ').trim() : '';
                if (txt && txt.length >= 8 && txt.length < 150 && txt !== rawPrice && !checkIfPrice(txt)) {
                    const isRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                    if (!isRac) {
                        const dist = getCheerioDistance(priceNode, titleNode);
                        candidates.push({ node: titleNode, text: txt, dist });
                    }
                }
            }
            
            let titleText = '', titleHref = '';
            if (candidates.length > 0) {
                candidates.sort((a, b) => a.dist - b.dist);
                const best = candidates[0];
                titleText = best.text;
                let nl = $(best.node);
                for (let d = 0; d < 3; d++) {
                    if (nl && nl.length > 0 && nl[0].tagName.toLowerCase() === 'a') {
                        titleHref = nl.attr('href');
                        break;
                    }
                    if (nl) nl = nl.parent();
                }
            }
            
            if (titleText && !titleHref) {
                let links = parent.find('a').toArray();
                let bestLink = null;
                let minLinkDist = Infinity;
                for (const link of links) {
                    const href = $(link).attr('href');
                    if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                        const dist = getCheerioDistance(priceNode, link);
                        if (dist < minLinkDist) {
                            minLinkDist = dist;
                            bestLink = href;
                        }
                    }
                }
                titleHref = bestLink || '';
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
                    anh: '',
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

// Unified Scrape Execution function
async function scrapeUrl(targetUrl, pageNum, options = {}, logCallback = console.log) {
    const isBlockResources = options.blockResources !== false;
    const log = (msg, level = 'info') => logCallback(msg, level);

    // ==== PATH 1: DIRECT HTTP FETCH + CHEERIO (Fast pathway) ====
    try {
        log(`Thử tải trang trực tiếp qua HTTP GET: ${targetUrl}...`);
        const fetchRes = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8'
            },
            signal: AbortSignal.timeout(options.timeout || 10000)
        });

        if (fetchRes.ok) {
            const html = await fetchRes.text();
            log(`Tải trang thành công. Đang phân tích cú pháp HTML (Cheerio Heuristic)...`);
            const products = runCheerioScrape(html, targetUrl, pageNum, log);
            
            if (products.length >= 8) {
                log(`Thành công! Tìm thấy ${products.length} sản phẩm (qua kênh cào nhanh Cheerio).`, 'success');
                const result = { products };
                if (isHomepage(targetUrl)) {
                    result.categoryLinks = extractCategoryLinksCheerio(html, targetUrl);
                }
                return result;
            } else {
                log(`Kênh cào nhanh tìm thấy ít sản phẩm (${products.length}). Chuyển sang trình duyệt ảo Puppeteer...`, 'warning');
            }
        } else {
            log(`Kênh cào nhanh lỗi HTTP ${fetchRes.status}. Chuyển sang trình duyệt ảo...`, 'warning');
        }
    } catch (fastErr) {
        log(`Cào nhanh không thành công hoặc timeout: ${fastErr.message}. Đang chuyển sang trình duyệt ảo...`, 'warning');
    }

    // ==== PATH 2: HEADLESS CHROMIUM + PUPPETEER (Fallback) ====
    let puppeteer;
    try {
        const puppeteerModule = await import('puppeteer-core');
        puppeteer = puppeteerModule.default || puppeteerModule;
    } catch (err) {
        throw new Error(`Không thể nạp puppeteer-core: ${err.message}`);
    }

    let browser = null;
    try {
        let executablePath;
        let launchArgs;
        let headless;

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

        // Fallback: local paths
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
            if (!executablePath) {
                log('Không tìm thấy Chrome/Edge cài sẵn. Để Puppeteer tự tìm...', 'warning');
            }
            launchArgs = [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
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
        
        await page.setDefaultNavigationTimeout(options.timeout || 15000);
        await page.setDefaultTimeout(options.timeout || 15000);
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8' });

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            try {
                if (req.isInterceptResolutionHandled()) return;
                const t = req.resourceType();
                const u = req.url().toLowerCase();
                if (
                    t === 'image' ||
                    (isBlockResources && ['media', 'font', 'stylesheet'].includes(t)) ||
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
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: options.timeout || 15000 });
        } catch (gotoErr) {
            log(`Cảnh báo: Trình duyệt ảo tải trang quá thời gian quy định. Tiến hành cào dữ liệu hiện tại...`, 'warning');
        }

        // Lazy load scroll
        try {
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
        } catch (scrollErr) {
            log(`Cảnh báo: Không thể cuộn trang ảo: ${scrollErr.message}`, 'warning');
        }

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
                    'đăng ký', 'đăng nhập', 'tin công nghệ', 'hệ thống', 'sơ đồ',
                    'khuyến mãi', 'khuyen mai', 'ưu đãi', 'uu dai', 'nhập mã', 'nhap ma',
                    'mã giảm giá', 'ma giam gia', 'quà tặng', 'qua tang', 'thông số', 'thong so',
                    'kỹ thuật', 'ky thuat', 'mô tả', 'mo ta', 'chi tiết', 'chi tiet', 'đặc điểm', 'dac diem'
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

                const isLayoutContainer = (id, className, tagName) => {
                    const t = (tagName || '').toLowerCase();
                    if (t === 'body' || t === 'html' || t === 'main' || t === 'section' || t === 'article' || t === 'aside' || t === 'header' || t === 'footer') {
                        return true;
                    }
                    const c = (className || '').toLowerCase();
                    const i = (id || '').toLowerCase();
                    if (c.includes('item') || i.includes('item') || c.includes('col-') || i.includes('col-')) {
                        return false;
                    }
                    const layoutTerms = ['grid', 'row', 'list', 'layout', 'content', 'body', 'main', 'wrapper'];
                    return layoutTerms.some(w => c.includes(w) || i.includes(w));
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

                function getDOMDistance(nodeA, nodeB) {
                    const pathA = [];
                    let currA = nodeA;
                    while (currA) {
                        pathA.push(currA);
                        currA = currA.parentElement;
                    }
                    const pathB = [];
                    let currB = nodeB;
                    while (currB) {
                        pathB.push(currB);
                        currB = currB.parentElement;
                    }
                    let lca = null;
                    let indexA = -1;
                    let indexB = -1;
                    for (let i = 0; i < pathA.length; i++) {
                        const idx = pathB.indexOf(pathA[i]);
                        if (idx !== -1) {
                            lca = pathA[i];
                            indexA = i;
                            indexB = idx;
                            break;
                        }
                    }
                    if (lca === null) return Infinity;
                    return indexA + indexB;
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
                        const tagP = parent.tagName ? String(parent.tagName).toLowerCase() : '';
                        if (isExcluded(idP, cnP) || isLayoutContainer(idP, cnP, tagP)) break;

                        const targetTitles = Array.from(parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="name"],.title,.name,a'));
                        let candidates = [];
                        for (const titleNode of targetTitles) {
                            const txt = titleNode.innerText ? titleNode.innerText.replace(/\s+/g, ' ').trim() : '';
                            if (txt && txt.length >= 8 && txt.length < 150 && txt !== rawPrice && !checkIfPrice(txt)) {
                                const isRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                                if (!isRac) {
                                    const dist = getDOMDistance(priceNode, titleNode);
                                    candidates.push({ node: titleNode, text: txt, dist });
                                }
                            }
                        }

                        let titleText = '', titleHref = '';
                        if (candidates.length > 0) {
                            candidates.sort((a, b) => a.dist - b.dist);
                            const best = candidates[0];
                            titleText = best.text;
                            let nl = best.node;
                            for (let i = 0; i < 3; i++) {
                                if (nl && nl.tagName === 'A') { titleHref = nl.getAttribute('href'); break; }
                                if (nl) nl = nl.parentElement;
                            }
                        }

                        if (titleText && !titleHref) {
                            let links = Array.from(parent.querySelectorAll('a'));
                            let bestLink = null;
                            let minLinkDist = Infinity;
                            for (const link of links) {
                                const href = link.getAttribute('href');
                                if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                                    const dist = getDOMDistance(priceNode, link);
                                    if (dist < minLinkDist) {
                                        minLinkDist = dist;
                                        bestLink = href;
                                    }
                                }
                            }
                            titleHref = bestLink || '';
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
                                anh: '',
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

        const result = { products: uniqueProducts };
        if (isHomepage(targetUrl)) {
            try {
                const html = await page.content();
                result.categoryLinks = extractCategoryLinksCheerio(html, targetUrl);
            } catch (contentErr) {
                log(`Không thể lấy HTML từ trình duyệt để trích xuất danh mục: ${contentErr.message}`, 'warning');
            }
        }
        return result;

    } catch (error) {
        log(`Lỗi trình duyệt ảo: ${error.message}`, 'error');
        throw error;
    } finally {
        if (browser !== null) {
            await browser.close().catch(() => {});
        }
    }
}

module.exports = {
    sleep,
    isHomepage,
    matchesCategory,
    extractCategoryLinksCheerio,
    checkIfPrice,
    isExcluded,
    isLayoutContainer,
    getPriceText,
    isOriginalPriceEl,
    getCheerioDistance,
    runCheerioScrape,
    scrapeUrl
};
