function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .trim()
    .toLowerCase();
}

function isCellEmpty(val) {
  if (val === null || val === undefined) return true;
  var s = String(val).replace(/[\s\u200B\uFEFF]/g, '');
  return s === '';
}

function getLastRowOfColumn(sheet, colIndex) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 2) return 2;
  var values = sheet.getRange(1, colIndex, lastRow, 1).getValues();
  for (var i = values.length - 1; i >= 2; i--) {
    var val = values[i][0];
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      return i + 1;
    }
  }
  return 2;
}

function getColumnLetter(colIndex) {
  var letter = '';
  var temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function findHeaderIndex(headers, names) {
  for (var i = 0; i < names.length; i += 1) {
    var name = names[i];
    var normalizedCandidate = normalizeText(name);
    var cleanCandidate = normalizedCandidate.replace(/[^a-z0-9]/g, '');

    for (var j = 0; j < headers.length; j += 1) {
      var header = headers[j];
      var normalizedHeader = normalizeText(header);

      if (normalizedHeader === normalizedCandidate) return j;
      if (normalizedHeader.indexOf(normalizedCandidate) === 0) return j; // startsWith

      // Differentiate %GAP and GAP
      if (normalizedCandidate.indexOf('%') !== -1 && normalizedHeader.indexOf('%') === -1) continue;
      if (normalizedCandidate.indexOf('%') === -1 && normalizedHeader.indexOf('%') !== -1) continue;

      var cleanHeader = normalizedHeader.replace(/[^a-z0-9]/g, '');
      if (!cleanCandidate) continue;

      if (cleanHeader === cleanCandidate || cleanHeader.indexOf(cleanCandidate) !== -1) {
        return j;
      }
    }
  }
  return -1;
}

function buildHeaderMap(headers) {
  var marketColumns = [];
  for (var i = 1; i <= 10; i += 1) {
    marketColumns.push(findHeaderIndex(headers, ['Thị trường ' + i, 'Thi truong ' + i]));
  }

  return {
    marketColumns: marketColumns,
    minPrice: findHeaderIndex(headers, ['Min']),
    gapValue: findHeaderIndex(headers, ['Lợi nhuận (₫)', 'Lợi nhuận (đ)', 'Lợi nhuận', 'Loi nhuan', 'GAP']),
    gapPercent: findHeaderIndex(headers, ['% Lợi nhuận', '% Loi nhuan', '%GAP']),
    suggestedPrice: findHeaderIndex(headers, ['Giá đề xuất (₫)', 'Giá đề xuất (đ)', 'Giá đề xuất', 'Gia de xuat'])
  };
}

function getSheet_(sheetId, sheetName) {
  var spreadsheet = SpreadsheetApp.openById(sheetId);
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (sheet) {
    return sheet;
  }

  // Fallback: match by normalized name (ignoring casing, spacing, and accents)
  var normTarget = normalizeText(sheetName).replace(/[^a-z0-9]/g, '');
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    var normName = normalizeText(name).replace(/[^a-z0-9]/g, '');
    if (normName === normTarget) {
      return sheets[i];
    }
  }

  throw new Error('Khong tim thay sheet: ' + sheetName);
}

function readRows_(sheetId, sheetName, startRow, endRow, headerRow) {
  var sheet = getSheet_(sheetId, sheetName);
  var hRow = Number(headerRow || 2);
  var headers = sheet.getRange(hRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  var firstRow = Math.max(hRow + 1, Number(startRow || (hRow + 1)));
  var lastRow = Number(endRow || sheet.getLastRow());

  if (lastRow < firstRow) {
    lastRow = firstRow;
  }

  var numRows = Math.max(0, lastRow - firstRow + 1);
  var values = numRows > 0 ? sheet.getRange(firstRow, 1, numRows, sheet.getLastColumn()).getValues() : [];

  return {
    ok: true,
    headers: headers,
    rows: values.map(function(rowValues, index) {
      return {
        rowNumber: firstRow + index,
        values: rowValues
      };
    })
  };
}

function writePricing_(payload) {
  // Ghi nhận nhật ký cào giá vào sheet LOG (LOG QUÉT LINK, columns A-E) trước
  if (payload.logs && payload.logs.length > 0) {
    try {
      var logSheet = getSheet_(payload.sheetId, 'LOG');
      var nextRow = getLastRowOfColumn(logSheet, 1) + 1;
      var logValues = payload.logs.map(function(logEntry) {
        var timestampStr = logEntry.timestamp || new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        return [
          timestampStr,
          logEntry.brand || '',
          logEntry.model || '',
          (logEntry.price !== undefined && logEntry.price !== null && logEntry.price !== '') ? Number(logEntry.price) : '',
          logEntry.url || ''
        ];
      });
      logSheet.getRange(nextRow, 1, logValues.length, 5).setValues(logValues);
    } catch (logErr) {
      console.error('Lỗi khi ghi LOG QUÉT LINK: ' + logErr.message);
      // Bỏ qua lỗi ghi log để không làm gián đoạn luồng cập nhật giá chính
    }
  }

  var sheet = getSheet_(payload.sheetId, payload.sheetName);
  var headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerMap = buildHeaderMap(headers);

  // Validate output headers
  if (headerMap.minPrice === -1) throw new Error('Thieu cot: Min');
  if (headerMap.gapValue === -1) throw new Error('Thieu cot: GAP hoac Loi nhuan');
  if (headerMap.gapPercent === -1) throw new Error('Thieu cot: %GAP hoac % Loi nhuan');
  if (headerMap.suggestedPrice === -1) throw new Error('Thieu cot: Gia de xuat');
  
  for (var i = 0; i < 10; i += 1) {
    if (headerMap.marketColumns[i] === -1) {
      throw new Error('Thieu cot: Thi truong ' + (i + 1));
    }
  }

  var costPriceIdxForCols = findHeaderIndex(headers, ['Giá vốn (₫)', 'Giá vốn (đ)', 'Giá vốn', 'Gia von']);
  var salePriceIdxForCols = findHeaderIndex(headers, ['Giá bán (₫)', 'Giá bán (đ)', 'Giá bán', 'Gia ban']);
  
  var costPriceCol = costPriceIdxForCols !== -1 ? getColumnLetter(costPriceIdxForCols) : null;
  var salePriceCol = salePriceIdxForCols !== -1 ? getColumnLetter(salePriceIdxForCols) : null;
  var gapValueCol = headerMap.gapValue !== -1 ? getColumnLetter(headerMap.gapValue) : null;

  payload.updates.forEach(function(update) {
    if (!update || !update.rowNumber) return;
    if (update.rowNumber <= 2) return; // Bảo vệ hàng tiêu đề không bị ghi đè
    
    // 1. Ghi giá thị trường mới nạp nếu có
    var marketPrices = update.marketPrices || [];
    if (marketPrices.length > 0) {
      for (var i = 0; i < 10; i += 1) {
        var colIdx = headerMap.marketColumns[i];
        var val = (i < marketPrices.length && typeof marketPrices[i] === 'number') ? marketPrices[i] : '';
        var cell = sheet.getRange(update.rowNumber, colIdx + 1).setValue(val);
        if (typeof val === 'number') {
          cell.setNumberFormat('#,##0');
        }
      }
    }
    
    // 2. Đọc lại toàn bộ 10 cột thị trường thực tế đang có trên sheet (bao gồm cả giá mới ghi hoặc cũ có sẵn)
    var currentMarketPrices = [];
    for (var i = 0; i < 10; i += 1) {
      var colIdx = headerMap.marketColumns[i];
      var val = sheet.getRange(update.rowNumber, colIdx + 1).getValue();
      var parsed = parseInt(String(val).replace(/\D/g, ''), 10);
      if (!isNaN(parsed) && parsed > 0) {
        if (parsed < 100000) {
          parsed = parsed * 1000;
        }
        currentMarketPrices.push(parsed);
      }
    }
    
    // Sắp xếp các giá thị trường theo thứ tự tăng dần
    currentMarketPrices.sort(function(a, b) { return a - b; });
    
    // 3. Tính toán các giá trị tổng hợp dựa trên 10 cột thị trường thực tế
    var minPrice = null;
    var suggestedPrice = null;
    
    if (currentMarketPrices.length > 0) {
      minPrice = currentMarketPrices[0];
      suggestedPrice = minPrice; // Giá đề xuất lấy giá Min
    }

    if (salePriceIdxForCols !== -1 && suggestedPrice !== null) {
      sheet.getRange(update.rowNumber, salePriceIdxForCols + 1).setValue(suggestedPrice).setNumberFormat('#,##0');
    }
    
    // Đọc giá niêm yết, giá vốn, giá bán từ sheet
    var listPriceIdx = findHeaderIndex(headers, ['Giá niêm yết (₫)', 'Giá niêm yết (đ)', 'Giá niêm yết', 'Gia niem yet']);
    var costPriceIdx = findHeaderIndex(headers, ['Giá vốn (₫)', 'Giá vốn (đ)', 'Giá vốn', 'Gia von']);
    var salePriceIdx = findHeaderIndex(headers, ['Giá bán (₫)', 'Giá bán (đ)', 'Giá bán', 'Gia ban']);
    
    var parsedListPrice = null;
    var parsedCostPrice = null;
    var parsedSalePrice = null;
    
    if (listPriceIdx !== -1) {
      var listVal = sheet.getRange(update.rowNumber, listPriceIdx + 1).getValue();
      var listValCleaned = String(listVal).replace(/\D/g, '');
      if (listValCleaned) {
        parsedListPrice = parseInt(listValCleaned, 10);
        if (!isNaN(parsedListPrice) && parsedListPrice > 0) {
          if (parsedListPrice < 100000) parsedListPrice = parsedListPrice * 1000;
        } else {
          parsedListPrice = null;
        }
      }
    }
    
    if (costPriceIdx !== -1) {
      var costVal = sheet.getRange(update.rowNumber, costPriceIdx + 1).getValue();
      var costValCleaned = String(costVal).replace(/\D/g, '');
      if (costValCleaned) {
        parsedCostPrice = parseInt(costValCleaned, 10);
        if (!isNaN(parsedCostPrice) && parsedCostPrice > 0) {
          if (parsedCostPrice < 100000) parsedCostPrice = parsedCostPrice * 1000;
        } else {
          parsedCostPrice = null;
        }
      }
    }
    
    if (salePriceIdx !== -1) {
      var saleVal = sheet.getRange(update.rowNumber, salePriceIdx + 1).getValue();
      var saleValCleaned = String(saleVal).replace(/\D/g, '');
      if (saleValCleaned) {
        parsedSalePrice = parseInt(saleValCleaned, 10);
        if (!isNaN(parsedSalePrice) && parsedSalePrice > 0) {
          if (parsedSalePrice < 100000) parsedSalePrice = parsedSalePrice * 1000;
        } else {
          parsedSalePrice = null;
        }
      }
    }
    
    var comparisonPrice = parsedSalePrice !== null ? parsedSalePrice : parsedListPrice;
    
    var gapValue = null;
    var gapPercent = null;
    
    // Lợi nhuận = Giá bán (₫) hoặc Giá niêm yết (₫) - Giá vốn (₫) (nếu 1 trong 2 cột trống thì để trống cột lợi nhuận)
    if (comparisonPrice !== null && parsedCostPrice !== null) {
      gapValue = comparisonPrice - parsedCostPrice;
    }
    
    // % Lợi nhuận = Lợi nhuận / comparisonPrice
    if (gapValue !== null && comparisonPrice !== null && comparisonPrice > 0) {
      gapPercent = gapValue / comparisonPrice;
    }
    
    // 4. Ghi các trường tổng hợp lại vào sheet
    var minPriceCell = sheet.getRange(update.rowNumber, headerMap.minPrice + 1).setValue(minPrice !== null ? minPrice : '');
    if (minPrice !== null) minPriceCell.setNumberFormat('#,##0');

    if (costPriceCol && salePriceCol && gapValueCol) {
      var costCell = costPriceCol + update.rowNumber;
      var saleCell = salePriceCol + update.rowNumber;
      var gapCell = gapValueCol + update.rowNumber;

      var gapValueFormula = "=IF(ISBLANK(" + costCell + "); \"Chưa có giá vốn\"; " + saleCell + " - " + costCell + ")";
      var gapPercentFormula = "=IF(ISBLANK(" + costCell + "); \"Chưa có giá vốn\"; " + gapCell + " / " + costCell + ")";

      sheet.getRange(update.rowNumber, headerMap.gapValue + 1).setValue(gapValueFormula).setNumberFormat('#,##0');
      sheet.getRange(update.rowNumber, headerMap.gapPercent + 1).setValue(gapPercentFormula).setNumberFormat('0.00%');
    } else {
      var gapValueCell = sheet.getRange(update.rowNumber, headerMap.gapValue + 1).setValue(gapValue !== null ? gapValue : '');
      if (gapValue !== null) gapValueCell.setNumberFormat('#,##0');

      var gapPercentCell = sheet.getRange(update.rowNumber, headerMap.gapPercent + 1).setValue(gapPercent !== null ? gapPercent : '');
      if (gapPercent !== null) gapPercentCell.setNumberFormat('0.00%');
    }

    var suggestedPriceCell = sheet.getRange(update.rowNumber, headerMap.suggestedPrice + 1).setValue(suggestedPrice !== null ? suggestedPrice : '');
    if (suggestedPrice !== null) suggestedPriceCell.setNumberFormat('#,##0');
  });

  return {
    ok: true,
    updated: payload.updates.length
  };
}

function writeHaravanIds_(payload) {
  var sheet = getSheet_(payload.sheetId, 'ID Haravan');
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }

  var rows = payload.rows || [];
  if (rows.length > 0) {
    var values = rows.map(function(row) {
      return [
        row.product_name || '',
        row.brand || '',
        row.model || '',
        String(row.variant_id || '')
      ];
    });
    sheet.getRange(2, 1, values.length, 4).setValues(values);
  }

  return {
    ok: true,
    written: rows.length
  };
}

function writeHaravanLog_(payload) {
  var sheet = getSheet_(payload.sheetId, 'LOG');
  var nextRow = getLastRowOfColumn(sheet, 7) + 1;
  var timestampStr = payload.timestamp || new Date().toLocaleString('vi-VN');
  var priceVal = (payload.price !== undefined && payload.price !== null && payload.price !== '') ? Number(payload.price) : '';
  
  sheet.getRange(nextRow, 7, 1, 5).setValues([[
    timestampStr,
    payload.brand || '',
    payload.model || '',
    priceVal,
    payload.status || ''
  ]]);
  if (priceVal !== '') {
    sheet.getRange(nextRow, 10).setNumberFormat('#,##0'); // Column J (10)
  }
  
  return {
    ok: true
  };
}

function updateSalePrice_(payload) {
  var sheet = getSheet_(payload.sheetId, payload.sheetName);
  var headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerMap = buildHeaderMap(headers);
  
  var salePriceIdx = findHeaderIndex(headers, ['Giá bán (₫)', 'Giá bán (đ)', 'Giá bán', 'Gia ban']);
  if (salePriceIdx === -1) {
    throw new Error('Khong tim thay cot Gia ban trong sheet ' + payload.sheetName);
  }
  
  var newPrice = Number(payload.price);
  var salePriceCell = sheet.getRange(payload.rowNumber, salePriceIdx + 1).setValue(newPrice);
  salePriceCell.setNumberFormat('#,##0');
  
  // Read costPrice from sheet to update Lợi nhuận and % Lợi nhuận
  var costPriceIdx = findHeaderIndex(headers, ['Giá vốn (₫)', 'Giá vốn (đ)', 'Giá vốn', 'Gia von']);
  var parsedCostPrice = null;
  if (costPriceIdx !== -1) {
    var costVal = sheet.getRange(payload.rowNumber, costPriceIdx + 1).getValue();
    var costValCleaned = String(costVal).replace(/\D/g, '');
    if (costValCleaned) {
      parsedCostPrice = parseInt(costValCleaned, 10);
      if (!isNaN(parsedCostPrice) && parsedCostPrice > 0) {
        if (parsedCostPrice < 100000) parsedCostPrice = parsedCostPrice * 1000;
      } else {
        parsedCostPrice = null;
      }
    }
  }
  
  // Read listPrice from sheet to update comparisonPrice
  var listPriceIdx = findHeaderIndex(headers, ['Giá niêm yết (₫)', 'Giá niêm yết (đ)', 'Giá niêm yết', 'Gia niem yet']);
  var parsedListPrice = null;
  if (listPriceIdx !== -1) {
    var listVal = sheet.getRange(payload.rowNumber, listPriceIdx + 1).getValue();
    var listValCleaned = String(listVal).replace(/\D/g, '');
    if (listValCleaned) {
      parsedListPrice = parseInt(listValCleaned, 10);
      if (!isNaN(parsedListPrice) && parsedListPrice > 0) {
        if (parsedListPrice < 100000) parsedListPrice = parsedListPrice * 1000;
      }
    }
  }

  var comparisonPrice = (newPrice > 0) ? newPrice : parsedListPrice;
  var gapValue = null;
  var gapPercent = null;
  
  if (comparisonPrice !== null && parsedCostPrice !== null) {
    gapValue = comparisonPrice - parsedCostPrice;
  }
  
  if (gapValue !== null && comparisonPrice !== null && comparisonPrice > 0) {
    gapPercent = gapValue / comparisonPrice;
  }
  
  var costPriceCol = costPriceIdx !== -1 ? getColumnLetter(costPriceIdx) : null;
  var salePriceCol = salePriceIdx !== -1 ? getColumnLetter(salePriceIdx) : null;
  var gapValueCol = headerMap.gapValue !== -1 ? getColumnLetter(headerMap.gapValue) : null;

  if (headerMap.gapValue !== -1 && costPriceCol && salePriceCol) {
    var costCell = costPriceCol + payload.rowNumber;
    var saleCell = salePriceCol + payload.rowNumber;
    var gapValueFormula = "=IF(ISBLANK(" + costCell + "); \"Chưa có giá vốn\"; " + saleCell + " - " + costCell + ")";
    sheet.getRange(payload.rowNumber, headerMap.gapValue + 1).setValue(gapValueFormula).setNumberFormat('#,##0');
  } else if (headerMap.gapValue !== -1) {
    var gapValueCell = sheet.getRange(payload.rowNumber, headerMap.gapValue + 1).setValue(gapValue !== null ? gapValue : '');
    if (gapValue !== null) gapValueCell.setNumberFormat('#,##0');
  }
  
  if (headerMap.gapPercent !== -1 && costPriceCol && gapValueCol) {
    var costCell = costPriceCol + payload.rowNumber;
    var gapCell = gapValueCol + payload.rowNumber;
    var gapPercentFormula = "=IF(ISBLANK(" + costCell + "); \"Chưa có giá vốn\"; " + gapCell + " / " + costCell + ")";
    sheet.getRange(payload.rowNumber, headerMap.gapPercent + 1).setValue(gapPercentFormula).setNumberFormat('0.00%');
  } else if (headerMap.gapPercent !== -1) {
    var gapPercentCell = sheet.getRange(payload.rowNumber, headerMap.gapPercent + 1).setValue(gapPercent !== null ? gapPercent : '');
    if (gapPercent !== null) gapPercentCell.setNumberFormat('0.00%');
  }
  
  return { ok: true };
}

function listSheets_(sheetId) {
  var spreadsheet = SpreadsheetApp.openById(sheetId);
  var sheets = spreadsheet.getSheets();
  var names = sheets.map(function(sheet) {
    return sheet.getName();
  });
  return {
    ok: true,
    sheets: names
  };
}

function doGet(e) {
  try {
    var params = e.parameter || {};
    if (params.action === 'readRows') {
      return jsonOutput(readRows_(params.sheetId, params.sheetName, params.startRow, params.endRow, params.headerRow));
    }
    if (params.action === 'listSheets') {
      return jsonOutput(listSheets_(params.sheetId));
    }

    return jsonOutput({
      ok: false,
      error: 'Action GET khong hop le.'
    });
  } catch (error) {
    return jsonOutput({
      ok: false,
      error: error.message
    });
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action === 'writePricing') {
      return jsonOutput(writePricing_(payload));
    }
    if (payload.action === 'writeHaravanIds') {
      return jsonOutput(writeHaravanIds_(payload));
    }
    if (payload.action === 'writeHaravanLog') {
      return jsonOutput(writeHaravanLog_(payload));
    }
    if (payload.action === 'updateSalePrice') {
      return jsonOutput(updateSalePrice_(payload));
    }

    return jsonOutput({
      ok: false,
      error: 'Action POST khong hop le.'
    });
  } catch (error) {
    return jsonOutput({
      ok: false,
      error: error.message
    });
  }
}
