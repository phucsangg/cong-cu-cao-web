import fs from 'fs';
import path from 'path';

/**
 * Remove Vietnamese accents/diacritics from a string
 */
export function removeVietnameseTones(str) {
    if (!str) return '';
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ý|Ỳ|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    
    // Remove styling marks
    str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, "");
    str = str.replace(/\u02C6|\u0306|\u031B/g, "");
    return str;
}

/**
 * Clean noise words from product name
 */
export function cleanNoiseWords(name) {
    if (!name) return '';
    let clean = name.toLowerCase();
    
    const noiseWords = [
        'chính hãng', 'chinh hang', 'cao cấp', 'cao cap', 'giá tốt', 'gia tot',
        'khuyến mãi', 'khuyen mai', 'bảo hành', 'bao hanh', 'nhập khẩu', 'nhap khau',
        'hàng mới', 'hang moi', 'giá rẻ', 'gia re', 'nhập đức', 'nhap duc', 'châu âu', 'chau au'
    ];
    
    noiseWords.forEach(word => {
        const regex = new RegExp('\\b' + word + '\\b', 'gi');
        clean = clean.replace(regex, '');
    });
    
    // Remove extra punctuation and symbols
    clean = clean.replace(/[\[\]|,\-+()]/g, ' ');
    // Remove double spaces
    clean = clean.replace(/\s+/g, ' ').trim();
    
    return clean;
}

/**
 * Extract model (SKU) and Series from name based on test-fetch.mjs implementation
 */
export function removeVietnameseTone(str = '') {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'D');
}

export function getSlug(link = '') {
    try {
        const url = new URL(link);
        return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    } catch {
        return '';
    }
}

export function cleanText(str = '') {
    return removeVietnameseTone(str)
        .replace(/[×–—]/g, ' ')
        .replace(/[_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function extractSeries(text) {
    const m = cleanText(text).match(/\b(?:series|serie|seri)\s*(\d+)\b/i);
    return m ? m[1] : null;
}

export function extractSize(text) {
    const m = cleanText(text).match(/\b\d+(?:[.,]\d+)?\s*[-_]?\s*(?:cm|mm|l|lit|lít|kg|g)(?![a-zA-ZÀ-ỹ])/i);
    return m ? m[0].replace(/[-_\s]+/g, '').toUpperCase() : null;
}

export function stripNonCodeInfo(text) {
    return cleanText(text)
        .replace(/\b(?:series|serie|seri)\s*\d+\b/gi, ' ')
        .replace(/\b\d+(?:[.,]\d+)?\s*[-_]?\s*(?:cm|mm|l|lit|lít|kg|g)(?![a-zA-ZÀ-ỹ])/gi, ' ')
        .replace(/\b\d+\s*(?:bộ|bo|món|mon|lớp|lop|năm|nam)(?![a-zA-ZÀ-ỹ])/gi, ' ')
        .replace(/\bAISI\s*304\b/gi, ' ')
        .replace(/\bSUS\s*304\b/gi, ' ')
        .replace(/\bPVD\s*\d+\b/gi, ' ')
        .replace(/\b\d{2,4}\s*[x×]\s*\d{2,4}\b/gi, ' ')
        .replace(/\b\d{2,4}[-_]\d{2,4}\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function removeRepeatingSegments(str) {
    const parts = str.split('-');
    if (parts.length % 2 === 0) {
        const half = parts.length / 2;
        const firstHalf = parts.slice(0, half).join('-');
        const secondHalf = parts.slice(half).join('-');
        if (firstHalf === secondHalf) {
            return firstHalf;
        }
    }
    return str;
}

export function scoreCode(code, fullText) {
    const c = code.toUpperCase();
    
    if (!(/[A-Z]/.test(c) && /\d/.test(c))) {
        return 0;
    }

    let score = 5;

    if (c.length >= 6) score += 3;
    if (/[-_.]/.test(c)) score += 2;
    
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = (fullText.match(new RegExp(escaped, 'gi')) || []).length;
    if (occurrences > 1) {
        score += 2;
    }

    if (/(VIGO|STELO|NERON|TARI|MEKONG|DIAMOND)/i.test(c)) {
        score += 5;
    }

    if (/^\d+[-_]?(CM|MM|L|LIT|LITRES?|W|KG|G)$/i.test(c)) score -= 10;
    
    const penaltyPattern = /\b(PVD|AISI|SUS|BAT|BO|TRANG|SAN|GIA|KHUYEN|BAO|NHAP|MOI|NEW|SERIES|SERI|SERIE|LAP|DOC|AM|DUONG|LINEN|BEP|HUT|MUI|RUA|BAT|CHEN|TU|LANH|RUOU|LO|VI|SONG|NUONG|VOI|CHAU|CHONG|XUOC|CONG|NGHE|POSCO|SS304|STT|BOSCH|TEFAL|HAFELE|KOCHER|TOSHIBA|KONOX|SPELIER|KAFF|DEN|BAC|KEM|XAM|PRO|AI|LIT|CUONG|TANG|SAY|DUC|MALAYSIA|THAI|VIET|NAM|CHINH|HANG|CAO|CAP|202\d|201\d|199\d)\b/i;
    if (penaltyPattern.test(c)) {
        score -= 10;
    }

    return score;
}

export function extractModelInfo(name = '', link = '') {
    const slug = getSlug(link);
    const rawText = `${name} ${slug} ${slug.replace(/-/g, ' ')}`;
    const normalized = cleanText(rawText).toUpperCase();

    const series = extractSeries(rawText);
    const size = extractSize(rawText);

    let candidates = [];

    const kaff = slug.match(/kaffkf-?([a-z0-9]+)/i);
    if (kaff) candidates.push(`KF-${kaff[1].toUpperCase()}`);

    const konox = normalized.match(/\b(VIGO|STELO|NERON|TARI(?:[-_\s]+SMART)?|MEKONG|DIAMOND)[-_\s]+(\d{3,4}[A-Z]{0,2})\b/i);
    if (konox) candidates.push(`${konox[1]} ${konox[2]}`.replace(/[-_]/g, ' ').toUpperCase());

    const textForCode = stripNonCodeInfo(rawText).toUpperCase();

    const codePatterns = [
        /\b\d{3}[._-]\d{2}[._-]\d{3}\b/gi,
        /\b[A-Z0-9]{2,5}[-_][A-Z0-9]{3,10}\b/gi,
        /\b[A-Z][-_][A-Z0-9]{3,8}\b/gi,
        /\b[A-Z0-9]{2,5}[-_]\d{3}[-_][A-Z]{3,4}\b/gi,
        /\b[A-Z]{2}[-_]\d{2}[-_][A-Z0-9]{3,8}\b/gi,
        /\b[A-Z][-_][A-Z]{3,5}[-_]\d(?:[-_][A-Z]{3,5})?\b/gi,
        /\b[A-Z]{2,3}[-_]\d{2}\b/gi,
        /\b[A-Z]{2,}\d[A-Z0-9]{1,}\b/gi,
        /\b[A-Z]\d[A-Z0-9]{1,}\b/gi
    ];

    for (const re of codePatterns) {
        const found = textForCode.match(re) || [];
        candidates.push(...found);
    }

    candidates = [...new Set(
        candidates
            .map(x => {
                let formatted = x.replace(/[._]/g, '.').replace(/\s+/g, ' ').trim().toUpperCase();
                formatted = removeRepeatingSegments(formatted);
                if (/(VIGO|STELO|NERON|TARI|MEKONG|DIAMOND)/i.test(formatted)) {
                    formatted = formatted.replace(/-/g, ' ');
                }
                return formatted;
            })
            .filter(Boolean)
    )];

    const ranked = candidates
        .map(code => ({ code, score: scoreCode(code, normalized) }))
        .filter(x => x.score >= 5)
        .sort((a, b) => b.score - a.score);

    const nonSubstrings = ranked.filter((item, idx) => {
        return !ranked.some((other, otherIdx) => otherIdx !== idx && other.code.includes(item.code));
    });

    return {
        maSanPham: nonSubstrings[0]?.code || null,
        series,
        kichThuoc: size
    };
}


export function getCleanName(fullName, maSanPham, series, kichThuoc) {
    let clean = fullName;
    if (maSanPham) {
        const escaped = maSanPham.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        clean = clean.replace(new RegExp(escaped, 'gi'), '');
        
        const parts = maSanPham.split(/\s+/);
        if (parts.length > 1) {
            const pattern = parts.join('\\s*[-_]?\\s*');
            clean = clean.replace(new RegExp(pattern, 'gi'), '');
        }
    }
    
    clean = clean.replace(/\b\d+(?:[\s.,]\d{3})*(?:\s*(?:đ|₫|vnd|vnđ|vnd))(?![a-zA-ZÀ-ỹ])/gi, '');
    clean = clean.replace(/\b[-+]?\s*\d+\s*%(?![a-zA-ZÀ-ỹ])/g, '');
    clean = clean.replace(/\b(?:series|serie|seri)\s*\d+\b/gi, '');
    clean = clean.replace(/\b\d+(?:[.,]\d+)?\s*[-_]?\s*(?:cm|mm|l|lit|lít|w|kw|kg|g)(?![a-zA-ZÀ-ỹ])/gi, '');
    clean = clean.replace(/\b(?:AISI\s*304|SUS\s*304|PVD\s*\d+|lớp)(?![a-zA-ZÀ-ỹ])/gi, '');

    clean = clean.replace(/[\[\]|,\-+()]/g, ' ');
    clean = clean.replace(/\s+/g, ' ').trim();
    clean = clean.replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '');
    clean = clean.replace(/\/+\s*$/, '').replace(/^\s*\/+/, '');
    return clean.trim();
}

export function extractSku(fullName, link = '') {
    const info = extractModelInfo(fullName, link);
    const cleanName = getCleanName(fullName, info.maSanPham, info.series, info.kichThuoc);
    return {
        sku: info.maSanPham,
        series: info.series,
        kichThuoc: info.kichThuoc,
        cleanName: cleanName
    };
}

/**
 * Extract brand from title
 */
export function extractBrand(name) {
    const cleanName = name.toLowerCase();
    const brands = ['bosch', 'tefal', 'hafele', "chef's", 'chefs', 'kocher', 'toshiba', 'konox', 'spelier', 'kaff'];
    for (const b of brands) {
        if (cleanName.includes(b)) {
            if (b === 'chefs' || b === "chef's") return "Chef's";
            return b.charAt(0).toUpperCase() + b.slice(1);
        }
    }
    return 'Khác';
}

/**
 * Parse price information from price and name strings
 */
export function parsePrice(giaStr, nameStr) {
    const text = ((nameStr || '') + ' ' + (giaStr || '')).toLowerCase();
    
    if (text.includes('liên hệ') || text.includes('lien he') || text.includes('gọi') || text.includes('goi') || text.includes('contact')) {
        return { price: null, originalPrice: null, discountPercent: null, priceStatus: 'contact' };
    }

    const priceRegex = /\b\d+(?:[.,]\d{3})*(?:\s*(?:đ|₫|vnd|vnđ|vnd))?/gi;
    const matches = [];
    let m;
    while ((m = priceRegex.exec(text)) !== null) {
        const cleanNum = parseInt(m[0].replace(/\D/g, '')) || 0;
        if (cleanNum > 1000) {
            matches.push(cleanNum);
        }
    }

    let discountPercent = null;
    const discRegex = /[-+]\s*(\d+)\s*%/i;
    const discMatch = text.match(discRegex);
    if (discMatch) {
        discountPercent = parseInt(discMatch[1]);
    }

    let price = null;
    let originalPrice = null;

    if (matches.length === 1) {
        price = matches[0];
    } else if (matches.length >= 2) {
        const sorted = [...new Set(matches)].sort((a, b) => a - b);
        if (sorted.length === 1) {
            price = sorted[0];
        } else {
            price = sorted[0];
            originalPrice = sorted[1];
        }
    }

    if (!price && giaStr) {
        const numericOnly = parseInt(giaStr.replace(/\D/g, '')) || 0;
        if (numericOnly > 0) {
            price = numericOnly;
        }
    }

    if (price) {
        if (!discountPercent && originalPrice && originalPrice > price) {
            discountPercent = Math.round(((originalPrice - price) / originalPrice) * 100);
        }
        return {
            price,
            originalPrice: originalPrice || null,
            discountPercent: discountPercent || null,
            priceStatus: 'available'
        };
    }

    return { price: null, originalPrice: null, discountPercent: null, priceStatus: 'contact' };
}

/**
 * Main normalization pipeline for a raw product object
 */
export function normalizeProduct(rawProd) {
    const rawTitle = rawProd.ten || '';
    const skuInfo = extractSku(rawTitle, rawProd.link || '');
    
    // Clean name further from noise and models
    let cleanTitle = skuInfo.cleanName;
    cleanTitle = cleanNoiseWords(cleanTitle);

    const brand = extractBrand(rawTitle);
    const priceInfo = parsePrice(rawProd.gia, rawTitle);

    return {
        rawTitle: rawTitle,
        cleanTitle: cleanTitle,
        model: skuInfo.sku || null,
        series: skuInfo.series || null,
        kichThuoc: skuInfo.kichThuoc || null,
        brand: brand,
        price: priceInfo.price,
        originalPrice: priceInfo.originalPrice,
        discountPercent: priceInfo.discountPercent,
        priceStatus: priceInfo.priceStatus,
        link: rawProd.link || '',
        image: rawProd.anh || '',
        page: rawProd.trang || 1
    };
}
