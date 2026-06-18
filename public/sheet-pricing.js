(function () {
    const state = {
        running: false,
        jobId: null,
        rows: [],
        processed: 0,
        success: 0,
        errors: 0,
        writes: 0,
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
            return `<span class="badge bg-secondary bg-opacity-25 text-muted">Bỏ qua</span>`;
        }
        return `<span class="badge bg-secondary bg-opacity-25 text-light">${escapeHtml(row.status || 'Chờ chạy')}</span>`;
    }

    function renderSheetPricingRows() {
        const tbody = document.getElementById('sheetPricingBody');
        if (!tbody) return;

        const query = (document.getElementById('searchFilter')?.value || '').trim().toLowerCase();
        const filtered = state.rows.filter((row) => {
            if (!query) return true;
            return [row.productId, row.brand, row.model].some((value) => String(value || '').toLowerCase().includes(query));
        });

        tbody.innerHTML = filtered.map((row) => `
            <tr>
                <td class="text-center text-muted fw-bold">${escapeHtml(row.rowNumber)}</td>
                <td>${escapeHtml(row.productId || '-')}</td>
                <td>${escapeHtml(row.brand || '-')}</td>
                <td class="fw-semibold">${escapeHtml(row.model || '-')}</td>
                <td class="text-center">${formatMoney(row.salePriceValue)}</td>
                <td class="text-center">${row.marketPrices ? row.marketPrices.length : 0}</td>
                <td class="text-center price-badge">${formatMoney(row.minPrice)}</td>
                <td class="text-center ${row.gapValue > 0 ? 'text-danger' : 'text-success'}">${formatMoney(row.gapValue)}</td>
                <td class="text-center">${formatPercent(row.gapPercent)}</td>
                <td class="text-center fw-bold text-warning">${formatMoney(row.suggestedPrice)}</td>
                <td class="text-center">${statusLabel(row)}</td>
            </tr>
        `).join('');
    }

    function updateCounter(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = String(value);
    }

    function setPricingStatus(text, tone = 'idle') {
        const badge = document.getElementById('pricingStatusBadge');
        if (!badge) return;

        const styles = {
            idle: { background: 'rgba(255,255,255,0.04)', color: 'var(--text-light)' },
            running: { background: 'rgba(6,182,212,0.14)', color: '#67e8f9' },
            success: { background: 'rgba(16,185,129,0.16)', color: '#6ee7b7' },
            warning: { background: 'rgba(245,158,11,0.14)', color: '#fcd34d' },
            error: { background: 'rgba(239,68,68,0.16)', color: '#fca5a5' },
        };

        const style = styles[tone] || styles.idle;
        badge.innerText = text;
        badge.style.background = style.background;
        badge.style.color = style.color;
    }

    function refreshSummary() {
        updateCounter('pricingProcessedCount', state.processed);
        updateCounter('pricingSuccessCount', state.success);
        updateCounter('pricingErrorCount', state.errors);
        updateCounter('pricingWriteCount', state.writes);
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

    function setPricingButtons(running) {
        const startButton = document.getElementById('btnPricingStart');
        const stopButton = document.getElementById('btnPricingStop');
        if (startButton) {
            startButton.disabled = running;
            startButton.innerText = running ? '⏳ Đang chạy pricing...' : '🚀 Chạy Sheet Pricing';
        }
        if (stopButton) {
            stopButton.disabled = !running;
        }
    }

    function translateStatus(status) {
        switch(status) {
            case 'running': return 'Đang chạy pricing...';
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

    async function startSheetPricingJob() {
        if (state.running) return;

        const form = collectPricingForm();
        if (!form.appsScriptUrl || !form.sheetUrl || !form.sheetName) {
            alert('Vui lòng nhập đầy đủ Apps Script URL, Google Sheet URL và tên sheet.');
            return;
        }

        state.running = true;
        setPricingButtons(true);
        setPricingStatus('Đang khởi tạo job...', 'running');
        
        if (typeof writeToConsole === 'function') {
            writeToConsole(`Đang gửi yêu cầu khởi tạo job Sheet Pricing cho sheet "${form.sheetName}"...`, 'info');
        }

        try {
            if (typeof setCheDoXem === 'function') {
                setCheDoXem('sheetPricing');
            }

            const response = await fetch('/api/sheet-pricing/start', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify(form),
            });

            const data = await response.json();
            if (!response.ok || data.ok === false) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            state.jobId = data.jobId;
            startPolling(state.jobId);
        } catch (error) {
            state.running = false;
            setPricingButtons(false);
            setPricingStatus('Lỗi khởi tạo', 'error');
            if (typeof writeToConsole === 'function') {
                writeToConsole(`Khởi tạo job lỗi: ${error.message}`, 'error');
            }
            alert(`Lỗi khởi tạo: ${error.message}`);
        }
    }

    async function stopSheetPricingJob() {
        if (!state.running || !state.jobId) return;
        setPricingStatus('Đang dừng...', 'warning');
        try {
            await fetch(`/api/sheet-pricing/stop/${state.jobId}`, {
                method: 'POST',
            });
            if (typeof writeToConsole === 'function') {
                writeToConsole('Đã gửi yêu cầu dừng job. Hệ thống đang hoàn tất xử lý các dòng hiện tại và ghi kết quả...', 'warning');
            }
        } catch (error) {
            console.error('Stop job error:', error);
        }
    }

    const originalSetCheDoXem = window.setCheDoXem;
    if (typeof originalSetCheDoXem === 'function') {
        window.setCheDoXem = function patchedSetCheDoXem(mode) {
            window.activeViewMode = mode;
            const sheetButton = document.getElementById('btnViewSheetPricing');
            const sheetContainer = document.getElementById('sheetPricingContainer');
            if (sheetButton) sheetButton.classList.remove('active');
            if (sheetContainer) sheetContainer.classList.add('d-none');

            if (mode !== 'sheetPricing') {
                return originalSetCheDoXem(mode);
            }

            window.activeViewMode = mode;
            originalSetCheDoXem('grid');

            ['btnViewGrid', 'btnViewTable', 'btnViewCompare', 'btnViewCsvCompare'].forEach((id) => {
                const button = document.getElementById(id);
                if (button) button.classList.remove('active');
            });
            const tableDiv = document.getElementById('tableContainer');
            const gridDiv = document.getElementById('gridContainer');
            const compareDiv = document.getElementById('compareContainer');
            const csvCompareDiv = document.getElementById('csvCompareContainer');
            const emptyState = document.getElementById('emptyState');

            if (tableDiv) tableDiv.classList.add('d-none');
            if (gridDiv) gridDiv.classList.add('d-none');
            if (compareDiv) compareDiv.classList.add('d-none');
            if (csvCompareDiv) csvCompareDiv.classList.add('d-none');
            if (emptyState) emptyState.classList.add('d-none');
            if (sheetButton) sheetButton.classList.add('active');
            if (sheetContainer) sheetContainer.classList.remove('d-none');
            renderSheetPricingRows();
        };
    }

    const originalLocDuLieu = window.locDuLieu;
    if (typeof originalLocDuLieu === 'function') {
        window.locDuLieu = function patchedLocDuLieu() {
            if (window.activeViewMode === 'sheetPricing') {
                renderSheetPricingRows();
                return;
            }
            return originalLocDuLieu();
        };
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

    window.startSheetPricingJob = startSheetPricingJob;
    window.stopSheetPricingJob = stopSheetPricingJob;
})();
