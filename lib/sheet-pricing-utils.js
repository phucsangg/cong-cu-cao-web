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
                let cleanText = text;
                const decimalRegex = /[.,](\d{1,2})\s*(?:[₫đ]|vnd|vnđ|dong|đồng)?$/i;
                cleanText = cleanText.replace(decimalRegex, '');
                
                const digits = cleanText.replace(/\D/g, '');
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

function getPercentile(arr, p) {
    if (arr.length === 0) return 0;
    if (arr.length === 1) return arr[0];
    const index = p * (arr.length - 1);
    const low = Math.floor(index);
    const high = Math.ceil(index);
    const weight = index - low;
    return arr[low] * (1 - weight) + arr[high] * weight;
}

function removeOutliersIQR(sortedPrices) {
    if (sortedPrices.length < 4) {
        return { filtered: [...sortedPrices], outlierRemoved: false };
    }
    const q1 = getPercentile(sortedPrices, 0.25);
    const q3 = getPercentile(sortedPrices, 0.75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    const filtered = sortedPrices.filter(p => p >= lowerBound && p <= upperBound);
    const outlierRemoved = filtered.length < sortedPrices.length;
    return { filtered, outlierRemoved };
}

function getMedian(arr) {
    if (arr.length === 0) return null;
    const mid = Math.floor(arr.length / 2);
    if (arr.length % 2 !== 0) {
        return arr[mid];
    }
    return Math.round((arr[mid - 1] + arr[mid]) / 2);
}

function computeSuggestedPricing({ listPrice, costPrice, currentSalePrice, prices = [] }) {
    const parsedPrices = prices
        .map(parseVietnamesePrice)
        .filter((price) => Number.isFinite(price) && price > 0);

    const sortedPrices = [...parsedPrices].sort((a, b) => a - b);
    
    // Top 10 lowest prices (with duplicates) for GSheet columns
    const marketPrices = sortedPrices.slice(0, 10);

    // For statistics and Suggested Price, deduplicate first
    const uniquePrices = Array.from(new Set(parsedPrices)).sort((a, b) => a - b);
    
    // Outliers filtering using IQR
    const { filtered: iqrFiltered, outlierRemoved: iqrRemoved } = removeOutliersIQR(uniquePrices);
    
    const minPrice = iqrFiltered.length > 0 ? iqrFiltered[0] : null;
    const maxPrice = iqrFiltered.length > 0 ? iqrFiltered[iqrFiltered.length - 1] : null;
    const avgPrice = iqrFiltered.length > 0 ? Math.round(iqrFiltered.reduce((sum, p) => sum + p, 0) / iqrFiltered.length) : null;
    const medianPrice = iqrFiltered.length > 0 ? getMedian(iqrFiltered) : null;

    // Determine suggestedPrice
    let suggestedList = [...iqrFiltered];
    let suggestedOutlierRemoved = false;
    if (suggestedList.length >= 2 && suggestedList[0] < suggestedList[1] * 0.9) {
        suggestedList.shift();
        suggestedOutlierRemoved = true;
    }

    let suggestedPrice = null;
    if (suggestedList.length >= 5) {
        suggestedPrice = getMedian(suggestedList);
    } else if (suggestedList.length > 0) {
        suggestedPrice = suggestedList[0];
    }

    const salePriceValue = parseVietnamesePrice(currentSalePrice);
    const listPriceValue = parseVietnamesePrice(listPrice);
    const costPriceValue = parseVietnamesePrice(costPrice);

    const comparisonPrice = salePriceValue !== null ? salePriceValue : listPriceValue;

    // Lợi nhuận = Giá bán (₫) hoặc Giá niêm yết (₫) - Giá vốn (₫)
    const gapValue = (comparisonPrice !== null && costPriceValue !== null) ? (comparisonPrice - costPriceValue) : null;

    // % Lợi nhuận = Lợi nhuận / comparisonPrice
    const gapPercent = (gapValue !== null && comparisonPrice !== null && comparisonPrice > 0) ? (gapValue / comparisonPrice) : null;

    return {
        marketPrices,
        minPrice,
        maxPrice,
        avgPrice,
        medianPrice,
        gapValue,
        gapPercent,
        suggestedPrice,
        outlierRemoved: iqrRemoved || suggestedOutlierRemoved,
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

// Model Matching and Suffix/Prefix Conflict checking functions
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

const CONFLICTING_SUFFIXES = new Set([
    'PLUS', 'PRO', 'S', 'T', 'SE', 'MAX', 'LITE', 'EVO', 'GOLD', 'DELUXE', 'PREMIUM',
    'DI', 'DE', 'EG', 'EU', 'GB', 'GER', 'PL', 'PP', 'PA', 'PB', 'PC', 'C', 'I', 'IC', 'ID'
]);

function matchesPrefix(tokens, index, modelPrefix) {
    if (!modelPrefix) return true;
    
    const token = tokens[index];
    const tokenParts = splitModelToken(token);
    const tokenPrefix = tokenParts ? tokenParts.prefix : '';
    if (tokenPrefix === modelPrefix) return true;

    // Join up to 3 preceding tokens
    const start = Math.max(0, index - 3);
    const joinedPreceding = tokens.slice(start, index).join('');
    if (joinedPreceding.endsWith(modelPrefix)) {
        return true;
    }

    if (tokenPrefix && modelPrefix.endsWith(tokenPrefix)) {
        const neededPreceding = modelPrefix.slice(0, modelPrefix.length - tokenPrefix.length);
        if (joinedPreceding.endsWith(neededPreceding)) {
            return true;
        }
    }
    
    return false;
}

const COMMON_WORDS = new Set([
    'BEP', 'TU', 'MAY', 'HUT', 'MUI', 'LO', 'VI', 'SONG', 'NUONG', 'CHAU', 'RUA',
    'CHEN', 'BAT', 'VOI', 'KHOA', 'DIEN', 'TU', 'KET', 'SAT', 'GIAO', 'HANG',
    'BAO', 'HANH', 'NAM', 'THUONG', 'HIEU', 'SAN', 'PHAM', 'DOI', 'CHI', 'HANH',
    'HTTPS', 'HTTP', 'WWW', 'COM', 'VN', 'NET', 'ORG', 'SELECT', 'OPTION'
]);

function getFullPrefix(tokens, index, modelDigits, normBrand) {
    const start = Math.max(0, index - 4);
    const preceding = tokens.slice(start, index);
    const cleanPreceding = preceding.filter(tok => {
        if (COMMON_WORDS.has(tok)) return false;
        if (normBrand && tok.includes(normBrand)) return false;
        if (normBrand && normBrand.includes(tok)) return false;
        return true;
    });

    const token = tokens[index];
    const tokenParts = splitModelToken(token);
    const tokenPrefix = tokenParts ? tokenParts.prefix : '';
    const cleanTokenPrefix = [tokenPrefix].filter(tok => {
        if (!tok) return false;
        if (COMMON_WORDS.has(tok)) return false;
        if (normBrand && tok.includes(normBrand)) return false;
        if (normBrand && normBrand.includes(tok)) return false;
        return true;
    }).join('');

    return cleanPreceding.join('') + cleanTokenPrefix;
}

function hasConflictingModelPrefix(text = '', model = '', brand = '') {
    const modelParts = splitModelToken(model);
    if (!modelParts || !modelParts.digits) return false;

    const normBrand = brand ? normalizeModelText(brand) : '';

    // Get model full prefix
    const modelTokens = normalizeVietnameseText(model).toUpperCase().match(/[A-Z0-9]+/g) || [];
    let modelFullPrefix = '';
    const modelDigitIdx = modelTokens.findIndex(token => {
        const parts = splitModelToken(token);
        return parts && parts.digits === modelParts.digits;
    });

    if (modelDigitIdx !== -1) {
        modelFullPrefix = getFullPrefix(modelTokens, modelDigitIdx, modelParts.digits, normBrand);
    } else {
        modelFullPrefix = modelParts.prefix;
    }

    if (!modelFullPrefix) return false; // Model has no prefix to conflict with

    const tokens = normalizeVietnameseText(text).toUpperCase().match(/[A-Z0-9]+/g) || [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenParts = splitModelToken(token);
        if (!tokenParts) continue;
        if (tokenParts.digits !== modelParts.digits) continue;

        const textFullPrefix = getFullPrefix(tokens, i, modelParts.digits, normBrand);
        if (textFullPrefix) {
            if (!textFullPrefix.endsWith(modelFullPrefix) && !modelFullPrefix.endsWith(textFullPrefix)) {
                return true;
            }
        }
    }

    return false;
}

function hasConflictingModelSuffix(text = '', model = '') {
    const modelParts = splitModelToken(model);
    if (!modelParts || !modelParts.digits) return false;
    const modelFullSuffix = modelParts.suffix;

    const tokens = normalizeVietnameseText(text).toUpperCase().match(/[A-Z0-9]+/g) || [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenParts = splitModelToken(token);
        if (!tokenParts) continue;
        if (tokenParts.digits !== modelParts.digits) continue;
        if (!matchesPrefix(tokens, i, modelParts.prefix)) continue;

        let textFullSuffix = tokenParts.suffix;
        for (let j = i + 1; j < tokens.length; j++) {
            const tok = tokens[j];
            if (CONFLICTING_SUFFIXES.has(tok)) {
                textFullSuffix += tok;
            } else {
                break;
            }
        }

        if (modelFullSuffix === textFullSuffix) {
            continue;
        }

        if (modelFullSuffix === '') {
            if (textFullSuffix !== '') {
                return true;
            }
        }

        if (modelFullSuffix.startsWith(textFullSuffix)) {
            const extra = modelFullSuffix.slice(textFullSuffix.length);
            if (CONFLICTING_SUFFIXES.has(extra)) {
                return true;
            }
        } else if (textFullSuffix.startsWith(modelFullSuffix)) {
            const extra = textFullSuffix.slice(modelFullSuffix.length);
            if (CONFLICTING_SUFFIXES.has(extra)) {
                return true;
            }
        } else {
            return true;
        }
    }

    return false;
}

function isModelMatch(titleOrUrl, model, brand = '') {
    if (hasConflictingModelPrefix(titleOrUrl, model, brand)) {
        return false;
    }
    const normText = normalizeModelText(titleOrUrl);
    const normModel = normalizeModelText(model);
    if (!normModel) return false;
    
    // 1. Exact inclusion match with digit boundary safety
    if (normText.includes(normModel)) {
        const startIdx = normText.indexOf(normModel);
        const endIdx = startIdx + normModel.length;
        const prevChar = startIdx > 0 ? normText[startIdx - 1] : '';
        const nextChar = endIdx < normText.length ? normText[endIdx] : '';
        
        const isPrevDigit = /\d/.test(prevChar) && /\d/.test(normModel[0]);
        const isNextDigit = /\d/.test(nextChar) && /\d/.test(normModel[normModel.length - 1]);
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
            
            const isPrevDigit = /\d/.test(prevChar) && /\d/.test(longestSegment[0]);
            const isNextDigit = /\d/.test(nextChar) && /\d/.test(longestSegment[longestSegment.length - 1]);
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

// Smart keyword variants generator helpers
function getCategoryKeyword(sheetName = '') {
    const name = normalizeVietnameseText(sheetName);
    if (name.includes('giat s') || name.includes('say')) return 'máy sấy';
    if (name.includes('giat')) return 'máy giặt';
    if (name.includes('bep tu') || name.includes('bep')) return 'bếp từ';
    if (name.includes('hut mui') || name.includes('hut')) return 'máy hút mùi';
    if (name.includes('lo nuong') || name.includes('lo')) return 'lò nướng';
    if (name.includes('rua bat') || name.includes('rua chen') || name.includes('rua')) return 'máy rửa bát';
    if (name.includes('xay') || name.includes('blender')) return 'máy xay sinh tố';
    if (name.includes('loc nuoc')) return 'máy lọc nước';
    return '';
}

function getNormalizedModelVariants(model) {
    if (!model) return [];
    const clean = String(model).trim();
    const noHyphen = clean.replace(/[-_]/g, '');
    const noSpace = clean.replace(/\s+/g, '');
    const fullyClean = clean.replace(/[^a-zA-Z0-9]/g, '');
    
    const variants = new Set([
        clean,
        noHyphen,
        noSpace,
        fullyClean,
        clean.toLowerCase(),
        clean.toUpperCase(),
        noHyphen.toLowerCase(),
        noHyphen.toUpperCase(),
        noSpace.toLowerCase(),
        noSpace.toUpperCase(),
        fullyClean.toLowerCase(),
        fullyClean.toUpperCase()
    ]);
    return Array.from(variants);
}

function generateKeywords(brand = '', model = '', sheetName = '') {
    const keywords = new Set();
    const cleanBrand = String(brand).trim();
    const cleanModel = String(model).trim();
    
    if (!cleanModel) return [];
    
    // Main brand + model variants
    const brandModel = cleanBrand ? `${cleanBrand} ${cleanModel}` : cleanModel;
    keywords.add(brandModel);
    keywords.add(cleanModel);
    keywords.add(`"${cleanModel}"`);
    
    if (cleanBrand) {
        keywords.add(`${cleanBrand} ${cleanModel} giá`);
        keywords.add(`${cleanBrand} ${cleanModel} khuyến mãi`);
        keywords.add(`${cleanBrand} ${cleanModel} site:.vn`);
    } else {
        keywords.add(`${cleanModel} giá`);
        keywords.add(`${cleanModel} site:.vn`);
    }
    
    // Mapped category
    const category = getCategoryKeyword(sheetName);
    if (category) {
        const capitalizedCategory = category.charAt(0).toUpperCase() + category.slice(1);
        if (cleanBrand) {
            keywords.add(`${capitalizedCategory} ${cleanBrand} ${cleanModel}`);
        } else {
            keywords.add(`${capitalizedCategory} ${cleanModel}`);
        }
    }
    
    // Bosch Series logic
    if (cleanBrand.toLowerCase() === 'bosch') {
        keywords.add(`Bosch Series 8 ${cleanModel}`);
        keywords.add(`Bosch Series 6 ${cleanModel}`);
    }
    
    // Trailing suffix extraction (e.g. QA65QN90A -> QA65QN90)
    const suffixMatch = cleanModel.match(/^(.*?\d+)([A-Z]+)$/i);
    if (suffixMatch) {
        const baseModel = suffixMatch[1];
        const brandBase = cleanBrand ? `${cleanBrand} ${baseModel}` : baseModel;
        keywords.add(brandBase);
        keywords.add(baseModel);
        keywords.add(`"${baseModel}"`);
        if (cleanBrand) {
            keywords.add(`${cleanBrand} ${baseModel} giá`);
        }
    }
    
    // Normalized variants
    const variants = getNormalizedModelVariants(cleanModel);
    for (const variant of variants) {
        if (variant !== cleanModel) {
            const brandVar = cleanBrand ? `${cleanBrand} ${variant}` : variant;
            keywords.add(brandVar);
            keywords.add(variant);
        }
    }
    
    return Array.from(keywords).filter(Boolean);
}

function calculateRelevanceScore(url = '', model = '', brand = '') {
    if (!model) return 0;
    
    let score = 0;
    const normUrl = url.toLowerCase();
    const normModel = normalizeModelText(model).toLowerCase();
    const normBrand = normalizeModelText(brand).toLowerCase();

    // 1. +40 if URL contains exact model
    if (normModel && normalizeModelText(url).toLowerCase().includes(normModel)) {
        score += 40;
    }

    // 2. +20 if URL contains brand
    if (normBrand && normalizeModelText(url).toLowerCase().includes(normBrand)) {
        score += 20;
    }

    // 3. +10 if URL contains hyphens
    if (url.includes('-')) {
        score += 10;
    }

    // 4. +10 if URL contains product slug
    if (/\/(product|products|p|sp|san-pham|ct|chi-tiet|detail|item|shop|store)\//i.test(normUrl)) {
        score += 10;
    }

    // 5. +10 if URL ends with .html or .htm
    if (/\.html?(?:$|[?#])/i.test(normUrl)) {
        score += 10;
    }

    // 6. +10 if URL belongs to a commercial e-commerce domain
    try {
        const host = new URL(url).hostname.toLowerCase();
        const isNonCommercial = /(google|bing|duckduckgo|coccoc|wordpress|blogspot|medium|wikipedia|facebook|youtube|pinterest)/i.test(host);
        if (!isNonCommercial) {
            score += 10;
        }

        // Whitelist domain bonus (Phần 7)
        const whitelist = [
            'dienmayxanh.com',
            'nguyenkim.com',
            'mediamart.vn',
            'hc.com.vn',
            'dienmaycholon.vn',
            'cellphones.com.vn',
            'fptshop.com.vn'
        ];
        const isWhitelisted = whitelist.some(d => host.includes(d));
        if (isWhitelisted) {
            score += 200;
        }
    } catch (e) {
        // Skip
    }

    // Negative points
    // 7. -50 if URL contains block keywords
    const blockedKeywords = [
        'search', 'tim-kiem', 'collection', 'collections', 'category', 'danh-muc',
        'tag', 'tags', 'news', 'tin-tuc', 'blog', 'article', 'gio-hang', 'cart', 'checkout'
    ];
    if (blockedKeywords.some(keyword => normUrl.includes(keyword))) {
        score -= 50;
    }

    // 8. -100 if URL contains conflicting extended models
    if (hasConflictingModelSuffix(url, model) || hasConflictingModelPrefix(url, model, brand)) {
        score -= 100;
    }

    return Math.max(0, Math.min(300, score));
}

module.exports = {
    parseVietnamesePrice,
    normalizeModelText,
    computeSuggestedPricing,
    mapSheetHeaders,
    buildSheetUpdateRow,
    normalizeVietnameseText,
    splitModelToken,
    matchesPrefix,
    getFullPrefix,
    hasConflictingModelPrefix,
    hasConflictingModelSuffix,
    isModelMatch,
    getCategoryKeyword,
    getNormalizedModelVariants,
    generateKeywords,
    calculateRelevanceScore,
};
