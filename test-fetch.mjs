import fs from 'fs';
import * as cheerio from 'cheerio';

function extractSku(fullName) {
    let codes = [];
    
    // Pattern 1: Dotted codes (Hafele)
    const dotReg = /\b\d{3}\.\d{2}\.\d{3}\b/g;
    let match;
    while ((match = dotReg.exec(fullName)) !== null) {
        codes.push(match[0]);
    }
    
    // Pattern 2: Comprehensive alphanumeric model code matching (case-sensitive)
    const modelReg = /\b(?:[A-Z]{2,4}[- ]?)?[A-Z]*\d+[A-Z0-9]*(?:[-/][A-Z0-9]+)*(?:[- ](?:PLUS|PRO|NOTE|KPLUS|EG|VN|EVN|IN|II|IG|Z|S|G|Plus|Pro|Note|Kplus|Iplus))?\b/g;
    while ((match = modelReg.exec(fullName)) !== null) {
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
            'TRANG', 'MS', 'VV', 'GB', 'TB', 'MB', 'VÒNG', 'VONG', 'LÍT/PHÚT', 'LIT/PHUT', 'MÉT', 'MET'
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
        
        return true;
    });

    // De-duplicate: if one code is a substring of another, keep the longer one
    uniqueCodes = uniqueCodes.filter(c => {
        return !uniqueCodes.some(other => other !== c && other.toLowerCase().includes(c.toLowerCase()));
    });
    
    let cleanName = fullName;
    uniqueCodes.forEach(code => {
        const escapedCode = code.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const reg = new RegExp(escapedCode, 'g');
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

run();
