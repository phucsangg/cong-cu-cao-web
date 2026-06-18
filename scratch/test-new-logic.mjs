import fs from 'fs';
import path from 'path';
import { extractSku } from '../scripts/normalize-product.mjs';

// Read test(2).csv and see how they are normalized
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

let out = `STT | Link | Original Name | Old SKU | Proposed SKU | Series | Size\n`;
out += "-".repeat(100) + "\n";

products.forEach(p => {
    const res = extractSku(p.name, p.link);
    const sku = res.sku || '';
    out += `${p.stt} | ${p.link} | ${p.name} | Old: ${p.csvSku} | New: ${sku} | SER: ${res.series || ''} | SIZE: ${res.kichThuoc || ''}\n`;
});

fs.writeFileSync('scratch/output-new.txt', out, 'utf-8');
console.log("Wrote proposed inspection results to scratch/output-new.txt");
