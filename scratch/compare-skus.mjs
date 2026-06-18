import fs from 'fs';
import path from 'path';
import { extractSku } from '../scripts/normalize-product.mjs';

const csvPath = path.resolve('test(2).csv');
const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(Boolean);

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

const products = lines.slice(1).map(line => {
    const parts = parseCsvLine(line);
    return {
        stt: parts[0],
        name: parts[1],
        csvSku: parts[2],
        series: parts[3],
        size: parts[4],
        price: parts[5],
        link: parts[7]
    };
});

let diffCount = 0;
let out = `STT | Original Name | CSV SKU | New SKU | CSV Series | New Series | CSV Size | New Size | Link\n`;
out += "=".repeat(120) + "\n";

products.forEach(p => {
    const res = extractSku(p.name, p.link);
    const sku = res.sku || '';
    const series = res.series || '';
    const size = res.kichThuoc || '';
    
    if (p.csvSku !== sku || p.series !== series || p.size !== size) {
        diffCount++;
        out += `${p.stt} | ${p.name} | CSV: ${p.csvSku} | New: ${sku} | CSV_SER: ${p.series} | New_SER: ${series} | CSV_SZ: ${p.size} | New_SZ: ${size} | ${p.link}\n`;
    }
});

fs.writeFileSync('scratch/differences.txt', out, 'utf-8');
console.log(`Found ${diffCount} differences. Saved list to scratch/differences.txt`);
