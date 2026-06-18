const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const scraperCore = require('./lib/scraper-core.js');
const sheetPricingService = require('./lib/sheet-pricing-service.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

// Helper to parse JSON body
function getJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', err => reject(err));
    });
}

// Helper to send JSON response
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
    // Enable CORS pre-flight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // API Routing
    if (pathname === '/api/scrape' && req.method === 'POST') {
        try {
            const body = await getJsonBody(req);
            const targetUrl = body.url;
            const paginationMode = body.paginationMode || 'url';
            const pageParam = body.pageParam || 'page';
            const pageNum = parseInt(body.pageNum) || 1;
            const isBlockResources = body.blockResources !== false;
            const timeout = parseInt(body.timeout) || 30000;

            if (!targetUrl) {
                return sendJson(res, 400, { ok: false, error: 'Thiếu link đường dẫn' });
            }

            const logs = [];
            const log = (msg, level = 'info') => logs.push({ message: msg, level });

            // Apply page number logic
            let finalUrl = targetUrl.trim();
            if (pageNum > 1) {
                if (finalUrl.includes('?')) {
                    const [base, qs] = finalUrl.split('?');
                    const sp = new URLSearchParams(qs);
                    sp.set(pageParam, pageNum);
                    finalUrl = `${base}?${sp.toString()}`;
                } else {
                    finalUrl = `${finalUrl}?${pageParam}=${pageNum}`;
                }
            }

            const scrapeResult = await scraperCore.scrapeUrl(finalUrl, pageNum, {
                blockResources: isBlockResources,
                timeout: timeout,
            }, log);

            const responseBody = { products: scrapeResult.products, logs };
            if (scraperCore.isHomepage(finalUrl) && scrapeResult.categoryLinks) {
                responseBody.categoryLinks = scrapeResult.categoryLinks;
            }

            return sendJson(res, 200, responseBody);
        } catch (error) {
            return sendJson(res, 500, { ok: false, error: error.message });
        }
    }

    if (pathname === '/api/sheet-pricing/config' && req.method === 'GET') {
        return sendJson(res, 200, {
            ok: true,
            appsScriptUrl: process.env.APPS_SCRIPT_URL || '',
            sheetUrl: process.env.SHEET_URL || '',
            sheetName: process.env.SHEET_NAME || '',
        });
    }

    if (pathname === '/api/sheet-pricing/start' && req.method === 'POST') {
        try {
            const body = await getJsonBody(req);
            const mergedConfig = {
                appsScriptUrl: body.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                sheetUrl: body.sheetUrl || process.env.SHEET_URL,
                sheetName: body.sheetName || process.env.SHEET_NAME,
                startRow: body.startRow,
                endRow: body.endRow,
                rowsConcurrency: body.rowsConcurrency,
                linksConcurrency: body.linksConcurrency,
                batchSize: body.batchSize,
            };
            const jobId = sheetPricingService.startBackgroundPricingJob(mergedConfig);
            return sendJson(res, 200, { ok: true, jobId });
        } catch (error) {
            return sendJson(res, 500, { ok: false, error: error.message });
        }
    }

    if (pathname.startsWith('/api/sheet-pricing/status/') && req.method === 'GET') {
        const jobId = pathname.replace('/api/sheet-pricing/status/', '');
        const status = sheetPricingService.getBackgroundPricingJobStatus(jobId);
        if (!status) {
            return sendJson(res, 404, { ok: false, error: 'Không tìm thấy Job ID' });
        }
        return sendJson(res, 200, { ok: true, ...status });
    }

    if (pathname.startsWith('/api/sheet-pricing/stop/') && req.method === 'POST') {
        const jobId = pathname.replace('/api/sheet-pricing/stop/', '');
        const success = sheetPricingService.stopBackgroundPricingJob(jobId);
        if (!success) {
            return sendJson(res, 404, { ok: false, error: 'Không tìm thấy Job ID' });
        }
        return sendJson(res, 200, { ok: true });
    }

    // Static Files serving
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    
    // Normalize path to prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Access Denied');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // Fallback to index.html for single page apps style
            filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (readErr, content) => {
            if (readErr) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Internal Server Error');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
