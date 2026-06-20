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
    
    let parsed = null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        parsed = value > 0 ? Math.round(value) : null;
    } else {
        const text = String(value).trim();
        if (!text) return null;

        const normalized = normalizeVietnameseText(text).replace(/\s+/g, '');
        if (normalized.includes('lienhe')) return null;

        const trieuMatch = normalized.match(/([0-9]+(?:[.,][0-9]+)?)(?:trieu|tr)\b/) || normalized.match(/([0-9]+(?:[.,][0-9]+)?)(?:trieu|tr)$/);
        if (trieuMatch) {
            const num = parseFloat(trieuMatch[1].replace(',', '.'));
            if (!isNaN(num)) {
                parsed = Math.round(num * 1000000);
            }
        } else {
            const kMatch = normalized.match(/([0-9]+(?:[.,][0-9]+)?)k\b/) || normalized.match(/([0-9]+(?:[.,][0-9]+)?)k$/);
            if (kMatch) {
                const num = parseFloat(kMatch[1].replace(',', '.'));
                if (!isNaN(num)) {
                    parsed = Math.round(num * 1000);
                }
            } else {
                const digits = text.replace(/\D/g, '');
                if (digits) {
                    parsed = Number.parseInt(digits, 10);
                }
            }
        }
    }

    if (parsed !== null && Number.isFinite(parsed) && parsed > 0) {
        if (parsed < 100000) {
            parsed = parsed * 1000;
        }
        return parsed;
    }
    return null;
}

function normalizeModelText(value = '') {
    let str = normalizeVietnameseText(value);
    
    // Replace '+' with 'plus'
    str = str.replace(/\+/g, ' plus ');

    // Normalize units to cm (handling mm and m)
    // 1. mm to cm: e.g. 900mm -> 90cm
    str = str.replace(/\b(\d+(?:\.\d+)?)\s*mm\b/g, (match, num) => {
        const cm = parseFloat(num) / 10;
        return `${cm}cm`;
    });
    
    // 2. m to cm: e.g. 0.9m -> 90cm
    str = str.replace(/\b(\d+(?:[.,]\d+)?)\s*m\b/g, (match, num) => {
        const parsedNum = parseFloat(num.replace(',', '.'));
        const cm = parsedNum * 100;
        return `${cm}cm`;
    });

    // 3. Remove 'cm' unit suffix so '90cm' becomes '90', matching raw numbers
    str = str.replace(/\b(\d+(?:\.\d+)?)\s*cm\b/g, '$1');

    return str
        .replace(/[^a-z0-9]/g, '')
        .toUpperCase();
}

function roundCurrency(value) {
    if (!Number.isFinite(value)) return null;
    return Math.round(value);
}

function computeSuggestedPricing({ listPrice, costPrice, currentSalePrice, prices = [] }) {
    const normalizedPrices = prices
        .map(parseVietnamesePrice)
        .filter((price) => Number.isFinite(price) && price > 0)
        .sort((a, b) => a - b);

    const marketPrices = normalizedPrices.slice(0, 10);
    
    let outlierRemoved = false;
    let validPrices = [...marketPrices];
    
    if (validPrices.length >= 2) {
        if (validPrices[0] < validPrices[1] * 0.9) {
            validPrices.shift();
            outlierRemoved = true;
        }
    }

    const minPrice = validPrices.length > 0 ? validPrices[0] : null;

    const salePriceValue = parseVietnamesePrice(currentSalePrice);
    const listPriceValue = parseVietnamesePrice(listPrice);
    const costPriceValue = parseVietnamesePrice(costPrice);

    const comparisonPrice = salePriceValue !== null ? salePriceValue : listPriceValue;

    // Lợi nhuận = Giá bán (₫) hoặc Giá niêm yết (₫) - Giá vốn (₫) (nếu 1 trong 2 cột trống thì để trống cột lợi nhuận)
    const gapValue = (comparisonPrice !== null && costPriceValue !== null) ? (comparisonPrice - costPriceValue) : null;

    // % Lợi nhuận = Lợi nhuận / comparisonPrice
    const gapPercent = (gapValue !== null && comparisonPrice !== null && comparisonPrice > 0) ? (gapValue / comparisonPrice) : null;

    // Giá đề xuất lấy giá Min sau khi lọc outlier
    const suggestedPrice = minPrice;

    return {
        marketPrices,
        minPrice,
        gapValue,
        gapPercent,
        suggestedPrice,
        outlierRemoved,
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
        listPrice: findHeaderIndex(headers, ['Giá niêm yết (₫)', 'Giá niêm yết (đ)', 'Giá niêm yết', 'Gia niem yet']),
        costPrice: findHeaderIndex(headers, ['Giá vốn (₫)', 'Giá vốn (đ)', 'Giá vốn', 'Gia von']),
        salePrice: findHeaderIndex(headers, ['Giá bán (₫)', 'Giá bán (đ)', 'Giá bán', 'Gia ban']),
        marketColumns: [],
        minPrice: findHeaderIndex(headers, ['Min']),
        gapValue: findHeaderIndex(headers, ['Lợi nhuận', 'Loi nhuan', 'GAP']),
        gapPercent: findHeaderIndex(headers, ['% Lợi nhuận', '% Loi nhuan', '%GAP']),
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
