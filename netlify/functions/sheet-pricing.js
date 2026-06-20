const {
    readSheetRows,
    writeSheetUpdates,
    processPricingRow,
    loadModelMapping,
    listSpreadsheetSheets,
    syncHaravanIds,
    loadHaravanMapping,
    updateHaravanVariantPrice,
} = require('../../lib/sheet-pricing-service.js');

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
};

function json(statusCode, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body),
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const path = event.path || '';
    if (event.httpMethod === 'GET' && (path.endsWith('/config') || path.endsWith('/sheet-pricing/config'))) {
        return json(200, {
            ok: true,
            appsScriptUrl: process.env.APPS_SCRIPT_URL || '',
            sheetUrl: process.env.SHEET_URL || '',
            sheetName: process.env.SHEET_NAME || '',
        });
    }

    if (event.httpMethod !== 'POST') {
        return json(405, { ok: false, error: 'Chi ho tro POST.' });
    }

    try {
        const payload = event.body ? JSON.parse(event.body) : {};
        const action = payload.action;

        if (!action) {
            return json(400, { ok: false, error: 'Thieu action.' });
        }

        if (action === 'fetch-mapping') {
            const mapping = await loadModelMapping({
                appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
            });

            return json(200, {
                ok: true,
                mapping,
            });
        }

        if (action === 'list-sheets') {
            const data = await listSpreadsheetSheets({
                appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
            });

            return json(200, {
                ok: true,
                sheets: data.sheets || [],
            });
        }

        if (action === 'haravan-sync') {
            const data = await syncHaravanIds({
                appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                haravanShopUrl: payload.haravanShopUrl,
                haravanAccessToken: payload.haravanAccessToken,
            });

            return json(200, {
                ok: true,
                fetched: data.fetched,
                written: data.written,
            });
        }

        if (action === 'fetch-haravan-mapping') {
            const mapping = await loadHaravanMapping({
                appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
            });

            return json(200, {
                ok: true,
                mapping,
            });
        }

        if (action === 'haravan-update-price') {
            const result = await updateHaravanVariantPrice({
                haravanShopUrl: payload.haravanShopUrl,
                haravanAccessToken: payload.haravanAccessToken,
                variantId: payload.variantId,
                price: payload.price,
            });

            return json(200, {
                ok: true,
                result,
            });
        }

        if (action === 'fetch-sheet') {
            const data = await readSheetRows({
                appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                sheetName: payload.sheetName || process.env.SHEET_NAME,
                startRow: payload.startRow,
                endRow: payload.endRow,
                specificRows: payload.specificRows,
            });

            return json(200, {
                ok: true,
                sheetId: data.sheetId,
                headers: data.headers,
                rows: data.rows,
            });
        }

        if (action === 'process-row') {
            const result = await processPricingRow({
                row: payload.row,
                deps: {
                    linksConcurrency: payload.linksConcurrency,
                },
            });

            return json(200, {
                ok: true,
                result,
            });
        }

        if (action === 'write-results') {
            const data = await writeSheetUpdates({
                appsScriptUrl: payload.appsScriptUrl || process.env.APPS_SCRIPT_URL,
                sheetUrl: payload.sheetUrl || process.env.SHEET_URL,
                sheetName: payload.sheetName || process.env.SHEET_NAME,
                updates: payload.updates || [],
                logs: payload.logs || [],
            });

            return json(200, {
                ok: true,
                updated: data.updated || 0,
            });
        }

        return json(400, { ok: false, error: `Action khong hop le: ${action}` });
    } catch (error) {
        return json(500, {
            ok: false,
            error: error.message || 'Loi khong xac dinh.',
        });
    }
};
