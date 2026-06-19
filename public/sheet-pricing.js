(function () {
    const state = {
        running: false,
        jobId: null,
        rows: [],
        processed: 0,
        success: 0,
        errors: 0,
        writes: 0,
        totalRows: 0,
        pollInterval: null,
        availableSheets: [],
    };

    function normalizeVietnameseText(value = '') {
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .trim()
            .toLowerCase();
    }

    function normalizeModelText(value = '') {
        return normalizeVietnameseText(value)
            .replace(/[^a-z0-9]/g, '')
            .toUpperCase();
    }

    function decodeMojibake(value) {
        const text = String(value ?? '');
        if (!/[ÃÂÄÆá»áºâ]/.test(text)) {
            return text;
        }
        try {
            return decodeURIComponent(escape(text));
        } catch {
            return text;
        }
    }

    function cleanText(value) {
        return decodeMojibake(String(value ?? ''));
    }

    function escapeHtml(value) {
        return cleanText(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatMoney(value) {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return `${num.toLocaleString('vi-VN')} đ`;
    }

    function formatPercent(value) {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return `${(num * 100).toFixed(2)}%`;
    }

    function normalizeSelectedSheetNames(value) {
        const rawItems = Array.isArray(value)
            ? value
            : String(value || '').split(',');

        return Array.from(new Set(rawItems.map((item) => String(item || '').trim()).filter(Boolean)));
    }

    function getSheetOptionCheckboxes() {
        return Array.from(document.querySelectorAll('#pricingSheetList input[data-sheet-name]'));
    }

    function updateSheetSelectionSummary(selectedNames) {
        const summaryEl = document.getElementById('pricingSheetSelectionSummary');
        if (!summaryEl) return;

        if (selectedNames.length === 0) {
            summaryEl.innerText = 'Chưa chọn sheet nào.';
            return;
        }

        if (selectedNames.length === 1) {
            summaryEl.innerText = `Đã chọn 1 sheet: ${selectedNames[0]}.`;
            return;
        }

        summaryEl.innerText = `Đã chọn ${selectedNames.length} sheet.`;
    }

    function syncSelectedSheetNames() {
        const hiddenInput = document.getElementById('pricingSheetName');
        const selectAllCheckbox = document.getElementById('pricingSheetSelectAll');
        const optionCheckboxes = getSheetOptionCheckboxes();
        const selectedNames = optionCheckboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);

        if (hiddenInput) {
            hiddenInput.value = selectedNames.join(',');
        }

        if (selectAllCheckbox) {
            selectAllCheckbox.checked = optionCheckboxes.length > 0 && selectedNames.length === optionCheckboxes.length;
            selectAllCheckbox.indeterminate = selectedNames.length > 0 && selectedNames.length < optionCheckboxes.length;
        }

        updateSheetSelectionSummary(selectedNames);
    }

    function renderSheetOptions(sheetNames, selectedNames = []) {
        const listEl = document.getElementById('pricingSheetList');
        if (!listEl) return;

        state.availableSheets = [...sheetNames];
        if (sheetNames.length === 0) {
            listEl.innerHTML = '<div class="text-light opacity-75">Không có sheet nào để chọn.</div>';
            syncSelectedSheetNames();
            return;
        }

        const selectedSet = new Set(selectedNames.length > 0 ? selectedNames : sheetNames);
        listEl.innerHTML = [
            `
                <label class="sheet-picker-item is-all">
                    <input type="checkbox" id="pricingSheetSelectAll">
                    <span>Tất cả các sheet</span>
                </label>
            `,
            ...sheetNames.map((sheet) => `
                <label class="sheet-picker-item">
                    <input type="checkbox" data-sheet-name="1" value="${escapeHtml(sheet)}" ${selectedSet.has(sheet) ? 'checked' : ''}>
                    <span>${escapeHtml(sheet)}</span>
                </label>
            `),
        ].join('');

        const selectAllCheckbox = document.getElementById('pricingSheetSelectAll');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', () => {
                getSheetOptionCheckboxes().forEach((checkbox) => {
                    checkbox.checked = selectAllCheckbox.checked;
                });
                syncSelectedSheetNames();
            });
        }

        getSheetOptionCheckboxes().forEach((checkbox) => {
            checkbox.addEventListener('change', syncSelectedSheetNames);
        });

        syncSelectedSheetNames();
    }

    function statusLabel(row) {
        if (row.errorMessage) {
            return `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-20" title="${escapeHtml(row.errorMessage)}">Lỗi</span>`;
        }
        if (row.status === 'processing') {
            return `<span class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-20">Đang xử lý</span>`;
        }
        if (row.status === 'success') {
            return `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-20">${row.writtenToSheet ? 'Đã ghi sheet' : 'Thành công'}</span>`;
        }
        if (row.status === 'insufficient_prices') {
            return `<span class="badge bg-warning bg-opacity-10 text-warning border border-warning border-opacity-20">${row.writtenToSheet ? 'Đã ghi, thiếu giá' : 'Thiếu giá'}</span>`;
        }
        if (row.status === 'skipped') {
            return `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-20">Bỏ qua</span>`;
        }
        return `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary border-opacity-20">${escapeHtml(row.status || 'Chờ chạy')}</span>`;
    }

    function renderSheetPricingRows() {
        const tbody = document.getElementById('sheetPricingBody');
        if (!tbody) return;

        if (state.rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="text-center text-secondary py-5">Chưa có dữ liệu nào được tải về. Hãy chọn cấu hình và chạy quét.</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = state.rows.map((row) => {
            const minPriceVal = row.minPrice;
            const suggestedPriceVal = row.suggestedPrice;
            const marketCount = row.marketPrices ? row.marketPrices.length : 0;

            let haravanCol = '-';
            const key = `${normalizeModelText(row.brand)}_${normalizeModelText(row.model)}`;
            const variantId = window.haravanMapping?.[key];
            if (row.suggestedPrice && variantId) {
                if (row.haravanUpdateState === 'accepted') {
                    haravanCol = `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-20"><i class="bi bi-check-circle-fill me-1"></i>Đã chấp nhận</span>`;
                } else if (row.haravanUpdateState === 'rejected') {
                    haravanCol = `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger border-opacity-20"><i class="bi bi-x-circle-fill me-1"></i>Đã từ chối</span>`;
                } else if (row.haravanUpdateState === 'updating') {
                    haravanCol = `<span class="spinner-border spinner-border-sm text-primary me-1" role="status" style="width: 0.85rem; height: 0.85rem;"></span> <span class="text-secondary" style="font-size: 0.8rem;">Đang cập nhật...</span>`;
                } else {
                    haravanCol = `
                        <div class="d-flex justify-content-center gap-1">
                            <button class="btn btn-xs btn-success py-1 px-2 text-white fw-bold" style="font-size: 0.7rem; border-radius: 4px;" onclick="event.stopPropagation(); acceptPriceUpdate('${escapeHtml(row.sheetName)}', ${row.rowNumber})">
                                Chấp nhận
                            </button>
                            <button class="btn btn-xs btn-outline-danger py-1 px-2 fw-bold" style="font-size: 0.7rem; border-radius: 4px;" onclick="event.stopPropagation(); rejectPriceUpdate('${escapeHtml(row.sheetName)}', ${row.rowNumber})">
                                Từ chối
                            </button>
                        </div>
                    `;
                }
            } else if (row.suggestedPrice && !variantId) {
                if (window.haravanMappingLoaded) {
                    haravanCol = `<span class="text-muted opacity-75" style="font-size: 0.75rem;">Không có ID Haravan</span>`;
                } else {
                    haravanCol = `<span class="text-muted opacity-75" style="font-size: 0.75rem;">Chưa đồng bộ ID</span>`;
                }
            }

            return `
                <tr onclick="showProductDetails('${escapeHtml(row.sheetName)}', ${row.rowNumber})" data-bs-toggle="modal" data-bs-target="#productDetailModal" style="cursor: pointer;" class="align-middle">
                    <td class="text-center text-secondary fw-bold">${escapeHtml(row.rowNumber)}</td>
                    <td><span class="badge bg-info bg-opacity-10 text-info border border-info border-opacity-20">${escapeHtml(row.sheetName || '-')}</span></td>
                    <td><span class="badge bg-light text-dark border border-secondary border-opacity-20">${escapeHtml(row.productId || '-')}</span></td>
                    <td>${escapeHtml(row.brand || '-')}</td>
                    <td class="fw-bold">${escapeHtml(row.model || '-')}</td>
                    <td class="text-end price-badge">${formatMoney(row.salePriceValue)}</td>
                    <td class="text-center">${marketCount}</td>
                    <td class="text-end price-badge text-success">${formatMoney(minPriceVal)}</td>
                    <td class="text-end price-badge text-warning fw-bold">${formatMoney(suggestedPriceVal)}</td>
                    <td class="text-center">${statusLabel(row)}</td>
                    <td class="text-center">${haravanCol}</td>
                </tr>
            `;
        }).join('');
    }

    function updateCounter(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = String(value);
    }

    function setPricingStatus(text, tone = 'idle') {
        const badge = document.getElementById('pricingStatusBadge');
        if (!badge) return;

        const styles = {
            idle: { background: 'rgba(255,255,255,0.03)', color: 'var(--text-light)', border: '1px solid rgba(255,255,255,0.05)' },
            running: { background: 'rgba(6,182,212,0.12)', color: '#67e8f9', border: '1px solid rgba(6,182,212,0.2)' },
            success: { background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.2)' },
            warning: { background: 'rgba(245,158,11,0.12)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.2)' },
            error: { background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' },
        };

        const style = styles[tone] || styles.idle;
        badge.innerText = text;
        badge.style.background = style.background;
        badge.style.color = style.color;
        badge.style.borderColor = style.border;
    }

    function refreshSummary() {
        // Compute stats dynamically from state.rows for client-side mode
        if (state.totalRows > 0 && !state.jobId) {
            state.processed = state.rows.filter(r => r.status !== 'pending' && r.status !== 'processing').length;
            state.success = state.rows.filter(r => r.status === 'success' || r.status === 'insufficient_prices').length;
            state.errors = state.rows.filter(r => r.status === 'error' || r.status === 'skipped').length;
        }

        updateCounter('pricingTotalRows', state.totalRows);
        updateCounter('pricingProcessedCount', state.processed);
        updateCounter('pricingSuccessCount', state.success);
        updateCounter('pricingErrorCount', state.errors);
        updateCounter('pricingWriteCount', state.writes);

        // Update progress bar
        const percent = state.totalRows > 0 ? Math.round((state.processed / state.totalRows) * 100) : 0;
        const progressTextEl = document.getElementById('progressText');
        if (progressTextEl) progressTextEl.innerText = `${percent}%`;
        const progressBar = document.getElementById('pricingProgressBar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            progressBar.setAttribute('aria-valuenow', percent);
        }
    }

    function collectPricingForm() {
        syncSelectedSheetNames();
        return {
            appsScriptUrl: document.getElementById('pricingAppsScriptUrl')?.value.trim(),
            sheetUrl: document.getElementById('pricingSheetUrl')?.value.trim(),
            sheetName: document.getElementById('pricingSheetName')?.value.trim(),
            startRow: document.getElementById('pricingStartRow')?.value.trim(),
            endRow: document.getElementById('pricingEndRow')?.value.trim(),
            rowsConcurrency: Math.max(1, parseInt(document.getElementById('pricingRowsConcurrency')?.value || '1', 10)),
            linksConcurrency: Math.max(1, parseInt(document.getElementById('pricingLinksConcurrency')?.value || '5', 10)),
            batchSize: Math.max(1, parseInt(document.getElementById('pricingBatchSize')?.value || '5', 10)),
        };
    }

    function setInputsDisabled(disabled) {
        const inputs = [
            'pricingAppsScriptUrl', 'pricingSheetUrl', 'pricingSheetName',
            'pricingStartRow', 'pricingEndRow', 'pricingBatchSize',
            'pricingRowsConcurrency', 'pricingLinksConcurrency'
        ];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = disabled;
        });

        document.querySelectorAll('#pricingSheetList input').forEach((el) => {
            el.disabled = disabled;
        });

        const reloadButton = document.getElementById('btnReloadSheetNames');
        if (reloadButton) reloadButton.disabled = disabled;
    }

    function setPricingButtons(running) {
        const startButton = document.getElementById('btnPricingStart');
        const stopButton = document.getElementById('btnPricingStop');
        if (startButton) {
            startButton.disabled = running;
            startButton.innerText = running ? '⏳ Đang quét dữ liệu...' : '🚀 Bắt Đầu Quét';
        }
        if (stopButton) {
            stopButton.disabled = !running;
        }
        setInputsDisabled(running);
    }

    function translateStatus(status) {
        switch (status) {
            case 'running': return 'Đang chạy...';
            case 'completed': return 'Hoàn tất';
            case 'stopped': return 'Đã dừng';
            case 'error': return 'Lỗi';
            default: return status || 'Chờ chạy';
        }
    }

    function getStatusTone(status) {
        switch (status) {
            case 'running': return 'running';
            case 'completed': return 'success';
            case 'stopped': return 'warning';
            case 'error': return 'error';
            default: return 'idle';
        }
    }

    function logToTerminal(message, level = 'info') {
        const termBody = document.getElementById('terminalBody');
        if (!termBody) return;
        const timestamp = new Date().toLocaleTimeString('vi-VN');
        let cls = 'log-info';
        if (level === 'success') cls = 'log-success';
        if (level === 'warning') cls = 'log-warning';
        if (level === 'error') cls = 'log-error';

        termBody.innerHTML += `<span class="log-line"><span class="log-time">${timestamp}</span><span class="${cls}">${escapeHtml(message)}</span></span>`;
        termBody.scrollTop = termBody.scrollHeight;
    }

    function startPolling(jobId) {
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
        }
        state.pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/sheet-pricing/status/${jobId}`);
                const data = await response.json();
                if (data && data.ok !== false) {
                    state.processed = data.processedCount || 0;
                    state.success = data.successCount || 0;
                    state.errors = data.errorCount || 0;
                    state.writes = data.writeCount || 0;
                    state.totalRows = data.totalRows || 0;
                    state.rows = data.rows || [];

                    refreshSummary();
                    renderSheetPricingRows();

                    if (data.logs && data.logs.length > 0) {
                        const termBody = document.getElementById('terminalBody');
                        if (termBody) {
                            termBody.innerHTML = data.logs.map(log => {
                                let cls = 'log-info';
                                if (log.level === 'success') cls = 'log-success';
                                if (log.level === 'warning') cls = 'log-warning';
                                if (log.level === 'error') cls = 'log-error';
                                return `<span class="log-line"><span class="log-time">${log.timestamp}</span><span class="${cls}">${escapeHtml(log.message)}</span></span>`;
                            }).join('');
                            termBody.scrollTop = termBody.scrollHeight;
                        }
                    }

                    setPricingStatus(translateStatus(data.status), getStatusTone(data.status));

                    if (data.status !== 'running') {
                        clearInterval(state.pollInterval);
                        state.running = false;
                        setPricingButtons(false);
                    }
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, 1500);
    }

    async function runClientSidePricing(form) {
        logToTerminal(`Khởi tạo tiến trình quét phía client...`, 'info');

        const sheetNames = normalizeSelectedSheetNames(form.sheetName);
        if (sheetNames.length === 0) {
            throw new Error('Tên sheet không hợp lệ.');
        }

        logToTerminal(`Đang tải bảng ánh xạ model từ sheet 18.Mã sản phẩm...`, 'info');
        let modelMapping = {};
        try {
            const mappingResponse = await fetch('/api/sheet-pricing', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    action: 'fetch-mapping',
                    appsScriptUrl: form.appsScriptUrl,
                    sheetUrl: form.sheetUrl,
                })
            });
            const mappingData = await mappingResponse.json();
            if (mappingResponse.ok && mappingData.ok !== false && mappingData.mapping) {
                modelMapping = mappingData.mapping;
                const mappingKeys = Object.keys(modelMapping);
                logToTerminal(`Đã tải thành công ${mappingKeys.length} ánh xạ model từ 18.Mã sản phẩm.`, 'success');
            } else {
                logToTerminal(`Không tìm thấy ánh xạ model nào hoặc lỗi tải 18.Mã sản phẩm.`, 'warning');
            }
        } catch (mapErr) {
            logToTerminal(`Không thể tải bảng ánh xạ: ${mapErr.message}. Vẫn tiếp tục chạy...`, 'warning');
        }

        // Note: Haravan mapping is fetched at the start of startSheetPricingJob

        logToTerminal(`Đang tải danh sách sản phẩm từ các sheet: ${sheetNames.join(', ')}...`, 'info');

        try {
            const fetchPromises = sheetNames.map(async (name) => {
                const response = await fetch('/api/sheet-pricing', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        action: 'fetch-sheet',
                        appsScriptUrl: form.appsScriptUrl,
                        sheetUrl: form.sheetUrl,
                        sheetName: name,
                        startRow: form.startRow,
                        endRow: form.endRow,
                    })
                });

                const data = await response.json();
                if (!response.ok || data.ok === false) {
                    throw new Error(data.error || `Lỗi tải dữ liệu từ sheet "${name}".`);
                }

                const rows = data.rows || [];
                logToTerminal(`Đã tải ${rows.length} dòng từ sheet "${name}".`, 'success');

                return rows.map(r => ({ ...r, sheetName: name }));
            });

            const allResults = await Promise.all(fetchPromises);
            const mergedRows = allResults.flat();

            logToTerminal(`Tổng cộng đã nạp ${mergedRows.length} dòng từ Google Sheet.`, 'success');

            // Reset job state
            state.jobId = null; // Mark as client side
            state.totalRows = mergedRows.length;
            state.processed = 0;
            state.success = 0;
            state.errors = 0;
            state.writes = 0;
            state.rows = mergedRows.map(row => {
                const originalModel = String(row.model || '').trim();
                let cleanedModel = originalModel;
                if (cleanedModel.endsWith('.0')) {
                    cleanedModel = cleanedModel.slice(0, -2);
                }
                let model = originalModel;
                let mapped = false;
                if (/^\d+$/.test(cleanedModel)) {
                    if (modelMapping[cleanedModel]) {
                        model = modelMapping[cleanedModel];
                        mapped = true;
                    }
                }
                if (mapped) {
                    logToTerminal(`Dòng ${row.rowNumber} [${row.sheetName}]: Ánh xạ model số ${originalModel} thành ${model}.`);
                }
                return {
                    rowNumber: row.rowNumber,
                    sheetName: row.sheetName,
                    productId: row.productId || '',
                    brand: row.brand,
                    model: model,
                    originalModel: originalModel,
                    salePriceValue: (() => {
                        let parsed = parseInt(String(row.salePrice || '').replace(/\D/g, ''), 10) || null;
                        if (parsed !== null && parsed < 100000) {
                            parsed = parsed * 1000;
                        }
                        return parsed;
                    })(),
                    status: 'pending',
                    marketPrices: [],
                    matchedDetails: [],
                    minPrice: null,
                    gapValue: null,
                    gapPercent: null,
                    suggestedPrice: null,
                    writtenToSheet: false,
                    errorMessage: '',
                };
            });

            // Helpers to validate brand & model on client side
            const isValidBrand = (brand) => {
                if (!brand) return false;
                return !!String(brand).trim();
            };
            const isValidModel = (model) => {
                if (!model) return false;
                const trimmed = String(model).trim();
                if (!trimmed) return false;
                let cleaned = trimmed;
                if (cleaned.endsWith('.0')) {
                    cleaned = cleaned.slice(0, -2);
                }
                return !/^\d+$/.test(cleaned);
            };

            // Process skipped rows
            state.rows.forEach(r => {
                if (!isValidBrand(r.brand) || !isValidModel(r.model)) {
                    r.status = 'skipped';
                }
            });

            const skippedCount = state.rows.filter(r => r.status === 'skipped').length;
            if (skippedCount > 0) {
                logToTerminal(`Bỏ qua ${skippedCount} dòng do thiếu Thương hiệu, Model hoặc Model chỉ toàn số.`, 'warning');
            }

            refreshSummary();
            renderSheetPricingRows();

            const runnableRows = state.rows.filter(r => r.status === 'pending');
            if (runnableRows.length === 0) {
                state.running = false;
                setPricingButtons(false);
                setPricingStatus('Hoàn tất', 'success');
                logToTerminal('Không có dòng nào đủ điều kiện quét.', 'info');
                return;
            }

            logToTerminal(`Bắt đầu xử lý ${runnableRows.length} dòng sản phẩm...`, 'info');

            let cursor = 0;
            const pendingUpdates = [];
            let activeWorkers = 0;
            let isWriting = false;

            const flushUpdates = async (force = false) => {
                if (pendingUpdates.length === 0) return;
                if (isWriting) return;
                if (!force && pendingUpdates.length < form.batchSize) return;

                isWriting = true;
                const batch = [...pendingUpdates];
                pendingUpdates.splice(0, batch.length);

                // Group by sheetName
                const updatesBySheet = {};
                batch.forEach(update => {
                    const name = update.sheetName;
                    if (!updatesBySheet[name]) updatesBySheet[name] = [];
                    updatesBySheet[name].push(update);
                });

                logToTerminal(`Đang ghi ${batch.length} dòng kết quả lên Google Sheet...`, 'info');
                try {
                    await Promise.all(Object.entries(updatesBySheet).map(async ([name, sheetUpdates]) => {
                        const sheetLogs = [];
                        sheetUpdates.forEach((u) => {
                            if (u.matchedDetails && u.matchedDetails.length > 0) {
                                u.matchedDetails.forEach((detail) => {
                                    sheetLogs.push({
                                        timestamp: new Date().toLocaleString('vi-VN'),
                                        brand: u.brand || '',
                                        model: u.model || '',
                                        price: detail.price,
                                        url: detail.url,
                                    });
                                });
                            }
                        });

                        const writeRes = await fetch('/api/sheet-pricing', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                                action: 'write-results',
                                appsScriptUrl: form.appsScriptUrl,
                                sheetUrl: form.sheetUrl,
                                sheetName: name,
                                updates: sheetUpdates.map(u => ({
                                    rowNumber: u.rowNumber,
                                    marketPrices: u.marketPrices,
                                    hasNewPrices: u.hasNewPrices,
                                    minPrice: u.minPrice,
                                    gapValue: u.gapValue,
                                    gapPercent: u.gapPercent,
                                    suggestedPrice: u.suggestedPrice,
                                    status: u.status,
                                })),
                                logs: sheetLogs,
                            })
                        });
                        const writeData = await writeRes.json();
                        if (!writeRes.ok || writeData.ok === false) {
                            throw new Error(writeData.error || `Lỗi ghi kết quả cho sheet "${name}".`);
                        }
                    }));

                    state.writes += 1;
                    logToTerminal(`Ghi thành công ${batch.length} dòng kết quả lên Google Sheet.`, 'success');

                    batch.forEach(update => {
                        const localRow = state.rows.find(r => r.sheetName === update.sheetName && r.rowNumber === update.rowNumber);
                        if (localRow) localRow.writtenToSheet = true;
                    });
                    refreshSummary();
                    renderSheetPricingRows();
                } catch (writeErr) {
                    logToTerminal(`Lỗi ghi kết quả: ${writeErr.message}`, 'error');
                    pendingUpdates.unshift(...batch); // Put back
                } finally {
                    isWriting = false;
                    // If no more workers are active and we have leftover pending items
                    if (activeWorkers === 0 && cursor >= runnableRows.length && pendingUpdates.length > 0) {
                        setTimeout(() => flushUpdates(true), 1000);
                    }
                }
            };

            const worker = async () => {
                while (state.running && cursor < runnableRows.length) {
                    const currentRow = runnableRows[cursor++];
                    const localRow = state.rows.find(r => r.sheetName === currentRow.sheetName && r.rowNumber === currentRow.rowNumber);
                    if (localRow) {
                        localRow.status = 'processing';
                        renderSheetPricingRows();
                    }

                    logToTerminal(`Đang cào dòng ${currentRow.rowNumber} [${currentRow.sheetName}]: ${currentRow.brand} ${currentRow.model}...`, 'info');
                    try {
                        const processRes = await fetch('/api/sheet-pricing', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                                action: 'process-row',
                                row: {
                                    rowNumber: currentRow.rowNumber,
                                    brand: currentRow.brand,
                                    model: currentRow.model,
                                    salePrice: currentRow.salePrice,
                                    marketPrices: currentRow.marketPrices,
                                    sheetName: currentRow.sheetName,
                                },
                                linksConcurrency: form.linksConcurrency,
                            })
                        });

                        const processData = await processRes.json();
                        if (!state.running) {
                            if (localRow) {
                                localRow.status = 'skipped';
                                localRow.errorMessage = 'Đã dừng theo yêu cầu người dùng.';
                            }
                            break;
                        }
                        if (!processRes.ok || processData.ok === false) {
                            throw new Error(processData.error || 'Lỗi cào dòng.');
                        }

                        const result = processData.result;
                        if (localRow) {
                            localRow.status = result.status;
                            localRow.marketPrices = result.marketPrices || [];
                            localRow.matchedDetails = result.matchedDetails || [];
                            localRow.minPrice = result.minPrice;
                            localRow.gapValue = result.gapValue;
                            localRow.gapPercent = result.gapPercent;
                            localRow.suggestedPrice = result.suggestedPrice;
                            localRow.errorMessage = result.errorMessage || '';

                            if (result.status === 'success' || result.status === 'insufficient_prices') {
                                if (result.status === 'success') {
                                    logToTerminal(`Dòng ${currentRow.rowNumber} [${currentRow.sheetName}] (${currentRow.brand} ${currentRow.model}) thành công: Tìm thấy ${result.totalLinksCount} cửa hàng, quét được ${result.marketPrices.length} giá. Min=${result.minPrice.toLocaleString('vi-VN')} đ, Đề xuất=${result.suggestedPrice ? result.suggestedPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'success');
                                } else {
                                    logToTerminal(`Dòng ${currentRow.rowNumber} [${currentRow.sheetName}] (${currentRow.brand} ${currentRow.model}) thành công (thiếu giá hoặc ít hơn 3 giá): Tìm thấy ${result.totalLinksCount} cửa hàng, quét được ${result.marketPrices.length} giá. Min=${result.minPrice ? result.minPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'warning');
                                }

                                const updateHaravanEnabled = document.getElementById('haravanUpdatePriceEnabled')?.checked;
                                if (updateHaravanEnabled && result.suggestedPrice) {
                                    const key = `${normalizeModelText(currentRow.brand)}_${normalizeModelText(currentRow.model)}`;
                                    const variantId = window.haravanMapping?.[key];
                                    if (variantId) {
                                        const productName = `${currentRow.brand} ${currentRow.model}`;
                                        const confirmed = confirm(`Cập nhật giá cho sản phẩm ${productName} với giá đề xuất ${result.suggestedPrice.toLocaleString('vi-VN')} đ?`);
                                        if (confirmed) {
                                            logToTerminal(`Đang cập nhật giá Haravan cho sản phẩm ${productName} (ID: ${variantId})...`, 'info');
                                            localRow.haravanUpdateState = 'updating';
                                            renderSheetPricingRows();
                                            try {
                                                const updateRes = await fetch('/api/sheet-pricing', {
                                                    method: 'POST',
                                                    headers: { 'content-type': 'application/json' },
                                                    body: JSON.stringify({
                                                        action: 'haravan-update-price',
                                                        haravanShopUrl: document.getElementById('haravanShopUrl')?.value.trim(),
                                                        haravanAccessToken: document.getElementById('haravanAccessToken')?.value.trim(),
                                                        variantId: variantId,
                                                        price: result.suggestedPrice,
                                                    })
                                                });
                                                const updateData = await updateRes.json();
                                                if (!updateRes.ok || updateData.ok === false) {
                                                    throw new Error(updateData.error || `HTTP ${updateRes.status}`);
                                                }
                                                logToTerminal(`Đã cập nhật giá Haravan thành công cho sản phẩm ${productName}!`, 'success');
                                                localRow.haravanUpdateState = 'accepted';
                                            } catch (upErr) {
                                                logToTerminal(`Lỗi cập nhật giá Haravan cho sản phẩm ${productName}: ${upErr.message}`, 'error');
                                                alert(`Lỗi cập nhật giá Haravan: ${upErr.message}`);
                                                localRow.haravanUpdateState = null;
                                            }
                                            renderSheetPricingRows();
                                        } else {
                                            logToTerminal(`Bỏ qua cập nhật giá Haravan cho sản phẩm ${productName}.`, 'warning');
                                            localRow.haravanUpdateState = 'rejected';
                                            renderSheetPricingRows();
                                        }
                                    } else {
                                        logToTerminal(`Không tìm thấy ID Haravan cho sản phẩm ${currentRow.brand} ${currentRow.model} trong sheet 20. ID Haravan.`, 'warning');
                                    }
                                }

                                pendingUpdates.push({
                                    rowNumber: result.rowNumber,
                                    sheetName: currentRow.sheetName,
                                    brand: currentRow.brand,
                                    model: currentRow.model,
                                    marketPrices: result.marketPrices,
                                    hasNewPrices: result.hasNewPrices,
                                    minPrice: result.minPrice,
                                    gapValue: result.gapValue,
                                    gapPercent: result.gapPercent,
                                    suggestedPrice: result.suggestedPrice,
                                    status: result.status,
                                    matchedDetails: result.matchedDetails || [],
                                });
                            } else {
                                logToTerminal(`Dòng ${currentRow.rowNumber} [${currentRow.sheetName}] (${currentRow.brand} ${currentRow.model}) lỗi: ${result.errorMessage || result.status}`, 'warning');
                            }
                        }
                    } catch (rowErr) {
                        if (localRow) {
                            localRow.status = 'error';
                            localRow.errorMessage = rowErr.message;
                        }
                        logToTerminal(`Lỗi xử lý dòng ${currentRow.rowNumber} [${currentRow.sheetName}]: ${rowErr.message}`, 'error');
                    } finally {
                        refreshSummary();
                        renderSheetPricingRows();
                        await flushUpdates(false);
                    }
                }
            };

            const workerPromises = [];
            activeWorkers = Math.min(form.rowsConcurrency, runnableRows.length);
            for (let i = 0; i < activeWorkers; i++) {
                workerPromises.push(worker());
            }

            Promise.all(workerPromises).finally(async () => {
                activeWorkers = 0;
                await flushUpdates(true);

                state.running = false;
                setPricingButtons(false);

                if (cursor < runnableRows.length) {
                    setPricingStatus('Đã dừng', 'warning');
                    logToTerminal('Tiến trình quét đã bị dừng bởi người dùng.', 'warning');
                } else {
                    setPricingStatus('Hoàn tất', 'success');
                    logToTerminal('Tiến trình quét toàn bộ sheet đã hoàn thành!', 'success');
                }
            });

        } catch (error) {
            state.running = false;
            setPricingButtons(false);
            setPricingStatus('Lỗi', 'error');
            logToTerminal(`Tiến trình cào lỗi: ${error.message}`, 'error');
            alert(`Lỗi cào: ${error.message}`);
        }
    }

    async function fetchHaravanMappingIfPossible() {
        const appsScriptUrl = document.getElementById('pricingAppsScriptUrl')?.value.trim();
        const sheetUrl = document.getElementById('pricingSheetUrl')?.value.trim();
        const haravanToken = document.getElementById('haravanAccessToken')?.value.trim();
        const updateHaravanEnabled = document.getElementById('haravanUpdatePriceEnabled')?.checked;

        if (!appsScriptUrl || !sheetUrl) return;
        
        window.haravanMapping = {};
        window.haravanMappingLoaded = false;

        if (updateHaravanEnabled || haravanToken) {
            logToTerminal(`Đang tải bảng ánh xạ Haravan ID từ sheet 20. ID Haravan...`, 'info');
            try {
                const haravanMappingResponse = await fetch('/api/sheet-pricing', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        action: 'fetch-haravan-mapping',
                        appsScriptUrl,
                        sheetUrl,
                    })
                });
                const haravanMappingData = await haravanMappingResponse.json();
                if (haravanMappingResponse.ok && haravanMappingData.ok !== false && haravanMappingData.mapping) {
                    window.haravanMapping = haravanMappingData.mapping;
                    window.haravanMappingLoaded = true;
                    const mappingKeys = Object.keys(window.haravanMapping);
                    logToTerminal(`Đã tải thành công ${mappingKeys.length} ánh xạ ID từ 20. ID Haravan.`, 'success');
                } else {
                    logToTerminal(`Không tìm thấy ánh xạ ID nào hoặc lỗi tải 20. ID Haravan.`, 'warning');
                }
            } catch (hMapErr) {
                logToTerminal(`Không thể tải bảng ánh xạ Haravan ID: ${hMapErr.message}.`, 'warning');
            }
        }
    }

    async function startSheetPricingJob() {
        if (state.running) return;

        const form = collectPricingForm();
        if (!form.appsScriptUrl || !form.sheetUrl || !form.sheetName) {
            alert('Vui lòng nhập đầy đủ Apps Script URL, Google Sheet URL và tên sheet.');
            const collapseConfig = document.getElementById('collapseConfig');
            if (collapseConfig && !collapseConfig.classList.contains('show')) {
                const trigger = document.querySelector('[data-bs-target="#collapseConfig"]');
                if (trigger) trigger.click();
            }
            return;
        }

        state.running = true;
        setPricingButtons(true);
        setPricingStatus('Khởi tạo...', 'running');

        const termBody = document.getElementById('terminalBody');
        if (termBody) {
            termBody.innerHTML = `<span class="log-line text-info">Đang kết nối và khởi chạy quét dữ liệu...</span>`;
        }

        // Fetch Haravan mapping first so it's ready in memory for client actions/renders
        await fetchHaravanMappingIfPossible();

        const isNetlify = window.location.hostname.endsWith('netlify.app');
        const updateHaravanEnabled = document.getElementById('haravanUpdatePriceEnabled')?.checked;
        if (isNetlify || updateHaravanEnabled) {
            runClientSidePricing(form);
        } else {
            try {
                const response = await fetch('/api/sheet-pricing/start', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(form),
                });

                const data = await response.json();
                if (!response.ok || data.ok === false) {
                    throw new Error(data.error || `HTTP ${response.status}`);
                }

                state.jobId = data.jobId;
                startPolling(state.jobId);
            } catch (error) {
                // If it hits Netlify function locally via netlify dev redirects
                if (error.message.includes('Thieu action') || error.message.includes('404')) {
                    logToTerminal('Môi trường Serverless / Netlify phát hiện. Chuyển sang quét tự động phía client...', 'warning');
                    runClientSidePricing(form);
                } else {
                    state.running = false;
                    setPricingButtons(false);
                    setPricingStatus('Lỗi khởi tạo', 'error');
                    if (termBody) {
                        termBody.innerHTML = `<span class="log-line log-error">Lỗi khởi tạo: ${escapeHtml(error.message)}</span>`;
                    }
                    alert(`Lỗi khởi tạo: ${error.message}`);
                }
            }
        }
    }

    async function stopSheetPricingJob() {
        if (!state.running) return;
        setPricingStatus('Đang dừng...', 'warning');
        state.running = false; // Triggers cancellation for client-side mode
        if (state.jobId) {
            try {
                await fetch(`/api/sheet-pricing/stop/${state.jobId}`, {
                    method: 'POST',
                });
            } catch (error) {
                console.error('Stop job error:', error);
            }
        }
    }

    async function loadSheetNames() {
        const appsScriptUrl = document.getElementById('pricingAppsScriptUrl')?.value.trim();
        const sheetUrl = document.getElementById('pricingSheetUrl')?.value.trim();
        const listEl = document.getElementById('pricingSheetList');
        const hiddenInput = document.getElementById('pricingSheetName');
        if (!listEl || !hiddenInput) return;
        if (!appsScriptUrl || !sheetUrl) {
            listEl.innerHTML = '<div class="text-light opacity-75">(Nhập Config trước)</div>';
            hiddenInput.value = '';
            updateSheetSelectionSummary([]);
            return;
        }

        listEl.innerHTML = '<div class="text-light opacity-75">Đang tải danh sách sheet...</div>';
        try {
            const response = await fetch('/api/sheet-pricing', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    action: 'list-sheets',
                    appsScriptUrl,
                    sheetUrl,
                })
            });
            const data = await response.json();
            if (!response.ok || !data || data.ok === false || !Array.isArray(data.sheets)) {
                const errorMessage = data?.error || `HTTP ${response.status}`;
                listEl.innerHTML = '<div class="text-danger opacity-75">Lỗi tải danh sách sheet.</div>';
                hiddenInput.value = '';
                updateSheetSelectionSummary([]);
                logToTerminal(`Khong tai duoc danh sach sheet: ${errorMessage}`, 'error');
                return;
            }
            if (data && data.ok !== false && data.sheets) {
                const visibleSheets = data.sheets.filter((sheet) => sheet !== '18.Mã sản phẩm' && sheet !== '19.Log' && sheet !== '20. ID Haravan');
                const initialSelection = normalizeSelectedSheetNames(hiddenInput.value || state.initialSheetName)
                    .filter((sheet) => visibleSheets.includes(sheet));
                renderSheetOptions(visibleSheets, initialSelection);
                return;
            } else {
                listEl.innerHTML = '<div class="text-danger opacity-75">Lỗi tải danh sách sheet.</div>';
                hiddenInput.value = '';
                updateSheetSelectionSummary([]);
            }
        } catch (err) {
            console.error('Failed to load sheet list:', err);
            listEl.innerHTML = '<div class="text-danger opacity-75">Lỗi tải danh sách sheet.</div>';
            hiddenInput.value = '';
            updateSheetSelectionSummary([]);
            logToTerminal(`Khong tai duoc danh sach sheet: ${err.message}`, 'error');
        }
    }

    async function loadConfig() {
        try {
            const response = await fetch('/api/sheet-pricing/config');
            const data = await response.json();
            if (data && data.ok !== false) {
                if (data.appsScriptUrl && document.getElementById('pricingAppsScriptUrl')) {
                    document.getElementById('pricingAppsScriptUrl').value = data.appsScriptUrl;
                }
                if (data.sheetUrl && document.getElementById('pricingSheetUrl')) {
                    document.getElementById('pricingSheetUrl').value = data.sheetUrl;
                }
                if (data.sheetName) {
                    state.initialSheetName = data.sheetName;
                }
                await loadSheetNames();
            }
        } catch (error) {
            console.error('Failed to load environment config:', error);
        }
    }

    function showProductDetails(sheetName, rowNumber) {
        const row = state.rows.find(r => r.sheetName === sheetName && Number(r.rowNumber) === Number(rowNumber));
        if (!row) return;

        const titleEl = document.getElementById('modalProductTitle');
        const codeEl = document.getElementById('modalProductCode');
        const tableBody = document.getElementById('modalUrlsTableBody');

        if (titleEl) titleEl.innerText = `${row.brand || ''} ${row.model || ''}`;
        if (codeEl) codeEl.innerText = row.productId || '-';

        if (tableBody) {
            if (!row.matchedDetails || row.matchedDetails.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="2" class="text-center text-light opacity-75 py-3">Không có liên kết giá nào được tìm thấy.</td>
                    </tr>
                `;
            } else {
                tableBody.innerHTML = row.matchedDetails.map(detail => {
                    return `
                        <tr>
                            <td>
                                <a href="${escapeHtml(detail.url)}" target="_blank" class="text-accent text-decoration-none" style="word-break: break-all; color: var(--accent-color);">
                                    ${escapeHtml(detail.url)}
                                </a>
                            </td>
                            <td class="text-end fw-bold text-success price-badge" style="width: 150px; font-family: 'JetBrains Mono', monospace;">
                                ${formatMoney(detail.price)}
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        const modalElement = document.getElementById('productDetailModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
            modal.show();
        }
    }



    ['pricingAppsScriptUrl', 'pricingSheetUrl'].forEach((id) => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', loadSheetNames);
            input.addEventListener('blur', loadSheetNames);
        }
    });

    loadConfig();
    setPricingStatus('Chờ chạy', 'idle');

    async function syncHaravanIds() {
        const btn = document.getElementById('btnHaravanSync');
        const shopUrl = document.getElementById('haravanShopUrl')?.value.trim();
        const token = document.getElementById('haravanAccessToken')?.value.trim();
        const appsScriptUrl = document.getElementById('pricingAppsScriptUrl')?.value.trim();
        const sheetUrl = document.getElementById('pricingSheetUrl')?.value.trim();

        if (!shopUrl || !token || !appsScriptUrl || !sheetUrl) {
            alert('Vui lòng nhập đầy đủ: Apps Script URL, Google Sheet URL, Haravan Shop URL và Access Token.');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerText = '⏳ Đang đồng bộ...';
        }

        logToTerminal(`Bắt đầu đồng bộ ID Haravan từ ${shopUrl}...`, 'info');

        try {
            const response = await fetch('/api/sheet-pricing', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    action: 'haravan-sync',
                    appsScriptUrl,
                    sheetUrl,
                    haravanShopUrl: shopUrl,
                    haravanAccessToken: token,
                }),
            });

            const data = await response.json();
            if (!response.ok || data.ok === false) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            logToTerminal(`Đồng bộ thành công! Đã lấy ${data.fetched} biến thể, ghi thành công ${data.written} dòng lên sheet "20. ID Haravan".`, 'success');
            alert(`Đồng bộ thành công! Đã ghi ${data.written} dòng lên sheet "20. ID Haravan".`);
        } catch (error) {
            logToTerminal(`Lỗi đồng bộ Haravan: ${error.message}`, 'error');
            alert(`Lỗi đồng bộ Haravan: ${error.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = '🔄 Đồng bộ lên sheet 20. ID Haravan';
            }
        }
    }

    async function acceptPriceUpdate(sheetName, rowNumber) {
        const row = state.rows.find((r) => r.sheetName === sheetName && r.rowNumber === rowNumber);
        if (!row) return;

        const key = `${normalizeModelText(row.brand)}_${normalizeModelText(row.model)}`;
        const variantId = window.haravanMapping?.[key];
        if (!variantId) {
            alert('Không tìm thấy ID Haravan cho sản phẩm này.');
            return;
        }

        row.haravanUpdateState = 'updating';
        renderSheetPricingRows();

        const productName = `${row.brand} ${row.model}`;
        logToTerminal(`[Cập nhật] Đang cập nhật giá Haravan cho sản phẩm ${productName} (ID: ${variantId}) với giá đề xuất ${formatMoney(row.suggestedPrice)}...`, 'info');

        try {
            const updateRes = await fetch('/api/sheet-pricing', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    action: 'haravan-update-price',
                    haravanShopUrl: document.getElementById('haravanShopUrl')?.value.trim(),
                    haravanAccessToken: document.getElementById('haravanAccessToken')?.value.trim(),
                    variantId: variantId,
                    price: row.suggestedPrice,
                })
            });
            const updateData = await updateRes.json();
            if (!updateRes.ok || updateData.ok === false) {
                throw new Error(updateData.error || `HTTP ${updateRes.status}`);
            }
            logToTerminal(`[Cập nhật] Đã cập nhật giá Haravan thành công cho sản phẩm ${productName}!`, 'success');
            row.haravanUpdateState = 'accepted';
        } catch (upErr) {
            logToTerminal(`[Cập nhật] Lỗi cập nhật giá Haravan cho sản phẩm ${productName}: ${upErr.message}`, 'error');
            alert(`Lỗi cập nhật giá Haravan: ${upErr.message}`);
            row.haravanUpdateState = null;
        }
        renderSheetPricingRows();
    }

    function rejectPriceUpdate(sheetName, rowNumber) {
        const row = state.rows.find((r) => r.sheetName === sheetName && r.rowNumber === rowNumber);
        if (!row) return;
        row.haravanUpdateState = 'rejected';
        const productName = `${row.brand} ${row.model}`;
        logToTerminal(`[Cập nhật] Đã từ chối cập nhật giá cho sản phẩm ${productName}.`, 'warning');
        renderSheetPricingRows();
    }

    window.startSheetPricingJob = startSheetPricingJob;
    window.stopSheetPricingJob = stopSheetPricingJob;
    window.showProductDetails = showProductDetails;
    window.loadSheetNames = loadSheetNames;
    window.syncHaravanIds = syncHaravanIds;
    window.acceptPriceUpdate = acceptPriceUpdate;
    window.rejectPriceUpdate = rejectPriceUpdate;
})();
