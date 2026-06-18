import fs from 'fs';
import path from 'path';
import { extractSku } from './normalize-product.mjs';

const csvPath = path.resolve('test(2).csv');
if (!fs.existsSync(csvPath)) {
    console.error("test(2).csv not found.");
    process.exit(1);
}

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

function escapeCsv(val) {
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}

const headers = ['STT', 'Ten San Pham', 'Ma San Pham', 'Dong / Series', 'Kich Thuoc', 'Gia Ban', 'Nguon Trang', 'Lien Ket San Pham', 'Link Anh'];
const newCsvLines = [headers.join(',')];

lines.slice(1).forEach(line => {
    const parts = parseCsvLine(line);
    const stt = parts[0];
    const originalName = parts[1];
    const link = parts[7] || '';
    const price = parts[5] || '';
    const source = parts[6] || '';
    const image = parts[8] || '';

    // Extract updated info
    const ext = extractSku(originalName, link);

    const row = [
        stt,
        escapeCsv(ext.cleanName),
        escapeCsv(ext.sku),
        escapeCsv(ext.series),
        escapeCsv(ext.kichThuoc),
        escapeCsv(price),
        escapeCsv(source),
        escapeCsv(link),
        escapeCsv(image)
    ];
    newCsvLines.push(row.join(','));
});

// Write with UTF-8 BOM
const outputContent = '\ufeff' + newCsvLines.join('\n');
fs.writeFileSync('test(2)_reprocessed.csv', outputContent, 'utf-8');
console.log("Wrote reprocessed CSV to test(2)_reprocessed.csv");
