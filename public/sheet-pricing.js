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
            return `<span class="badge bg-secondary bg-opacity-25 text-muted">Bỏ qua</span>`;
        }
        return `<span class="badge bg-secondary bg-opacity-25 text-light">${escapeHtml(row.status || 'Chờ chạy')}</span>`;
    }

    function renderSheetPricingRows() {
        const tbody = document.getElementById('sheetPricingBody');
        if (!tbody) return;

        if (state.rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center text-muted py-4">Chưa có dữ liệu nào được tải về.</td>
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
                    <td class="text-center text-muted fw-bold">${escapeHtml(row.rowNumber)}</td>
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

    async function startSheetPricingJob() {
        if (state.running) return;

        const form = collectPricingForm();
        if (!form.appsScriptUrl || !form.sheetUrl || !form.sheetName) {
            alert('Vui lòng nhập đầy đủ Apps Script URL, Google Sheet URL và tên sheet.');
            // Open settings accordion to highlight inputs
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
            termBody.innerHTML = `<span class="log-line text-info">Đang kết nối tới Google Sheets và khởi chạy quét dữ liệu...</span>`;
        }

        try {
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
            if (termBody) {
                termBody.innerHTML = `<span class="log-line log-error">Lỗi khởi tạo: ${escapeHtml(error.message)}</span>`;
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
        } catch (error) {
            console.error('Stop job error:', error);
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

    window.startSheetPricingJob = startSheetPricingJob;
    window.stopSheetPricingJob = stopSheetPricingJob;
})();
