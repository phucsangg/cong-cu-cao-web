function normalizeVietnameseText(value = '') {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .trim()
        .toLowerCase();
}

function parseVietnamesePrice(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 ? Math.round(value) : null;
    }

    const text = String(value).trim();
    if (!text) return null;

    const normalized = normalizeVietnameseText(text);
    if (normalized.includes('lien he')) return null;

    const digits = text.replace(/\D/g, '');
    if (!digits) return null;

    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeModelText(value = '') {
    return normalizeVietnameseText(value)
        .replace(/[^a-z0-9]/g, '')
        .toUpperCase();
}

function roundCurrency(value) {
    if (!Number.isFinite(value)) return null;
    return Math.round(value);
}

function computeSuggestedPricing({ currentSalePrice, prices = [] }) {
    const normalizedPrices = prices
        .map(parseVietnamesePrice)
        .filter((price) => Number.isFinite(price) && price > 0)
        .sort((a, b) => a - b);

    const marketPrices = normalizedPrices.slice(0, 10);
    let filteredPrices = [...marketPrices];
    let outlierRemoved = null;

    if (filteredPrices.length >= 2 && filteredPrices[0] < filteredPrices[1] * 0.9) {
        outlierRemoved = filteredPrices.shift();
    }

    const minPrice = filteredPrices.length > 0 ? filteredPrices[0] : null;
    const salePriceValue = parseVietnamesePrice(currentSalePrice);
    const gapValue = minPrice !== null && salePriceValue !== null ? salePriceValue - minPrice : null;
    const gapPercent = minPrice !== null && gapValue !== null ? gapValue / minPrice : null;

    let suggestedPrice = null;
    if (filteredPrices.length >= 3) {
        const top3 = filteredPrices.slice(0, 3);
        const avgTop3 = top3.reduce((sum, price) => sum + price, 0) / top3.length;
        suggestedPrice = roundCurrency(avgTop3 * 0.995);
    }

    return {
        marketPrices,
        filteredPrices,
        outlierRemoved,
        minPrice,
        gapValue,
        gapPercent,
        suggestedPrice,
    };
}

function findHeaderIndex(headers, candidates) {
    for (const candidate of candidates) {
        const index = headers.findIndex((header) => {
            const normalizedHeader = normalizeVietnameseText(header);
            const normalizedCandidate = normalizeVietnameseText(candidate);
            
            if (normalizedHeader === normalizedCandidate) return true;
            if (normalizedHeader.startsWith(normalizedCandidate)) return true;

            // Differentiate columns with '%' (like %GAP) vs columns without it (like GAP)
            if (normalizedCandidate.includes('%') && !normalizedHeader.includes('%')) return false;
            if (!normalizedCandidate.includes('%') && normalizedHeader.includes('%')) return false;

            const cleanHeader = normalizedHeader.replace(/[^a-z0-9]/g, '');
            const cleanCandidate = normalizedCandidate.replace(/[^a-z0-9]/g, '');
            if (!cleanCandidate) return false;

            return cleanHeader === cleanCandidate || cleanHeader.includes(cleanCandidate);
        });
        if (index !== -1) return index;
    }
    return -1;
}

function mapSheetHeaders(headers = []) {
    if (!Array.isArray(headers) || headers.length === 0) {
        throw new Error('Khong tim thay header trong sheet.');
    }

    const mapping = {
        productId: findHeaderIndex(headers, ['Mã SP', 'Ma SP', 'Mã sản phẩm', 'Ma san pham']),
        brand: findHeaderIndex(headers, ['Thương hiệu', 'Thuong hieu']),
        model: findHeaderIndex(headers, ['Model']),
        costPrice: findHeaderIndex(headers, ['Giá vốn', 'Gia von']),
        salePrice: findHeaderIndex(headers, ['Giá bán', 'Gia ban']),
        marketColumns: [],
        minPrice: findHeaderIndex(headers, ['Min']),
        gapValue: findHeaderIndex(headers, ['GAP']),
        gapPercent: findHeaderIndex(headers, ['%GAP']),
        suggestedPrice: findHeaderIndex(headers, ['Giá đề xuất', 'Gia de xuat']),
    };

    for (let index = 1; index <= 10; index += 1) {
        const marketColumn = findHeaderIndex(headers, [`Thị trường ${index}`, `Thi truong ${index}`]);
        if (marketColumn !== -1) {
            mapping.marketColumns.push(marketColumn);
        }
    }

    const requiredInputs = ['brand', 'model', 'salePrice'];
    const missingInputs = requiredInputs.filter((key) => mapping[key] === -1);
    if (missingInputs.length > 0) {
        throw new Error(`Thieu cot bat buoc trong sheet: ${missingInputs.join(', ')}`);
    }

    if (mapping.marketColumns.length === 0 || mapping.minPrice === -1 || mapping.gapValue === -1 || mapping.gapPercent === -1 || mapping.suggestedPrice === -1) {
        throw new Error('Thieu cot output can thiet trong sheet.');
    }

    return mapping;
}

function buildSheetUpdateRow({ marketPrices = [], minPrice = null, gapValue = null, gapPercent = null, suggestedPrice = null }) {
    const marketCells = Array.from({ length: 10 }, (_, index) => {
        const value = marketPrices[index];
        return Number.isFinite(value) ? value : '';
    });

    return [
        ...marketCells,
        Number.isFinite(minPrice) ? minPrice : '',
        Number.isFinite(gapValue) ? gapValue : '',
        typeof gapPercent === 'number' && Number.isFinite(gapPercent) ? gapPercent : '',
        Number.isFinite(suggestedPrice) ? suggestedPrice : '',
    ];
}

module.exports = {
    parseVietnamesePrice,
    normalizeModelText,
    computeSuggestedPricing,
    mapSheetHeaders,
    buildSheetUpdateRow,
    normalizeVietnameseText,
};
