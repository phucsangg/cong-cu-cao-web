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
  for (var i = 0; i < headers.length; i += 1) {
    var header = normalizeText(headers[i]);
    for (var j = 0; j < names.length; j += 1) {
      if (header === normalizeText(names[j])) {
        return i;
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

function readRows_(sheetId, sheetName, startRow, endRow) {
  var sheet = getSheet_(sheetId, sheetName);
  var headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var firstRow = Number(startRow || 3);
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
    
    // Write marketPrices
    var marketPrices = update.marketPrices || [];
    for (var i = 0; i < 10; i += 1) {
      var colIdx = headerMap.marketColumns[i];
      var val = (i < marketPrices.length && typeof marketPrices[i] === 'number') ? marketPrices[i] : '';
      sheet.getRange(update.rowNumber, colIdx + 1).setValue(val);
    }
    
    // Write summary fields
    sheet.getRange(update.rowNumber, headerMap.minPrice + 1).setValue(typeof update.minPrice === 'number' ? update.minPrice : '');
    sheet.getRange(update.rowNumber, headerMap.gapValue + 1).setValue(typeof update.gapValue === 'number' ? update.gapValue : '');
    sheet.getRange(update.rowNumber, headerMap.gapPercent + 1).setValue(typeof update.gapPercent === 'number' ? update.gapPercent : '');
    sheet.getRange(update.rowNumber, headerMap.suggestedPrice + 1).setValue(typeof update.suggestedPrice === 'number' ? update.suggestedPrice : '');
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
      return jsonOutput(readRows_(params.sheetId, params.sheetName, params.startRow, params.endRow));
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
