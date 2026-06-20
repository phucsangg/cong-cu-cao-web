const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

    if (pathname === '/api/sheet-pricing/config' && req.method === 'GET') {
        return sendJson(res, 200, {
            ok: true,
            appsScriptUrl: process.env.APPS_SCRIPT_URL || '',
            sheetUrl: process.env.SHEET_URL || '',
            sheetName: process.env.SHEET_NAME || '',
            telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
            telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
        });
    }

    if (pathname === '/api/sheet-pricing' && req.method === 'POST') {
        try {
            const payload = await getJsonBody(req);
            console.log(`[API POST] ${payload.action || 'unknown'} payload:`, JSON.stringify(payload, null, 2));
            const action = payload.action;

            if (!action) {
                return sendJson(res, 400, { ok: false, error: 'Thiếu action.' });
            }

            if (action === 'fetch-mapping') {
                const mapping = await sheetPricingService.loadModelMapping({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                });
                return sendJson(res, 200, { ok: true, mapping });
            }

            if (action === 'list-sheets') {
                const data = await sheetPricingService.listSpreadsheetSheets({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                });
                return sendJson(res, 200, { ok: true, sheets: data.sheets || [] });
            }

            if (action === 'haravan-sync') {
                const data = await sheetPricingService.syncHaravanIds({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                    haravanShopUrl: payload.haravanShopUrl,
                    haravanAccessToken: payload.haravanAccessToken,
                });
                return sendJson(res, 200, { ok: true, fetched: data.fetched, written: data.written });
            }

            if (action === 'fetch-haravan-mapping') {
                const mapping = await sheetPricingService.loadHaravanMapping({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                });
                return sendJson(res, 200, { ok: true, mapping });
            }

            if (action === 'haravan-update-price') {
                const result = await sheetPricingService.updateHaravanVariantPrice({
                    haravanShopUrl: payload.haravanShopUrl,
                    haravanAccessToken: payload.haravanAccessToken,
                    variantId: payload.variantId,
                    price: payload.price,
                });
                return sendJson(res, 200, { ok: true, result });
            }

            if (action === 'telegram-notify') {
                const result = await sheetPricingService.sendTelegramNotification({
                    telegramBotToken: payload.telegramBotToken,
                    telegramChatId: payload.telegramChatId,
                    message: payload.message,
                });
                return sendJson(res, 200, { ok: true, result });
            }

            if (action === 'haravan-log-update') {
                const result = await sheetPricingService.writeHaravanLog({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                    brand: payload.brand,
                    model: payload.model,
                    price: payload.price,
                    status: payload.status,
                });
                return sendJson(res, 200, { ok: true, result });
            }

            if (action === 'sheet-update-sale-price') {
                const result = await sheetPricingService.updateSheetSalePrice({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                    sheetName: payload.sheetName,
                    rowNumber: payload.rowNumber,
                    price: payload.price,
                });
                return sendJson(res, 200, { ok: true, result });
            }

            if (action === 'fetch-sheet') {
                const data = await sheetPricingService.readSheetRows({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                    sheetName: payload.sheetName || process.env.SHEET_NAME,
                    startRow: payload.startRow,
                    endRow: payload.endRow,
                });
                return sendJson(res, 200, {
                    ok: true,
                    sheetId: data.sheetId,
                    headers: data.headers,
                    rows: data.rows,
                });
            }

            if (action === 'process-row') {
                const result = await sheetPricingService.processPricingRow({
                    row: payload.row,
                    deps: {
                        linksConcurrency: payload.linksConcurrency,
                    },
                });
                return sendJson(res, 200, { ok: true, result });
            }

            if (action === 'write-results') {
                const data = await sheetPricingService.writeSheetUpdates({
                    appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                    sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                    sheetName: payload.sheetName || process.env.SHEET_NAME,
                    updates: payload.updates || [],
                    logs: payload.logs || [],
                });
                return sendJson(res, 200, { ok: true, updated: data.updated || 0 });
            }

            return sendJson(res, 400, { ok: false, error: `Action không hợp lệ: ${action}` });
        } catch (error) {
            return sendJson(res, 500, { ok: false, error: error.message });
        }
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
