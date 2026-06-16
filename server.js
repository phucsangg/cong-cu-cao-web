const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hàm gửi dữ liệu EventStream (SSE)
function sendSSE(res, type, data) {
    if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    }
}

// API chạy thời gian thực (Real-time Stream) chống Timeout với cấu hình tối ưu
app.get('/api/stream-scrape', async (req, res) => {
    let { 
        url, 
        paginationMode = 'button', 
        pageParam = 'page', 
        maxPages = 20, 
        delay = 2000, 
        blockResources = 'true',
        timeout = 30000,
        parallel = 'false',
        concurrency = 3
    } = req.query;

    if (!url) {
        return res.status(400).send('Lỗi: Thiếu link đường dẫn');
    }

    // Thiết lập Header cho Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Tắt đệm của Nginx nếu có

    // Chuyển kiểu dữ liệu tham số
    maxPages = Math.min(parseInt(maxPages) || 20, 50); // Giới hạn tối đa 50 trang
    delay = Math.max(parseInt(delay) || 2000, 500);    // Tối thiểu 500ms
    const isBlockResources = blockResources === 'true';
    const scrapeTimeout = Math.max(parseInt(timeout) || 30000, 5000);
    const isParallel = parallel === 'true';
    const numConcurrency = Math.min(Math.max(parseInt(concurrency) || 3, 2), 10);

    const cleanUrl = url.trim();
    
    let isClientDisconnected = false;
    let tiepTucQuetMultiPage = true;

    req.on('close', async () => {
        isClientDisconnected = true;
        tiepTucQuetMultiPage = false;
        console.log('[INFO] Client ngắt kết nối. Đang dừng tiến trình cào và đóng trình duyệt...');
        if (browser) {
            try {
                await browser.close();
            } catch (e) {}
        }
    });
    
    // Hàm phụ trợ ghi log gửi về client
    const logToClient = (msg, level = 'info') => {
        if (isClientDisconnected) return;
        console.log(`[${level.toUpperCase()}] ${msg}`);
        if (!res.writableEnded) {
            sendSSE(res, 'log', { message: msg, level });
        }
    };

    logToClient(`Bắt đầu chiến dịch trích xuất thông tin.`);
    logToClient(`URL đích: ${cleanUrl}`);
    logToClient(`Chế độ chuyển trang: ${paginationMode === 'button' ? 'Click nút chuyển tiếp (Next)' : `Tham số URL (${pageParam}=X)`}`);
    logToClient(`Cấu hình: Giới hạn ${maxPages} trang | Delay nghỉ ${delay}ms | Timeout ${scrapeTimeout}ms | Chặn tài nguyên: ${isBlockResources}${paginationMode === 'url' && isParallel ? ` | Cào SONG SONG (Luồng: ${numConcurrency})` : ''}`);

    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true, 
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (typeof puppeteer.executablePath === 'function' ? await puppeteer.executablePath() : undefined),
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--no-first-run',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-features=Translate,BackForwardCache,SharedArrayBuffer'
            ] 
        });
        
        let numPage = 1;
        let globalIndex = 0;
        const tatCaTenDaQuetToanCuc = new Set();
        let lastPageProductsCount = -1;

        // CHẾ ĐỘ CÀO SONG SONG (Chỉ hỗ trợ chế độ URL parameter)
        if (paginationMode === 'url' && isParallel) {
            logToClient(`Bắt đầu cào SONG SONG (Số luồng đồng thời: ${numConcurrency})...`);
            
            const pagesToScrape = [];
            for (let p = 1; p <= maxPages; p++) {
                pagesToScrape.push(p);
            }

            const scrapePage = async (pNum) => {
                if (isClientDisconnected || !tiepTucQuetMultiPage) return;

                let pageInstance = null;
                try {
                    pageInstance = await browser.newPage();
                    await pageInstance.setDefaultNavigationTimeout(scrapeTimeout);
                    await pageInstance.setDefaultTimeout(scrapeTimeout);
                    await pageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                    await pageInstance.setViewport({ width: 1366, height: 768 });
                    await pageInstance.setExtraHTTPHeaders({
                        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                    });

                    if (isBlockResources) {
                        await pageInstance.setRequestInterception(true);
                        pageInstance.on('request', (req) => {
                            const resourceType = req.resourceType();
                            const reqUrl = req.url().toLowerCase();
                            if (
                                ['image', 'media', 'font'].includes(resourceType) ||
                                reqUrl.includes('google-analytics') ||
                                reqUrl.includes('doubleclick') ||
                                reqUrl.includes('facebook') ||
                                reqUrl.includes('hotjar') ||
                                reqUrl.includes('pixel') ||
                                reqUrl.includes('analytics') ||
                                reqUrl.includes('adservice')
                            ) {
                                req.abort();
                            } else {
                                req.continue();
                            }
                        });
                    }

                    let urlChayThucTe = cleanUrl;
                    if (pNum > 1) {
                        if (urlChayThucTe.includes('?')) {
                            const searchParams = new URLSearchParams(urlChayThucTe.split('?')[1]);
                            searchParams.set(pageParam, pNum);
                            urlChayThucTe = urlChayThucTe.split('?')[0] + '?' + searchParams.toString();
                        } else {
                            urlChayThucTe = `${urlChayThucTe}?${pageParam}=${pNum}`;
                        }
                    }

                    logToClient(`[Trang ${pNum}] Đang kết nối tới URL...`);
                    try {
                        await pageInstance.goto(urlChayThucTe, { waitUntil: 'domcontentloaded', timeout: scrapeTimeout });
                    } catch (urlGotoError) {
                        logToClient(`[Trang ${pNum}] Cảnh báo: Tải trang chậm. Đang trích xuất DOM hiện có...`, 'warning');
                    }

                    if (isClientDisconnected || !tiepTucQuetMultiPage) return;

                    logToClient(`[Trang ${pNum}] Đang cuộn trang (lazy-load)...`);
                    await pageInstance.evaluate(async () => {
                        await new Promise((resolve) => {
                            let totalHeight = 0;
                            const distance = 800;
                            let scrolls = 0;
                            const maxScrolls = 15;
                            const timer = setInterval(() => {
                                const scrollHeight = document.body.scrollHeight;
                                window.scrollBy(0, distance);
                                totalHeight += distance;
                                scrolls++;
                                if (totalHeight >= scrollHeight - distance || scrolls >= maxScrolls) {
                                    clearInterval(timer);
                                    resolve();
                                }
                            }, 80);
                        });
                    });

                    await new Promise(resolve => setTimeout(resolve, 1000));
                    if (isClientDisconnected || !tiepTucQuetMultiPage) return;

                    logToClient(`[Trang ${pNum}] Đang trích xuất dữ liệu bằng Heuristic...`);
                    const productsOnPage = await pageInstance.evaluate((currentPageNum, currentUrl) => {
                        const ketQuaTrang = [];
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
                            
                            const hasThousandSeparator = /^\d{1,3}([.,]\d{3})+$/.test(text);
                            return hasThousandSeparator;
                        }

                        const isExcluded = (id, className) => {
                            const exclusions = [
                                'menu', 'sidebar', 'footer', 'header', 'nav', 'aside', 'widget', 
                                'filter', 'banner', 'slider', 'carousel', 'breadcrumb', 'search',
                                'cart', 'checkout', 'login', 'register', 'auth', 'social', 'share',
                                'comment', 'review', 'rating', 'newsletter', 'subscribe', 'pagination'
                            ];
                            return exclusions.some(word => id.includes(word) || className.includes(word));
                        };
                        
                        function isOriginalPriceEl(el) {
                            const cn = el.className ? String(el.className).toLowerCase() : "";
                            const tn = el.tagName ? String(el.tagName).toLowerCase() : "";
                            if (cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's') return true;
                            try {
                                const cs = window.getComputedStyle(el);
                                if (cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through')) return true;
                            } catch(e) {}
                            return false;
                        }
                        
                        function getPriceText(el) {
                            function walk(node) {
                                if (node.nodeType === 3) {
                                    return node.textContent;
                                }
                                if (node.nodeType === 1) {
                                    const className = node.className ? String(node.className).toLowerCase() : "";
                                    const tagName = node.tagName ? String(node.tagName).toLowerCase() : "";
                                    
                                    let isLineThrough = false;
                                    try {
                                        const computedStyle = window.getComputedStyle(node);
                                        isLineThrough = computedStyle.textDecorationLine === 'line-through' || 
                                                        computedStyle.textDecoration === 'line-through' ||
                                                        computedStyle.textDecoration.includes('line-through');
                                    } catch (e) {}

                                    if (className.includes('line') || className.includes('old') || className.includes('del') || tagName === 'del' || tagName === 's' || isLineThrough) {
                                        return "";
                                    }
                                    
                                    let text = "";
                                    for (let child of node.childNodes) {
                                        text += walk(child);
                                    }
                                    return text;
                                }
                                return "";
                            }
                            return walk(el).trim();
                        }
                        
                        const allElements = Array.from(document.querySelectorAll('*'));
                        const possiblePriceElements = [];
                        const digitRegex = /\d/;
                        for (let el of allElements) {
                            if (el.children.length > 50) continue;
                            const id = el.id ? String(el.id).toLowerCase() : "";
                            const className = el.className ? String(el.className).toLowerCase() : "";
                            if (isExcluded(id, className)) continue;
                            
                            const text = el.innerText || "";
                            if (!text || text.length > 30) continue;
                            if (!digitRegex.test(text)) continue;
                            
                            possiblePriceElements.push(el);
                        }
                        
                        const theChuaGia = possiblePriceElements.filter(el => {
                            const text = getPriceText(el);
                            if (!checkIfPrice(text)) return false;
                            
                            const children = Array.from(el.children);
                            const childrenWithPrice = children.filter(child => checkIfPrice((child.innerText || "").trim()));

                            if (childrenWithPrice.length === 0) return true;

                            const allChildPricesAreOriginal = childrenWithPrice.every(child => isOriginalPriceEl(child));
                            return allChildPricesAreOriginal;
                        });

                        theChuaGia.forEach(priceNode => {
                            const rawPrice = getPriceText(priceNode);
                            let parent = priceNode.parentElement;
                            let foundProduct = null;

                            const classNameNode = priceNode.className ? String(priceNode.className).toLowerCase() : "";
                            const tagNameNode = priceNode.tagName ? String(priceNode.tagName).toLowerCase() : "";
                            
                            let isLineThrough = false;
                            try {
                                const computedStyle = window.getComputedStyle(priceNode);
                                isLineThrough = computedStyle.textDecorationLine === 'line-through' || 
                                                computedStyle.textDecoration === 'line-through' ||
                                                computedStyle.textDecoration.includes('line-through');
                            } catch (e) {}

                            const isOriginal = classNameNode.includes('line') || 
                                               classNameNode.includes('old') || 
                                               classNameNode.includes('del') || 
                                               tagNameNode === 'del' || 
                                               tagNameNode === 's' || 
                                               isLineThrough;

                            for (let step = 0; step < 5; step++) {
                                if (!parent) break;

                                const idParent = parent.id ? String(parent.id).toLowerCase() : "";
                                const classParent = parent.className ? String(parent.className).toLowerCase() : "";
                                
                                if (isExcluded(idParent, classParent)) break;

                                const targetTitles = Array.from(parent.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"], .title, .name, a'));
                                let titleText = "";
                                let titleHref = "";

                                for (const titleNode of targetTitles) {
                                    const txt = titleNode.innerText ? titleNode.innerText.replace(/\s+/g, ' ').trim() : "";
                                    if (txt && txt.length >= 8 && txt.length < 150 && txt !== rawPrice && !checkIfPrice(txt)) {
                                        const laRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                                        if (!laRac) {
                                            titleText = txt;
                                            let nodeLink = titleNode;
                                            for (let i = 0; i < 3; i++) {
                                                if (nodeLink && nodeLink.tagName === 'A') {
                                                    titleHref = nodeLink.getAttribute('href');
                                                    break;
                                                }
                                                if (nodeLink) nodeLink = nodeLink.parentElement;
                                            }
                                            break;
                                        }
                                    }
                                }

                                const images = Array.from(parent.querySelectorAll('img'));
                                let imgSrc = "";
                                for (const img of images) {
                                    const src = img.getAttribute('src') || 
                                                 img.getAttribute('data-src') || 
                                                 img.getAttribute('data-original') || 
                                                 img.getAttribute('lazy-src') || 
                                                 img.getAttribute('data-lazy-src');
                                    if (src && !src.startsWith('data:image')) {
                                        imgSrc = src;
                                        break;
                                    }
                                }

                                if (!titleHref) {
                                    const links = Array.from(parent.querySelectorAll('a'));
                                    for (const link of links) {
                                        const href = link.getAttribute('href');
                                        if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                                            titleHref = href;
                                            break;
                                        }
                                    }
                                }

                                if (titleText) {
                                    let absoluteLink = titleHref || "";
                                    if (absoluteLink && !absoluteLink.startsWith('http') && !absoluteLink.startsWith('//')) {
                                        try {
                                            absoluteLink = new URL(absoluteLink, currentUrl).href;
                                        } catch (err) {}
                                    } else if (absoluteLink && absoluteLink.startsWith('//')) {
                                        absoluteLink = 'https:' + absoluteLink;
                                    }

                                    let absoluteImg = imgSrc || "";
                                    if (absoluteImg && !absoluteImg.startsWith('http') && !absoluteImg.startsWith('//')) {
                                        try {
                                            absoluteImg = new URL(absoluteImg, currentUrl).href;
                                        } catch (err) {}
                                    } else if (absoluteImg && absoluteImg.startsWith('//')) {
                                        absoluteImg = 'https:' + absoluteImg;
                                    }

                                    foundProduct = {
                                        ten: titleText,
                                        gia: rawPrice,
                                        trang: currentPageNum,
                                        link: absoluteLink,
                                        anh: absoluteImg,
                                        isOriginal: isOriginal
                                    };
                                    break;
                                }

                                parent = parent.parentElement;
                            }

                            if (foundProduct) {
                                ketQuaTrang.push(foundProduct);
                            }
                        });

                        return ketQuaTrang;
                    }, pNum, pageInstance.url());

                    const uniqueMap = new Map();
                    productsOnPage.forEach(sp => {
                        const uniqueKey = sp.link || sp.ten;
                        if (!uniqueKey) return;
                        if (uniqueMap.has(uniqueKey)) {
                            const existingSp = uniqueMap.get(uniqueKey);
                            if (existingSp.isOriginal && !sp.isOriginal) {
                                uniqueMap.set(uniqueKey, sp);
                            } else if (!existingSp.isOriginal && sp.isOriginal) {
                                // do nothing
                            } else {
                                const valNew = parseInt(sp.gia.replace(/\D/g, '')) || 0;
                                const valExisting = parseInt(existingSp.gia.replace(/\D/g, '')) || 0;
                                if (valNew > 0 && (valExisting === 0 || valNew < valExisting)) {
                                    uniqueMap.set(uniqueKey, sp);
                                }
                            }
                        } else {
                            uniqueMap.set(uniqueKey, sp);
                        }
                    });
                    const uniqueProducts = Array.from(uniqueMap.values());
                    logToClient(`[Trang ${pNum}] Đã trích xuất ${uniqueProducts.length} sản phẩm độc lập.`);

                    let soLuongMoiThucTe = 0;
                    if (uniqueProducts.length > 0) {
                        uniqueProducts.forEach(sp => {
                            const uniqueKey = sp.link || sp.ten;
                            if (!tatCaTenDaQuetToanCuc.has(uniqueKey)) {
                                tatCaTenDaQuetToanCuc.add(uniqueKey);
                                globalIndex++;
                                sendSSE(res, 'product', { ...sp, stt: globalIndex });
                                soLuongMoiThucTe++;
                            }
                        });
                        logToClient(`[Trang ${pNum}] Gửi thành công ${soLuongMoiThucTe} sản phẩm mới (Trùng lặp: ${uniqueProducts.length - soLuongMoiThucTe}).`, 'success');
                    }

                    sendSSE(res, 'stats', {
                        currentPage: pNum,
                        totalItems: globalIndex,
                        lastPageCount: uniqueProducts.length,
                        newItems: soLuongMoiThucTe
                    });

                    if (uniqueProducts.length === 0 || (pNum > 1 && soLuongMoiThucTe === 0)) {
                        logToClient(`[Trang ${pNum}] Không có sản phẩm mới. Phát hiện chạm đáy hoặc trang lặp.`, 'warning');
                        tiepTucQuetMultiPage = false;
                    }

                } catch (err) {
                    logToClient(`[Trang ${pNum}] Xảy ra lỗi: ${err.message}`, 'error');
                } finally {
                    if (pageInstance) {
                        try {
                            await pageInstance.close();
                        } catch (closeErr) {}
                    }
                }
            };

            for (let i = 0; i < pagesToScrape.length; i += numConcurrency) {
                if (isClientDisconnected || !tiepTucQuetMultiPage) break;
                
                const chunk = pagesToScrape.slice(i, i + numConcurrency);
                logToClient(`Đang khởi động cào nhóm trang song song: ${chunk.join(', ')}...`);
                await Promise.all(chunk.map(p => scrapePage(p)));

                if (i + numConcurrency < pagesToScrape.length && tiepTucQuetMultiPage && !isClientDisconnected) {
                    logToClient(`Nghỉ ${delay}ms trước khi cào nhóm trang tiếp theo...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            logToClient(`=== CHIẾN DỊCH HOÀN THÀNH XUẤT SẮC ===`, 'success');
            logToClient(`Đã vét thành công tổng cộng ${globalIndex} sản phẩm.`);
            sendSSE(res, 'done', {
                totalItems: globalIndex,
                totalPages: maxPages
            });
            res.end();
            return;
        }

        // CHẾ ĐỘ CÀO TUẦN TỰ (Sequential Scrape)
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(scrapeTimeout);
        await page.setDefaultTimeout(scrapeTimeout);
        
        // Thiết lập các thông số giả lập để tránh bị phát hiện
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        });

        // Kích hoạt chặn tài nguyên không cần thiết để tăng tốc tối đa
        if (isBlockResources) {
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                const reqUrl = req.url().toLowerCase();
                
                if (
                    ['image', 'media', 'font'].includes(resourceType) ||
                    reqUrl.includes('google-analytics') ||
                    reqUrl.includes('doubleclick') ||
                    reqUrl.includes('facebook') ||
                    reqUrl.includes('hotjar') ||
                    reqUrl.includes('pixel') ||
                    reqUrl.includes('analytics') ||
                    reqUrl.includes('adservice')
                ) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        }

        // Mở trang đầu tiên
        logToClient(`Đang khởi động Chrome ảo và kết nối tới URL nguồn...`);
        try {
            await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: scrapeTimeout });
        } catch (gotoError) {
            // Thử lại lần hai với timeout ngắn hơn và bỏ đợi mạng nếu bị treo
            logToClient(`Kết nối lần 1 thất bại hoặc chậm, đang kết nối lại...`, 'warning');
            try {
                await page.goto(cleanUrl, { waitUntil: 'load', timeout: Math.max(Math.round(scrapeTimeout * 0.6), 10000) });
            } catch (secondGotoError) {
                logToClient(`Thời gian tải trang vượt quá giới hạn. Đang tiến hành trích xuất dữ liệu hiện có...`, 'warning');
            }
        }

        while (tiepTucQuetMultiPage && numPage <= maxPages && !isClientDisconnected) {
            logToClient(`======================= TRANG ${numPage} / ${maxPages} =======================`);

            // Nếu là chế độ URL và từ trang 2 trở đi, điều hướng trực tiếp bằng thay đổi tham số URL
            if (paginationMode === 'url' && numPage > 1) {
                let urlChayThucTe = cleanUrl;
                if (urlChayThucTe.includes('?')) {
                    const searchParams = new URLSearchParams(urlChayThucTe.split('?')[1]);
                    searchParams.set(pageParam, numPage);
                    urlChayThucTe = urlChayThucTe.split('?')[0] + '?' + searchParams.toString();
                } else {
                    urlChayThucTe = `${urlChayThucTe}?${pageParam}=${numPage}`;
                }

                logToClient(`Điều hướng tới URL: ${urlChayThucTe}`);
                try {
                    await page.goto(urlChayThucTe, { waitUntil: 'domcontentloaded', timeout: scrapeTimeout });
                } catch (urlGotoError) {
                    logToClient(`Thời gian tải trang ${numPage} vượt quá giới hạn. Thử trích xuất dữ liệu hiện tại...`, 'warning');
                }
            }

            // Cuộn chuột kích hoạt Lazyload (tối ưu hóa tốc độ: 800px, 80ms, tối đa 15 lần cuộn)
            logToClient(`Đang cuộn trang (lazy-load) để hiển thị sản phẩm ẩn...`);
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 800;
                    let scrolls = 0;
                    const maxScrolls = 15;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        scrolls++;
                        
                        if (totalHeight >= scrollHeight - distance || scrolls >= maxScrolls) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 80);
                });
            });

            // Đợi thêm một chút để dữ liệu tải xong hoàn toàn
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Chạy thuật toán Heuristic thông minh ở Client để lấy dữ liệu sản phẩm chất lượng cao
            logToClient(`Đang phân tích cấu trúc DOM và trích xuất dữ liệu sản phẩm bằng thuật toán Heuristic...`);
            const sanPhamTrangNay = await page.evaluate((currentPageNum, currentUrl) => {
                const ketQuaTrang = [];
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
                    
                    const hasThousandSeparator = /^\d{1,3}([.,]\d{3})+$/.test(text);
                    return hasThousandSeparator;
                }

                const isExcluded = (id, className) => {
                    const exclusions = [
                        'menu', 'sidebar', 'footer', 'header', 'nav', 'aside', 'widget', 
                        'filter', 'banner', 'slider', 'carousel', 'breadcrumb', 'search',
                        'cart', 'checkout', 'login', 'register', 'auth', 'social', 'share',
                        'comment', 'review', 'rating', 'newsletter', 'subscribe', 'pagination'
                    ];
                    return exclusions.some(word => id.includes(word) || className.includes(word));
                };
                
                function isOriginalPriceEl(el) {
                    const cn = el.className ? String(el.className).toLowerCase() : "";
                    const tn = el.tagName ? String(el.tagName).toLowerCase() : "";
                    if (cn.includes('line') || cn.includes('old') || cn.includes('del') || tn === 'del' || tn === 's') return true;
                    try {
                        const cs = window.getComputedStyle(el);
                        if (cs.textDecorationLine === 'line-through' || cs.textDecoration.includes('line-through')) return true;
                    } catch(e) {}
                    return false;
                }
                
                function getPriceText(el) {
                    function walk(node) {
                        if (node.nodeType === 3) { // Node.TEXT_NODE
                            return node.textContent;
                        }
                        if (node.nodeType === 1) { // Node.ELEMENT_NODE
                            const className = node.className ? String(node.className).toLowerCase() : "";
                            const tagName = node.tagName ? String(node.tagName).toLowerCase() : "";
                            
                            let isLineThrough = false;
                            try {
                                const computedStyle = window.getComputedStyle(node);
                                isLineThrough = computedStyle.textDecorationLine === 'line-through' || 
                                                computedStyle.textDecoration === 'line-through' ||
                                                computedStyle.textDecoration.includes('line-through');
                            } catch (e) {}

                            if (className.includes('line') || className.includes('old') || className.includes('del') || tagName === 'del' || tagName === 's' || isLineThrough) {
                                return "";
                            }
                            
                            let text = "";
                            for (let child of node.childNodes) {
                                text += walk(child);
                            }
                            return text;
                        }
                        return "";
                    }
                    return walk(el).trim();
                }
                
                // Lọc sớm phần tử
                const allElements = Array.from(document.querySelectorAll('*'));
                const possiblePriceElements = [];
                const digitRegex = /\d/;
                for (let el of allElements) {
                    if (el.children.length > 50) continue;
                    const id = el.id ? String(el.id).toLowerCase() : "";
                    const className = el.className ? String(el.className).toLowerCase() : "";
                    if (isExcluded(id, className)) continue;
                    
                    const text = el.innerText || "";
                    if (!text || text.length > 30) continue;
                    if (!digitRegex.test(text)) continue;
                    
                    possiblePriceElements.push(el);
                }
                
                const theChuaGia = possiblePriceElements.filter(el => {
                    const text = getPriceText(el);
                    if (!checkIfPrice(text)) return false;
                    
                    const children = Array.from(el.children);
                    const childrenWithPrice = children.filter(child => checkIfPrice((child.innerText || "").trim()));

                    if (childrenWithPrice.length === 0) return true;

                    const allChildPricesAreOriginal = childrenWithPrice.every(child => isOriginalPriceEl(child));
                    return allChildPricesAreOriginal;
                });

                theChuaGia.forEach(priceNode => {
                    const rawPrice = getPriceText(priceNode);
                    let parent = priceNode.parentElement;
                    let foundProduct = null;

                    const classNameNode = priceNode.className ? String(priceNode.className).toLowerCase() : "";
                    const tagNameNode = priceNode.tagName ? String(priceNode.tagName).toLowerCase() : "";
                    
                    let isLineThrough = false;
                    try {
                        const computedStyle = window.getComputedStyle(priceNode);
                        isLineThrough = computedStyle.textDecorationLine === 'line-through' || 
                                        computedStyle.textDecoration === 'line-through' ||
                                        computedStyle.textDecoration.includes('line-through');
                    } catch (e) {}

                    const isOriginal = classNameNode.includes('line') || 
                                       classNameNode.includes('old') || 
                                       classNameNode.includes('del') || 
                                       tagNameNode === 'del' || 
                                       tagNameNode === 's' || 
                                       isLineThrough;

                    for (let step = 0; step < 5; step++) {
                        if (!parent) break;

                        const idParent = parent.id ? String(parent.id).toLowerCase() : "";
                        const classParent = parent.className ? String(parent.className).toLowerCase() : "";
                        
                        if (isExcluded(idParent, classParent)) break;

                        const targetTitles = Array.from(parent.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"], .title, .name, a'));
                        let titleText = "";
                        let titleHref = "";

                        for (const titleNode of targetTitles) {
                            const txt = titleNode.innerText ? titleNode.innerText.replace(/\s+/g, ' ').trim() : "";
                            if (txt && txt.length >= 8 && txt.length < 150 && txt !== rawPrice && !checkIfPrice(txt)) {
                                const laRac = tuKhoaRac.some(x => txt.toLowerCase().includes(x));
                                if (!laRac) {
                                    titleText = txt;
                                    let nodeLink = titleNode;
                                    for (let i = 0; i < 3; i++) {
                                        if (nodeLink && nodeLink.tagName === 'A') {
                                            titleHref = nodeLink.getAttribute('href');
                                            break;
                                        }
                                        if (nodeLink) nodeLink = nodeLink.parentElement;
                                    }
                                    break;
                                }
                            }
                        }

                        const images = Array.from(parent.querySelectorAll('img'));
                        let imgSrc = "";
                        for (const img of images) {
                            const src = img.getAttribute('src') || 
                                         img.getAttribute('data-src') || 
                                         img.getAttribute('data-original') || 
                                         img.getAttribute('lazy-src') || 
                                         img.getAttribute('data-lazy-src');
                            if (src && !src.startsWith('data:image')) {
                                imgSrc = src;
                                break;
                            }
                        }

                        if (!titleHref) {
                            const links = Array.from(parent.querySelectorAll('a'));
                            for (const link of links) {
                                const href = link.getAttribute('href');
                                if (href && href.length > 2 && !href.startsWith('#') && !href.startsWith('javascript:')) {
                                    titleHref = href;
                                    break;
                                }
                            }
                        }

                        if (titleText) {
                            let absoluteLink = titleHref || "";
                            if (absoluteLink && !absoluteLink.startsWith('http') && !absoluteLink.startsWith('//')) {
                                try {
                                    absoluteLink = new URL(absoluteLink, currentUrl).href;
                                } catch (err) {}
                            } else if (absoluteLink && absoluteLink.startsWith('//')) {
                                absoluteLink = 'https:' + absoluteLink;
                            }

                            let absoluteImg = imgSrc || "";
                            if (absoluteImg && !absoluteImg.startsWith('http') && !absoluteImg.startsWith('//')) {
                                try {
                                    absoluteImg = new URL(absoluteImg, currentUrl).href;
                                } catch (err) {}
                            } else if (absoluteImg && absoluteImg.startsWith('//')) {
                                absoluteImg = 'https:' + absoluteImg;
                            }

                            foundProduct = {
                                ten: titleText,
                                gia: rawPrice,
                                trang: currentPageNum,
                                link: absoluteLink,
                                anh: absoluteImg,
                                isOriginal: isOriginal
                            };
                            break;
                        }

                        parent = parent.parentElement;
                    }

                    if (foundProduct) {
                        ketQuaTrang.push(foundProduct);
                    }
                });

                return ketQuaTrang;
            }, numPage, page.url());

            // Loại bỏ trùng lặp trong nội bộ trang này, ưu tiên giá khuyến mãi (không bị gạch), sau đó chọn giá rẻ nhất
            const uniqueMap = new Map();
            sanPhamTrangNay.forEach(sp => {
                const uniqueKey = sp.link || sp.ten;
                if (!uniqueKey) return;
                
                if (uniqueMap.has(uniqueKey)) {
                    const existingSp = uniqueMap.get(uniqueKey);
                    
                    if (existingSp.isOriginal && !sp.isOriginal) {
                        // Nếu sản phẩm hiện tại trong map là giá cũ/gốc, sản phẩm mới là giá khuyến mãi -> cập nhật
                        uniqueMap.set(uniqueKey, sp);
                    } else if (!existingSp.isOriginal && sp.isOriginal) {
                        // Nếu sản phẩm hiện tại trong map là giá khuyến mãi, sản phẩm mới là giá cũ/gốc -> giữ nguyên giá khuyến mãi
                        // do nothing
                    } else {
                        // Cả hai cùng là giá gốc hoặc cùng là giá khuyến mãi -> chọn giá rẻ nhất
                        const valNew = parseInt(sp.gia.replace(/\D/g, '')) || 0;
                        const valExisting = parseInt(existingSp.gia.replace(/\D/g, '')) || 0;
                        
                        if (valNew > 0 && (valExisting === 0 || valNew < valExisting)) {
                            uniqueMap.set(uniqueKey, sp);
                        }
                    }
                } else {
                    uniqueMap.set(uniqueKey, sp);
                }
            });
            const uniqueProducts = Array.from(uniqueMap.values());

            logToClient(`Đã trích xuất ${uniqueProducts.length} sản phẩm độc lập từ Trang ${numPage}.`);

            // Gửi dữ liệu của trang này về Frontend bằng dòng SSE
            let soLuongMoiThucTe = 0;
            if (uniqueProducts.length > 0) {
                uniqueProducts.forEach(sp => {
                    // Lọc trùng lặp toàn cục trên tất cả các trang dựa trên link hoặc tên sản phẩm
                    const uniqueKey = sp.link || sp.ten;
                    if (!tatCaTenDaQuetToanCuc.has(uniqueKey)) {
                        tatCaTenDaQuetToanCuc.add(uniqueKey);
                        globalIndex++;
                        
                        sendSSE(res, 'product', { ...sp, stt: globalIndex });
                        soLuongMoiThucTe++;
                    }
                });
                
                logToClient(`Gửi thành công ${soLuongMoiThucTe} sản phẩm mới về giao diện (Trùng lặp: ${uniqueProducts.length - soLuongMoiThucTe}).`, 'success');
            }

            // Gửi cập nhật thống kê tạm thời
            sendSSE(res, 'stats', {
                currentPage: numPage,
                totalItems: globalIndex,
                lastPageCount: uniqueProducts.length,
                newItems: soLuongMoiThucTe
            });

            // Kiểm tra điều kiện kết thúc sớm (Trang trống hoặc không thêm sản phẩm mới)
            if (uniqueProducts.length === 0 || (numPage > 1 && soLuongMoiThucTe === 0)) {
                logToClient(`Không phát hiện thêm sản phẩm mới nào ở Trang ${numPage} (Chạm đáy kho hàng hoặc trang lặp). Dừng cào sớm.`, 'warning');
                tiepTucQuetMultiPage = false;
                break;
            }

            lastPageProductsCount = uniqueProducts.length;

            if (numPage >= maxPages) {
                logToClient(`Đã quét đạt giới hạn số trang tối đa (${maxPages} trang) cấu hình bởi người dùng.`, 'success');
                break;
            }

            // Thực hiện chuyển trang tiếp theo
            if (paginationMode === 'button') {
                logToClient(`Đang tìm kiếm nút chuyển tiếp (Next Page) hoặc nút Xem Thêm...`);
                const phatHienNutNext = await page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('a, button, li, span, div, [rel="next"]'));
                    for (let el of elements) {
                        const text = el.innerText ? el.innerText.trim().toLowerCase() : "";
                        const className = el.className ? String(el.className).toLowerCase() : "";
                        const relAttr = el.getAttribute('rel') ? el.getAttribute('rel').toLowerCase() : "";
                        const titleAttr = el.getAttribute('title') ? el.getAttribute('title').toLowerCase() : "";
                        const altAttr = el.getAttribute('alt') ? el.getAttribute('alt').toLowerCase() : "";
                        const ariaLabel = el.getAttribute('aria-label') ? el.getAttribute('aria-label').toLowerCase() : "";
                        
                        // Bỏ qua các nút của carousel/slider
                        const isCarousel = className.includes('swiper') || className.includes('slider') || className.includes('slick') || className.includes('carousel');
                        if (isCarousel) continue;

                        // Bỏ qua các thẻ bị ẩn hoặc vô hiệu hóa
                        const isVisible = el.offsetWidth > 0 || el.offsetHeight > 0;
                        const isDisabled = el.disabled || className.includes('disabled') || className.includes('disable') || el.getAttribute('aria-disabled') === 'true';
                        if (!isVisible || isDisabled) continue;

                        // So khớp các biểu tượng và từ khóa chuyển trang hoặc Xem thêm
                        const matchIcon = text === '>' || text === '»' || text === '▶' || text === '›' || text === 'next' || text === 'sau' || text === 'kế tiếp' || text === 'tiếp theo';
                        const matchText = text.includes('kế tiếp') || text.includes('trang sau') || text.includes('next page') || text.includes('trang tiếp') || text.includes('tiếp theo');
                        const matchShowMore = text.includes('xem thêm') || text.includes('xem-them') || text.includes('load more') || text.includes('show more');
                        const matchAttr = relAttr === 'next' || className.includes('next') || className.includes('more') || titleAttr.includes('next') || titleAttr.includes('sau') || titleAttr.includes('more') || altAttr.includes('next') || ariaLabel.includes('next');
                        
                        // Loại trừ các thẻ cha chứa quá nhiều con (để lấy chính xác thẻ nút)
                        const isNotBigContainer = el.querySelectorAll('*').length <= 6;
                        
                        if ((matchIcon || matchText || matchShowMore || matchAttr) && isNotBigContainer) {
                            // Cố gắng tìm thẻ a hoặc button bên trong nếu nó là li
                            if (el.tagName === 'LI') {
                                const childLink = el.querySelector('a, button');
                                if (childLink) el = childLink;
                            }
                            el.scrollIntoView({ block: 'center' });
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });

                if (phatHienNutNext) {
                    numPage++;
                    logToClient(`Đã phát hiện và click nút chuyển tiếp/Xem thêm. Chờ ${delay}ms để tải dữ liệu mới...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    logToClient(`Không phát hiện thêm nút chuyển tiếp hoặc Xem thêm trên trang này. Dừng tiến trình cào.`, 'warning');
                    tiepTucQuetMultiPage = false;
                }
            } else {
                // Chế độ URL Parameter, chỉ cần tăng số trang và chuyển vòng lặp tiếp theo
                numPage++;
                logToClient(`Chờ ${delay}ms trước khi mở trang tiếp theo...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // Gửi kết quả hoàn thành xuất sắc
        logToClient(`=== CHIẾN DỊCH HOÀN THÀNH XUẤT SẮC ===`, 'success');
        logToClient(`Đã vét thành công tổng cộng ${globalIndex} sản phẩm từ ${Math.min(numPage, maxPages)} trang.`);
        sendSSE(res, 'done', {
            totalItems: globalIndex,
            totalPages: Math.min(numPage, maxPages)
        });
        res.end();

    } catch (error) {
        if (isClientDisconnected) {
            console.log('[INFO] Đã hủy tiến trình do client ngắt kết nối (Target closed).');
        } else {
            logToClient(`Lỗi nghiêm trọng: ${error.message}`, 'error');
            sendSSE(res, 'error', { message: error.message });
        }
        res.end();
    } finally {
        if (browser) {
            try {
                logToClient(`Đang đóng trình duyệt Chrome ảo để giải phóng RAM...`);
                await browser.close();
                logToClient(`Hệ thống đã dừng an toàn.`);
            } catch (closeErr) {}
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('------------------------------------------------------------');
    console.log(`  HỆ THỐNG SIÊU BOT STREAM VÉT CẠN ĐANG CHẠY TẠI PORT ${PORT}  `);
    console.log(`          Địa chỉ: http://localhost:${PORT}                     `);
    console.log('------------------------------------------------------------');
});