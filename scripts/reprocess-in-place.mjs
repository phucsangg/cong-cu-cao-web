import fs from 'fs';
import path from 'path';
import { extractSku } from './normalize-product.mjs';

function reprocessCsvInPlace(fileName) {
    const csvPath = path.resolve(fileName);
    if (!fs.existsSync(csvPath)) {
        console.warn(`File ${fileName} not found, skipping.`);
        return;
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return;

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

    const outputContent = '\ufeff' + newCsvLines.join('\n');
    fs.writeFileSync(csvPath, outputContent, 'utf-8');
    console.log(`Successfully reprocessed and updated: ${fileName}`);
}

// Reprocess all targets
reprocessCsvInPlace('test(2).csv');
reprocessCsvInPlace('test.csv');
reprocessCsvInPlace('danh_sach_san_pham_vet_can (5).csv');

// Clean up temporary reprocessed preview file if it exists
try {
    const tempPath = path.resolve('test(2)_reprocessed.csv');
    if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
    }
} catch (e) {
    // Ignore error
}
