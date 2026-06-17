import fs from 'fs';
import * as cheerio from 'cheerio';

function extractSku(fullName) {
    // Clean price patterns like 9,480,000đ, 18.100.000 đ, etc.
    let cleanText = fullName.replace(/\b\d+(?:[.,]\d{3})*\s*(?:đ|₫|VND|vnđ|vnd)/gi, '');
    // Clean discount percentage like -48% or 48%
    cleanText = cleanText.replace(/[-+]\s*\d+\s*%/g, '');
    // Clean multiple spaces
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    let codes = [];
    
    // Pattern 1: Dotted codes (Hafele)
    const dotReg = /\b\d{3}\.\d{2}\.\d{3}\b/g;
    let match;
    while ((match = dotReg.exec(cleanText)) !== null) {
        codes.push(match[0]);
    }
    
    // Pattern 2: Comprehensive alphanumeric model code matching (case-insensitive)
    const modelReg = /\b(?:[A-Z]{2,4}[- _]?)?[A-Z_]*\d+[A-Z0-9_]*(?:[-/_][A-Z0-9_]+)*(?:[- ]?(?:PLUS|PRO|NOTE|KPLUS|EG|VN|EVN|IN|II|IG|Z|S|G))?\b/gi;
    while ((match = modelReg.exec(cleanText)) !== null) {
        codes.push(match[0]);
    }

    let uniqueCodes = [...new Set(codes)];
    
    // Filter codes using isValidSku helper logic
    uniqueCodes = uniqueCodes.filter(code => {
        const clean = code.trim().toUpperCase();
        if (clean.length < 3) return false;
        
        // Immediately allow Hafele article numbers (dotted codes)
        if (/^\d{3}\.\d{2}\.\d{3}$/.test(clean)) return true;
        
        // Must contain at least one digit and one letter
        if (!/[A-Z]/.test(clean) || !/\d/.test(clean)) return false;
        
        // Exclude common words
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
        
        // Check parts
        const parts = clean.split(/[- ]+/);
        for (const part of parts) {
            if (excludedWords.includes(part) && !/\d/.test(part)) {
                return false;
            }
        }
        
        // Exclude units
        const isUnit = /^\d+(?:W|V|HZ|L|KG|PHUT|THANG|TRANG|MS|S|H|N|VN|TB|GB|MB|VÙNG|VUNG|VÒNG|VONG)$/i.test(clean);
        if (isUnit) return false;
        
        // Exclude dimensions like 600x400, 700x400x150
        const isDimension = /^\d+\s*[xX]\s*\d+(?:\s*[xX]\s*\d+)*$/i.test(clean);
        if (isDimension) return false;
        
        return true;
    });

    // De-duplicate: if one code is a substring of another, keep the longer one
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
    
    // Split baseSku and series for each code
    let baseSkus = [];
    let seriesSuffixes = [];
    
    const suffixRegex = /\s*(EG\/KPLUS|EG|KPLUS|PLUS|Iplus|EVN|VN|IN|PRO|NOTE|II|IG|Z|S|G|Plus|Pro|Note|Kplus)$/i;
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

async function run() {
    try {
        const res = await fetch('https://bepxanh.com/bep-tu-doi.html', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const html = await res.text();
        const $ = cheerio.load(html);

        console.log('--- Product SKU Extraction Test ---');
        const titles = [];
        $('a').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 15 && txt.length < 150 && !txt.includes('\n') && (txt.toLowerCase().includes('bếp') || txt.toLowerCase().includes('kaff') || txt.toLowerCase().includes('hafele'))) {
                titles.push(txt);
            }
        });

        const uniqueTitles = [...new Set(titles)];
        uniqueTitles.forEach((t, idx) => {
            const ext = extractSku(t);
            console.log(`[${idx}] "${t}"`);
            console.log(`    => Clean: "${ext.cleanName}"`);
            console.log(`    => SKU: "${ext.sku}" | Series: "${ext.series}"`);
            console.log('');
        });
    } catch (err) {
        console.error(err);
    }
}

run().then(() => {
    console.log('--- Custom Test Cases for Underscore Models ---');
    const cases = [
        'Bếp từ Kocher BEPTU_DI882',
        'Bếp từ Kocher BEPTU_DI882M',
        'Bếp từ Kocher BEPTU_DI882PRO',
        'Bếp từ đôi Toshiba CIH-55DSU',
        'Bếp từ đơn Speller SP 09',
        'Bếp từ Kocher DI-339Pro 9,480,000đ 18,100,000đ -48%',
        'Bếp từ Kocher 9,120,000đ 16,400,000đ -45%',
        'Bếp từ Kocher DI-339SE 9,120,000đ 16,400,000đ -45%',
        'Bếp từ Kocher DI-616Plus 6,900,000đ 13,290,000đ -49%',
        'Kệ Góc Kính Inox 304',
        'Kệ Gia Vị Tròn Inox 304',
        'Bộ Thau Rá Inox 304',
        'GIÁ ĐỂ ĐŨA THÌA MUÔI TREO NGOÀI INOX 304 EUROGOLD',
        'GIÁ ĐỂ DAO THỚT TREO NGOÀI INOX 304 EUROGOLD',
        'Bếp từ đôi 2017',
        'Kích thước 600x400',
        'Độ dày 2 li',
        'Phi 21mm'
    ];
    cases.forEach(c => {
        const ext = extractSku(c);
        console.log(`Input: "${c}"`);
        console.log(`  => Clean: "${ext.cleanName}"`);
        console.log(`  => SKU: "${ext.sku}" | Series: "${ext.series}"`);
        console.log('');
    });
});
