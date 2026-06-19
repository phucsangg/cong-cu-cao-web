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
    gapValue: findHeaderIndex(headers, ['GAP']),
    gapPercent: findHeaderIndex(headers, ['%GAP']),
    suggestedPrice: findHeaderIndex(headers, ['Giá đề xuất', 'Gia de xuat'])
  };
}

function getSheet_(sheetId, sheetName) {
  var spreadsheet = SpreadsheetApp.openById(sheetId);
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Khong tim thay sheet: ' + sheetName);
  }
  return sheet;
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
  var sheet = getSheet_(payload.sheetId, payload.sheetName);
  var headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerMap = buildHeaderMap(headers);

  // Validate output headers
  if (headerMap.minPrice === -1) throw new Error('Thieu cot: Min');
  if (headerMap.gapValue === -1) throw new Error('Thieu cot: GAP');
  if (headerMap.gapPercent === -1) throw new Error('Thieu cot: %GAP');
  if (headerMap.suggestedPrice === -1) throw new Error('Thieu cot: Gia de xuat');
  
  for (var i = 0; i < 10; i += 1) {
    if (headerMap.marketColumns[i] === -1) {
      throw new Error('Thieu cot: Thi truong ' + (i + 1));
    }
  }

  payload.updates.forEach(function(update) {
    if (!update || !update.rowNumber) return;
    if (update.rowNumber <= 2) return; // Bảo vệ hàng tiêu đề không bị ghi đè
    
    // 1. Ghi giá thị trường mới nạp nếu có
    var marketPrices = update.marketPrices || [];
    if (marketPrices.length > 0) {
      for (var i = 0; i < 10; i += 1) {
        var colIdx = headerMap.marketColumns[i];
        var val = (i < marketPrices.length && typeof marketPrices[i] === 'number') ? marketPrices[i] : '';
        sheet.getRange(update.rowNumber, colIdx + 1).setValue(val);
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
    var gapValue = null;
    var gapPercent = null;
    var suggestedPrice = null;
    
    if (currentMarketPrices.length > 0) {
      var filteredPrices = [].concat(currentMarketPrices);
      // Loại bỏ outlier thấp hơn 90% của giá thấp thứ 2
      if (filteredPrices.length >= 2 && filteredPrices[0] < filteredPrices[1] * 0.9) {
        filteredPrices.shift();
      }
      
      if (filteredPrices.length > 0) {
        minPrice = filteredPrices[0];
      }
      
      // Đọc giá bán hiện tại trên sheet (cột Giá bán (₫))
      var salePriceIdx = findHeaderIndex(headers, ['Giá bán', 'Gia ban']);
      if (salePriceIdx !== -1) {
        var salePriceVal = sheet.getRange(update.rowNumber, salePriceIdx + 1).getValue();
        var parsedSalePrice = parseInt(String(salePriceVal).replace(/\D/g, ''), 10);
        if (!isNaN(parsedSalePrice) && parsedSalePrice > 0) {
          if (parsedSalePrice < 100000) {
            parsedSalePrice = parsedSalePrice * 1000;
          }
          if (minPrice !== null) {
            gapValue = parsedSalePrice - minPrice;
            gapPercent = gapValue / minPrice;
          }
        }
      }
      
      // Tính Giá đề xuất bằng trung bình cộng 3 giá thấp nhất nhân 0.995
      if (filteredPrices.length >= 3) {
        var top3 = filteredPrices.slice(0, 3);
        var sum = 0;
        for (var k = 0; k < top3.length; k++) {
          sum += top3[k];
        }
        suggestedPrice = Math.round((sum / top3.length) * 0.995);
      }
    }
    
    // 4. Ghi các trường tổng hợp lại vào sheet
    sheet.getRange(update.rowNumber, headerMap.minPrice + 1).setValue(minPrice !== null ? minPrice : '');
    sheet.getRange(update.rowNumber, headerMap.gapValue + 1).setValue(gapValue !== null ? gapValue : '');
    sheet.getRange(update.rowNumber, headerMap.gapPercent + 1).setValue(gapPercent !== null ? gapPercent : '');
    sheet.getRange(update.rowNumber, headerMap.suggestedPrice + 1).setValue(suggestedPrice !== null ? suggestedPrice : '');
  });

  return {
    ok: true,
    updated: payload.updates.length
  };
}

function doGet(e) {
  try {
    var params = e.parameter || {};
    if (params.action === 'readRows') {
      return jsonOutput(readRows_(params.sheetId, params.sheetName, params.startRow, params.endRow, params.headerRow));
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
