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
    };

    function escapeHtml(value) {
        return String(value ?? '')
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

    function statusLabel(row) {
        if (row.errorMessage) {
            return `<span class="badge bg-danger bg-opacity-25 text-danger">Lỗi: ${escapeHtml(row.errorMessage)}</span>`;
        }
        if (row.status === 'processing') {
            return `<span class="badge bg-info bg-opacity-25 text-info">Đang xử lý</span>`;
        }
        if (row.status === 'success') {
            return `<span class="badge bg-success bg-opacity-25 text-success">${row.writtenToSheet ? 'Đã ghi sheet' : 'Thành công'}</span>`;
        }
        if (row.status === 'insufficient_prices') {
            return `<span class="badge bg-warning bg-opacity-25 text-warning">${row.writtenToSheet ? 'Đã ghi, thiếu giá' : 'Thiếu giá'}</span>`;
        }
        if (row.status === 'skipped') {
            return `<span class="badge bg-secondary bg-opacity-25 text-light opacity-75">Bỏ qua</span>`;
        }
        return `<span class="badge bg-secondary bg-opacity-25 text-light">${escapeHtml(row.status || 'Chờ chạy')}</span>`;
    }

    function renderSheetPricingRows() {
        const tbody = document.getElementById('sheetPricingBody');
        if (!tbody) return;

        if (state.rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center text-light opacity-75 py-4">Chưa có dữ liệu nào được tải về.</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = state.rows.map((row) => {
            const minPriceVal = row.minPrice;
            const suggestedPriceVal = row.suggestedPrice;
            const marketCount = row.marketPrices ? row.marketPrices.length : 0;
            return `
                <tr>
                    <td class="text-center text-light opacity-50 fw-bold">${escapeHtml(row.rowNumber)}</td>
                    <td><span class="badge bg-secondary bg-opacity-10 text-white border border-secondary border-opacity-20">${escapeHtml(row.productId || '-')}</span></td>
                    <td>${escapeHtml(row.brand || '-')}</td>
                    <td class="fw-semibold text-white">${escapeHtml(row.model || '-')}</td>
                    <td class="text-center price-badge">${formatMoney(row.salePriceValue)}</td>
                    <td class="text-center">${marketCount}</td>
                    <td class="text-center price-badge text-success">${formatMoney(minPriceVal)}</td>
                    <td class="text-center price-badge text-warning fw-bold">${formatMoney(suggestedPriceVal)}</td>
                    <td class="text-center">${statusLabel(row)}</td>
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
        return {
            appsScriptUrl: document.getElementById('pricingAppsScriptUrl')?.value.trim(),
            sheetUrl: document.getElementById('pricingSheetUrl')?.value.trim(),
            sheetName: document.getElementById('pricingSheetName')?.value.trim(),
            startRow: document.getElementById('pricingStartRow')?.value.trim(),
            endRow: document.getElementById('pricingEndRow')?.value.trim(),
            rowsConcurrency: Math.max(1, parseInt(document.getElementById('pricingRowsConcurrency')?.value || '2', 10)),
            linksConcurrency: Math.max(1, parseInt(document.getElementById('pricingLinksConcurrency')?.value || '4', 10)),
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
        switch(status) {
            case 'running': return 'Đang chạy...';
            case 'completed': return 'Hoàn tất';
            case 'stopped': return 'Đã dừng';
            case 'error': return 'Lỗi';
            default: return status || 'Chờ chạy';
        }
    }

    function getStatusTone(status) {
        switch(status) {
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
        logToTerminal(`Đang tải danh sách sản phẩm từ sheet "${form.sheetName}"...`, 'info');
        
        try {
            // Fetch rows from Netlify API endpoint
            const response = await fetch('/api/sheet-pricing', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    action: 'fetch-sheet',
                    appsScriptUrl: form.appsScriptUrl,
                    sheetUrl: form.sheetUrl,
                    sheetName: form.sheetName,
                    startRow: form.startRow,
                    endRow: form.endRow,
                })
            });
            
            const data = await response.json();
            if (!response.ok || data.ok === false) {
                throw new Error(data.error || 'Lỗi tải dữ liệu từ Google Sheet.');
            }

            const rows = data.rows || [];
            logToTerminal(`Đã nạp ${rows.length} dòng từ Google Sheet.`, 'success');

            // Reset job state
            state.jobId = null; // Mark as client side
            state.totalRows = rows.length;
            state.processed = 0;
            state.success = 0;
            state.errors = 0;
            state.writes = 0;
            state.rows = rows.map(row => ({
                rowNumber: row.rowNumber,
                productId: row.productId || '',
                brand: row.brand,
                model: row.model,
                salePriceValue: parseInt(String(row.salePrice || '').replace(/\D/g, ''), 10) || null,
                status: 'pending',
                marketPrices: [],
                minPrice: null,
                gapValue: null,
                gapPercent: null,
                suggestedPrice: null,
                writtenToSheet: false,
                errorMessage: '',
            }));

            // Helpers to validate brand & model on client side
            const isValidBrand = (brand) => {
                if (!brand) return false;
                return !!String(brand).trim();
            };
            const isValidModel = (model) => {
                if (!model) return false;
                const trimmed = String(model).trim();
                if (!trimmed) return false;
                return !/^\d+$/.test(trimmed);
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

                logToTerminal(`Đang ghi ${batch.length} dòng kết quả lên Google Sheet...`, 'info');
                try {
                    const writeRes = await fetch('/api/sheet-pricing', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                            action: 'write-results',
                            appsScriptUrl: form.appsScriptUrl,
                            sheetUrl: form.sheetUrl,
                            sheetName: form.sheetName,
                            updates: batch,
                        })
                    });
                    const writeData = await writeRes.json();
                    if (!writeRes.ok || writeData.ok === false) {
                        throw new Error(writeData.error || 'Lỗi ghi kết quả.');
                    }

                    state.writes += 1;
                    logToTerminal(`Ghi thành công ${batch.length} dòng kết quả lên Google Sheet.`, 'success');

                    batch.forEach(update => {
                        const localRow = state.rows.find(r => r.rowNumber === update.rowNumber);
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
                    const localRow = state.rows.find(r => r.rowNumber === currentRow.rowNumber);
                    if (localRow) {
                        localRow.status = 'processing';
                        renderSheetPricingRows();
                    }

                    logToTerminal(`Đang cào dòng ${currentRow.rowNumber}: ${currentRow.brand} ${currentRow.model}...`, 'info');
                    try {
                        const processRes = await fetch('/api/sheet-pricing', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                                action: 'process-row',
                                row: currentRow,
                                linksConcurrency: form.linksConcurrency,
                            })
                        });

                        const processData = await processRes.json();
                        if (!processRes.ok || processData.ok === false) {
                            throw new Error(processData.error || 'Lỗi cào dòng.');
                        }

                        const result = processData.result;
                        if (localRow) {
                            localRow.status = result.status;
                            localRow.marketPrices = result.marketPrices || [];
                            localRow.minPrice = result.minPrice;
                            localRow.gapValue = result.gapValue;
                            localRow.gapPercent = result.gapPercent;
                            localRow.suggestedPrice = result.suggestedPrice;
                            localRow.errorMessage = result.errorMessage || '';

                            if (result.status === 'success' || result.status === 'insufficient_prices') {
                                if (result.status === 'success') {
                                    logToTerminal(`Dòng ${currentRow.rowNumber} (${currentRow.brand} ${currentRow.model}) thành công: Min=${result.minPrice.toLocaleString('vi-VN')} đ, Đề xuất=${result.suggestedPrice ? result.suggestedPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'success');
                                } else {
                                    logToTerminal(`Dòng ${currentRow.rowNumber} (${currentRow.brand} ${currentRow.model}) thành công (thiếu giá): Min=${result.minPrice ? result.minPrice.toLocaleString('vi-VN') + ' đ' : '-'}`, 'warning');
                                }

                                pendingUpdates.push({
                                    rowNumber: result.rowNumber,
                                    marketPrices: result.marketPrices,
                                    hasNewPrices: result.hasNewPrices,
                                    minPrice: result.minPrice,
                                    gapValue: result.gapValue,
                                    gapPercent: result.gapPercent,
                                    suggestedPrice: result.suggestedPrice,
                                    status: result.status,
                                });
                            } else {
                                logToTerminal(`Dòng ${currentRow.rowNumber} (${currentRow.brand} ${currentRow.model}) lỗi: ${result.errorMessage || result.status}`, 'warning');
                            }
                        }
                    } catch (rowErr) {
                        if (localRow) {
                            localRow.status = 'error';
                            localRow.errorMessage = rowErr.message;
                        }
                        logToTerminal(`Lỗi xử lý dòng ${currentRow.rowNumber}: ${rowErr.message}`, 'error');
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

        const isNetlify = window.location.hostname.endsWith('netlify.app');
        if (isNetlify) {
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
                if (data.sheetName && document.getElementById('pricingSheetName')) {
                    document.getElementById('pricingSheetName').value = data.sheetName;
                }
            }
        } catch (error) {
            console.error('Failed to load environment config:', error);
        }
    }

    loadConfig();
    setPricingStatus('Chờ chạy', 'idle');

    window.startSheetPricingJob = startSheetPricingJob;
    window.stopSheetPricingJob = stopSheetPricingJob;
})();
