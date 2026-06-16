const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.handler = async (event, context) => {
    // Prevent Lambda from waiting for event loop to drain
    context.callbackWaitsForEmptyEventLoop = false;

    const chromiumModule = await import('@sparticuz/chromium');
    const chromium = chromiumModule.default || chromiumModule;

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // Handle CORS preflight
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

    let browser = null;
    try {
        log(`Đang khởi động trình duyệt (serverless)...`);
        browser = await puppeteer.launch({
            args: [
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
            ],
            defaultViewport: { width: 1280, height: 720 },
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        // Faster timeout: 12s navigation, 12s for selectors
        await page.setDefaultNavigationTimeout(12000);
        await page.setDefaultTimeout(12000);
        await page.setUserAgent(
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8' });

        // Block heavy resources (+ stylesheets to speed up render)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const t = req.resourceType();
            const u = req.url().toLowerCase();
            if (
                ['image', 'media', 'font', 'stylesheet'].includes(t) ||
                u.includes('google-analytics') || u.includes('googletagmanager') ||
                u.includes('doubleclick') || u.includes('facebook') ||
                u.includes('hotjar') || u.includes('pixel') ||
                u.includes('analytics') || u.includes('adservice') ||
                u.includes('clarity') || u.includes('zalo')
            ) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Build target URL for pagination
        let targetUrl = url.trim();
        if (pageNum > 1) {
            if (paginationMode === 'url') {
                // URL param mode: append page param
                if (targetUrl.includes('?')) {
                    const [base, qs] = targetUrl.split('?');
                    const sp = new URLSearchParams(qs);
                    sp.set(pageParam, pageNum);
                    targetUrl = `${base}?${sp.toString()}`;
                } else {
                    targetUrl = `${targetUrl}?${pageParam}=${pageNum}`;
                }
            } else {
                // Button/AJAX mode: try appending page param as fallback
                // (clicking N-1 times is too slow for serverless)
                if (targetUrl.includes('?')) {
                    const [base, qs] = targetUrl.split('?');
                    const sp = new URLSearchParams(qs);
                    sp.set(pageParam, pageNum);
                    targetUrl = `${base}?${sp.toString()}`;
                } else {
                    targetUrl = `${targetUrl}?${pageParam}=${pageNum}`;
                }
                log(`Chế độ button: dùng URL param thay thế (serverless không hỗ trợ click chuỗi).`, 'warning');
            }
        }

        log(`Truy cập: ${targetUrl}`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
        } catch (gotoErr) {
            log(`Cảnh báo: Tải trang quá ${12000}ms. Tiến hành trích xuất dữ liệu hiện có...`, 'warning');
        }

        // Minimal scroll: 5 steps × 200ms = 1s total
        log(`Cuộn trang để kích hoạt lazy-load...`);
        await page.evaluate(async () => {
            const steps = 5;
            const dist = Math.ceil(document.body.scrollHeight / steps);
            for (let i = 0; i < steps; i++) {
                window.scrollBy(0, dist);
                await new Promise(r => setTimeout(r, 150));
            }
        });

        await sleep(300);

        // Extract products using Heuristic DOM analysis
        log(`Phân tích DOM trích xuất dữ liệu...`);
        const products = await page.evaluate((currentPageNum, currentUrl) => {
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
        log(`Trang ${pageNum}: tìm thấy ${uniqueProducts.length} sản phẩm.`, 'success');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ products: uniqueProducts, logs })
        };

    } catch (error) {
        log(`Lỗi nghiêm trọng: ${error.message}`, 'error');
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
