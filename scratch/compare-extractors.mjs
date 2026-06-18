import fs from 'fs';
import path from 'path';
import { extractSku as backendExtractSku } from '../scripts/normalize-product.mjs';

// Load public/index.html and extract lines 926 to 1093
const indexHtmlContent = fs.readFileSync(path.resolve('public/index.html'), 'utf-8');
const lines = indexHtmlContent.split(/\r?\n/);
// Line numbers are 1-based, index is 0-based. Line 926 to 1093 is index 925 to 1093
const funcLines = lines.slice(925, 1093);
const funcBody = funcLines.join('\n');

// Create function dynamically
const frontendExtractSku = new Function('fullName', 'link', funcBody + '\nreturn extractSku(fullName, link);');

// Test samples (with optional links)
const samples = [
    { name: "BẾP TỪ BOSCH 3 VÙNG NẤU PID675DC1E - SERIES 8 (60CM)", link: "" },
    { name: "BẾP TỪ BOSCH 3 VÙNG NẤU PUJ631BB5E - SERIE 4 (60CM)", link: "" },
    { name: "MÁY RỬA CHÉN BÁT ĐỘC LẬP 13 BỘ BOSCH - SERIES 8 (60CM)", link: "" },
    { name: "MÁY SẤY BƠM NHIỆT BOSCH 9KG WQG24200SG", link: "" },
    { name: "Bếp Điện Từ Kaff KF - IH202IC", link: "https://bepngocbao.vn/products/kaffkf-ih202ic" },
    { name: "Bếp Điện Từ Kaff KF-IH202IC", link: "https://bepngocbao.vn/products/kaffkf-ih202ic" },
    { name: "Máy rửa bát Kaff KF-775B New Plus", link: "https://bepngocbao.vn/products/kaffkf-775b-new-plus" },
    { name: "Máy rửa bát Toshiba (G)-VN - 15bộ DW-15F7", link: "" },
    { name: "Máy rửa bát Toshiba - 8bộ compact CDW-8F60RB", link: "" },
    { name: "Chậu rửa Konox Vigo 860 - 2hố lệch (820×400, AISI 304)", link: "https://bepngocbao.vn/products/chau-rua-konox-vigo-860" },
    { name: "Chậu rửa Konox Tari Smart 8047 - hạt Smart chống xước", link: "" },
    { name: "Chậu rửa Konox Tari - 1hố cực rộng (860×408) 9051SM", link: "" },
    { name: "Máy hút bụi lau nhà Bosch Unlimited Prohygienic BCS711XXL", link: "" }
];

let mismatchCount = 0;
for (const s of samples) {
    const resBackend = backendExtractSku(s.name, s.link);
    let resFrontend;
    try {
        resFrontend = frontendExtractSku(s.name, s.link);
    } catch (e) {
        console.error("Error executing frontend extractSku:", e);
        mismatchCount++;
        continue;
    }

    const diffSku = resBackend.sku !== resFrontend.sku;
    const diffSeries = resBackend.series !== resFrontend.series;
    const diffSize = resBackend.kichThuoc !== resFrontend.kichThuoc;
    const diffClean = resBackend.cleanName !== resFrontend.cleanName;

    if (diffSku || diffSeries || diffSize || diffClean) {
        console.log(`MISMATCH for: "${s.name}" (${s.link})`);
        console.log("  Backend: ", resBackend);
        console.log("  Frontend:", resFrontend);
        mismatchCount++;
    }
}

if (mismatchCount === 0) {
    console.log("✅ All test samples matched perfectly between backend and frontend extraction logic!");
} else {
    console.log(`❌ Found ${mismatchCount} mismatches!`);
}

