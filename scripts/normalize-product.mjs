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
export function extractSku(fullName) {
    let cleanText = fullName.replace(/\b(\d+)\s+([A-Z]{1,4})/gi, (match, g1, g2, offset, str) => {
        const nextChar = str[offset + match.length];
        const letterRegex = /[a-zA-Z]/i;
        if (nextChar && letterRegex.test(nextChar)) {
            return match;
        }
        return g1 + g2;
    });

    cleanText = cleanText.replace(/\b\d+(?:[.,]\d{3})*\s*(?:đ|₫|VND|vnđ|vnd)/gi, '');
    cleanText = cleanText.replace(/[-+]\s*\d+\s*%/g, '');
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    let codes = [];
    const dotReg = /\b\d{3}\.\d{2}\.\d{3}\b/g;
    let match;
    while ((match = dotReg.exec(cleanText)) !== null) {
        codes.push(match[0]);
    }
    
    const modelReg = /\b(?:[A-Z]{1,4}[- _]?)?[A-Z_]*\d+[A-Z0-9_]*(?:[-/_][A-Z0-9_]+)*(?:[- ]?(?:PLUS|PRO|NOTE|KPLUS|EG|VN|EVN|IN|II|IG|Z|S|G|[A-Z]{2,4}))?\b/gi;
    while ((match = modelReg.exec(cleanText)) !== null) {
        const matched = match[0];
        const prevChar = match.index > 0 ? cleanText[match.index - 1] : '';
        const nextChar = cleanText[match.index + matched.length];
        const letterRegex = /[a-zA-Z]/i;
        const isPrevLetter = prevChar && letterRegex.test(prevChar);
        const isNextLetter = nextChar && letterRegex.test(nextChar);
        
        if (!isPrevLetter && !isNextLetter) {
            let cleanedCode = matched;
            const excludedWords = [
                'GAS', 'VÙNG', 'VUNG', 'NẤU', 'NAU', 'LÍT', 'LIT', 'TỪ', 'TU', 'ĐÔI', 'DOI',
                'HỒNG', 'NGOẠI', 'LÒ', 'HÚT', 'MÙI', 'MÁY', 'RỬA', 'BÁT', 'CHÉN', 'KÍNH',
                'ÂM', 'DƯƠNG', 'NHẬP', 'KHẨU', 'ĐỨC', 'DUC', 'TÂY', 'BAN', 'NHA', 'THÁI', 'LAN', 'THAI',
                'MALAYSIA', 'HÀNG', 'CHÍNH', 'HÃNG', 'GIA', 'GIÁ', 'RẺ', 'RE', 'TẶNG', 'TANG', 'QUÀ', 'QUA',
                'KHUYẾN', 'KHUYEN', 'MÃI', 'MAI', 'HOT', 'NEW', 'MODEL', 'BẾP', 'BEP', 'ĐIỆN', 'DIEN',
                'VÙNG NẤU', 'VUNG NAU', 'KÍNH ÂM', 'KINH AM', 'NHẬP KHẨU', 'NHAP KHAU', 'CHÍNH HÃNG', 'CHINH HANG',
                'TRANG', 'MS', 'VV', 'GB', 'TB', 'MB', 'VÒNG', 'VONG', 'LÍT/PHÚT', 'LIT/PHUT', 'MÉT', 'MET',
                'INOX', 'PHI', 'PHÍ', 'ĐỘ', 'DO', 'NĂM', 'NAM', 'KÍCH', 'KICH', 'THÁNG', 'THANG', 'BẢO', 'HÀNH', 
                'BAO', 'HANH', 'BH', 'ĐỨNG', 'DUNG', 'NẰM', 'ĐẦU', 'DAU', 'LỖ', 'LO', 'BỘ', 'BO', 'CÁNH', 'CANH', 
                'KHE', 'KHAY', 'MÂM', 'MAM', 'CHẬU', 'CHAU', 'VÒI', 'VOI', 'RỔ', 'RO', 'KỆ', 'KE', 'ĐÁ', 'DA', 
                'CẮT', 'CAT', 'MẶT', 'MAT', 'DÀY', 'DAY', 'RỘNG', 'RONG', 'CAO', 'SÂU', 'SAU', 'THÀNH', 'THANH', 
                'PHÂN', 'PHAN', 'LI', 'LY', 'CHÂN', 'CHAN', 'ỐNG', 'ONG', 'KHOÁ', 'KHOA', 'CỬA', 'CUA', 'HỐ', 
                'HO', 'CHỔI', 'CHOI', 'DÂY', 'DAY'
            ];
            const lastWordMatch = matched.match(/[- ]([A-Z]{2,4})$/i);
            if (lastWordMatch) {
                const lastWord = lastWordMatch[1].toUpperCase();
                if (excludedWords.includes(lastWord)) {
                    cleanedCode = matched.substring(0, matched.length - lastWordMatch[0].length).trim();
                }
            }
            codes.push(cleanedCode);
        }
    }

    let uniqueCodes = [...new Set(codes)];
    
    uniqueCodes = uniqueCodes.filter(code => {
        const clean = code.trim().toUpperCase();
        if (clean.length < 3) return false;
        if (/^\d{3}\.\d{2}\.\d{3}$/.test(clean)) return true;
        if (!/[A-Z]/.test(clean) || !/\d/.test(clean)) return false;
        if (/(?:INOX|SUS|SS304|SS201|SS316|SS430|S304|S201|S316|S430)/i.test(clean)) return false;
        if (/^(?:INOX|SUS)$/i.test(clean)) return false;
        if (/^X\s*\d+$/i.test(clean)) return false;
        const excludedWords = [
            'GAS', 'VÙNG', 'VUNG', 'NẤU', 'NAU', 'LÍT', 'LIT', 'TỪ', 'TU', 'ĐÔI', 'DOI',
            'HỒNG', 'NGOẠI', 'LÒ', 'HÚT', 'MÙI', 'MÁY', 'RỬA', 'BÁT', 'CHÉN', 'KÍNH',
            'ÂM', 'DƯƠNG', 'NHẬP', 'KHẨU', 'ĐỨC', 'DUC', 'TÂY', 'BAN', 'NHA', 'THÁI', 'LAN', 'THAI',
            'MALAYSIA', 'HÀNG', 'CHÍNH', 'HÃNG', 'GIA', 'GIÁ', 'RẺ', 'RE', 'TẶNG', 'TANG', 'QUÀ', 'QUA',
            'KHUYẾN', 'KHUYEN', 'MÃI', 'MAI', 'HOT', 'NEW', 'MODEL', 'BẾP', 'BEP', 'ĐIỆN', 'DIEN',
            'VÙNG NẤU', 'VUNG NAU', 'KÍNH ÂM', 'KINH AM', 'NHẬP KHẨU', 'NHAP KHAU', 'CHÍNH HÃNG', 'CHINH HANG',
            'TRANG', 'MS', 'VV', 'GB', 'TB', 'MB', 'VÒNG', 'VONG', 'LÍT/PHÚT', 'LIT/PHUT', 'MÉT', 'MET',
            'INOX', 'PHI', 'PHÍ', 'ĐỘ', 'DO', 'NĂM', 'NAM', 'KÍCH', 'KICH', 'THÁNG', 'THANG', 'BẢO', 'HÀNH', 
            'BAO', 'HANH', 'BH', 'ĐỨNG', 'DUNG', 'NẰM', 'ĐẦU', 'DAU', 'LỖ', 'LO', 'BỘ', 'BO', 'CÁNH', 'CANH', 
            'KHE', 'KHAY', 'MÂM', 'MAM', 'CHẬU', 'CHAU', 'VÒI', 'VOI', 'RỔ', 'RO', 'KỆ', 'KE', 'ĐÁ', 'DA', 
            'CẮT', 'CAT', 'MẶT', 'MAT', 'DÀY', 'DAY', 'RỘNG', 'RONG', 'CAO', 'SÂU', 'SAU', 'THÀNH', 'THANH', 
            'PHÂN', 'PHAN', 'LI', 'LY', 'CHÂN', 'CHAN', 'ỐNG', 'ONG', 'KHOÁ', 'KHOA', 'CỬA', 'CUA', 'HỐ', 
            'HO', 'CHỔI', 'CHOI', 'DÂY', 'DAY'
        ];
        if (excludedWords.includes(clean)) return false;
        const parts = clean.split(/[- ]+/);
        for (const part of parts) {
            if (excludedWords.includes(part) && !/\d/.test(part)) return false;
        }
        const isUnit = /^\d+(?:W|V|HZ|L|KG|PHUT|THANG|TRANG|MS|S|H|N|VN|TB|GB|MB|VÙNG|VUNG|VÒNG|VONG)$/i.test(clean);
        if (isUnit) return false;
        
        const isDimension = /^\d+\s*[xX]\s*\d+(?:\s*[xX]\s*\d+)*$/i.test(clean);
        if (isDimension) return false;
        return true;
    });

    uniqueCodes = uniqueCodes.filter(c => {
        return !uniqueCodes.some(other => other !== c && other.toLowerCase().includes(c.toLowerCase()));
    });
    
    let cleanName = cleanText;
    uniqueCodes.forEach(code => {
        const escapedCode = code.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const reg = new RegExp(escapedCode, 'gi');
        cleanName = cleanName.replace(reg, '');
    });
    
    cleanName = cleanName.replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').trim();
    cleanName = cleanName.replace(/\/+\s*$/, '').replace(/^\s*\/+/, '').replace(/\s+/g, ' ').trim();
    
    let baseSkus = [];
    let seriesSuffixes = [];
    const suffixRegex = /\s*(EG\/KPLUS|EG|KPLUS|PLUS|Iplus|EVN|VN|IN|PRO|NOTE|II|IG|Z|S|G|Plus|Pro|Note|Kplus|[A-Z]{2,4})$/i;
    uniqueCodes.forEach(code => {
        const matchSuffix = code.match(suffixRegex);
        if (matchSuffix) {
            const series = matchSuffix[1].toUpperCase();
            const rawBase = code.substring(0, code.length - matchSuffix[0].length);
            const baseSku = rawBase.replace(/[- ]+$/, '').trim();
            baseSkus.push(baseSku);
            seriesSuffixes.push(series);
        } else {
            baseSkus.push(code);
        }
    });

    return {
        sku: baseSkus.join(' / '),
        series: [...new Set(seriesSuffixes)].join(' / '),
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
    const skuInfo = extractSku(rawTitle);
    
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
