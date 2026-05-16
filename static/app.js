(function () {
    'use strict';

    // ─── DOM refs ───────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const video         = $('#video');
    const canvas        = $('#canvas');
    const preview       = $('#preview');
    const previewArea   = $('#previewArea');
    const cameraView    = $('#cameraView');
    const cameraOverlay = $('#cameraOverlay');
    const captureBtn    = $('#captureBtn');
    const uploadBtn     = $('#uploadBtn');
    const fileInput     = $('#fileInput');
    const retakeBtn     = $('#retakeBtn');
    const confirmBtn    = $('#confirmBtn');
    const loading       = $('#loading');
    const loadingText   = $('#loadingText');
    const inputPanel    = $('#inputPanel');
    const resultPanel   = $('#resultPanel');
    const listPanel     = $('#listPanel');
    const toggleViewBtn = $('#toggleViewBtn');
    const notesList     = $('#notesList');
    const searchInput   = $('#searchInput');
    const errorBanner   = $('#errorBanner');

    const formattedText = $('#formattedText');
    const rawText       = $('#rawText');
    const resultImage   = $('#resultImage');
    const confidenceBadge = $('#confidenceBadge');

    const saveBtn       = $('#saveBtn');
    const copyBtn       = $('#copyBtn');
    const newBtn        = $('#newBtn');

    const detailModal   = $('#detailModal');
    const modalTitle    = $('#modalTitle');
    const modalBody     = $('#modalBody');
    const closeModal    = $('#closeModal');
    const modalEditBtn  = $('#modalEditBtn');
    const modalDeleteBtn = $('#modalDeleteBtn');

    const tabs = document.querySelectorAll('.tab');

    // ─── State ──────────────────────────────────────
    let stream = null;
    let capturedBlob = null;
    let lastResult = null;
    let currentView = 'input';

    // ─── Camera ─────────────────────────────────────
    // Detect if we're in a secure context (HTTPS or localhost)
    const isSecureContext = window.isSecureContext ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1';

    async function startCamera() {
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (!isSecureContext) {
                showError('🔒 相机需要 HTTPS 访问。请通过 https:// 访问此页面，或使用"选择图片"功能。');
            } else {
                showError('您的浏览器不支持相机访问，请使用"选择图片"功能。');
            }
            // Disable camera button, keep upload working
            captureBtn.disabled = true;
            captureBtn.style.opacity = '0.5';
            captureBtn.title = '请在 HTTPS 下使用相机';
            return;
        }

        try {
            // Use a more conservative resolution for mobile
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 960 },
                },
                audio: false,
            });
            video.srcObject = stream;
            await video.play();
            captureBtn.disabled = false;
            captureBtn.style.opacity = '1';
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                showError('相机权限被拒绝，请在浏览器设置中允许相机访问，或使用"选择图片"功能。');
            } else if (err.name === 'NotFoundError') {
                showError('未检测到摄像头，请使用"选择图片"功能。');
            } else {
                showError('无法打开相机: ' + err.message + '。请使用"选择图片"功能。');
            }
        }
    }

    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        video.srcObject = null;
    }

    // ─── Image compression ─────────────────────────
    function compressImage(blob, maxDimension = 1280, quality = 0.85) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width;
                let h = img.height;

                // Resize if too large
                if (w > maxDimension || h > maxDimension) {
                    const ratio = Math.min(maxDimension / w, maxDimension / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }

                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                canvas.toBlob((compressed) => {
                    if (compressed) {
                        resolve(compressed);
                    } else {
                        reject(new Error('图片压缩失败'));
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = URL.createObjectURL(blob);
        });
    }

    // ─── Capture frame ──────────────────────────────
    async function captureFrame() {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 960;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);

        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
        });
    }

    // ─── UI helpers ─────────────────────────────────
    function showPanel(panel) {
        [inputPanel, resultPanel, listPanel].forEach(p => p.style.display = 'none');
        panel.style.display = 'block';
    }

    function showLoading(show, msg) {
        loading.style.display = show ? 'block' : 'none';
        if (loadingText) loadingText.textContent = msg || '识别中，请稍候...';
        captureBtn.style.display = show ? 'none' : '';
        uploadBtn.style.display = show ? 'none' : '';
        confirmBtn.style.display = show ? 'none' : '';
        retakeBtn.style.display = show ? 'none' : '';
    }

    function showError(msg) {
        // Remove existing error banner if any
        const existing = document.querySelector('.error-toast');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.className = 'error-toast';
        div.textContent = msg;
        div.style.cssText =
            'position:fixed;bottom:80px;left:16px;right:16px;z-index:999;' +
            'background:#dc2626;color:#fff;padding:14px 16px;border-radius:10px;' +
            'font-size:14px;line-height:1.5;box-shadow:0 4px 12px rgba(0,0,0,.3);' +
            'animation:fadeIn .3s ease';
        document.body.appendChild(div);
        setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity .3s'; }, 5000);
        setTimeout(() => div.remove(), 5500);
    }

    function showPreview(blob) {
        const url = URL.createObjectURL(blob);
        preview.src = url;
        previewArea.style.display = 'block';
        cameraView.style.display = 'none';
        cameraOverlay.style.display = 'none';
        captureBtn.style.display = 'none';
        uploadBtn.style.display = 'none';
        retakeBtn.style.display = '';
        confirmBtn.style.display = '';
        confirmBtn.textContent = '✨ 开始识别';
        confirmBtn.disabled = false;
        capturedBlob = blob;
    }

    function resetCamera() {
        previewArea.style.display = 'none';
        cameraView.style.display = 'block';
        cameraOverlay.style.display = 'flex';
        captureBtn.style.display = '';
        uploadBtn.style.display = '';
        retakeBtn.style.display = 'none';
        confirmBtn.style.display = 'none';
        confirmBtn.disabled = false;
        capturedBlob = null;
        lastResult = null;
        // Clean up preview URL
        if (preview.src) URL.revokeObjectURL(preview.src);
    }

    function setConfidence(score) {
        const pct = (score * 100).toFixed(1);
        confidenceBadge.textContent = pct + '%';
        confidenceBadge.className = 'badge ' + (
            score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low'
        );
    }

    function showResult(data) {
        lastResult = data;
        formattedText.textContent = data.formatted || data.raw_text || '(无识别结果)';
        rawText.textContent = data.raw_text || '(无识别结果)';
        resultImage.src = data.image_url || '';
        setConfidence(data.confidence || 0);
        showPanel(resultPanel);
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        const defaultTab = document.querySelector('.tab[data-tab="formatted"]');
        if (defaultTab) {
            defaultTab.classList.add('active');
            document.getElementById('tabFormatted').classList.add('active');
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ─── Tab switching ──────────────────────────────
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            const target = document.getElementById('tab' +
                tabName.charAt(0).toUpperCase() + tabName.slice(1));
            if (target) target.classList.add('active');
        });
    });

    // ─── OCR API call ───────────────────────────────
    async function sendOcr(blob) {
        // Compress image first (critical for mobile photos)
        showLoading(true, '压缩图片中...');
        let compressed;
        try {
            compressed = await compressImage(blob, 1280, 0.85);
        } catch (e) {
            showError('图片处理失败: ' + e.message);
            showLoading(false);
            return;
        }

        const form = new FormData();
        form.append('image', compressed, 'handwriting.jpg');
        form.append('lang', 'ch');

        showLoading(true, '识别中，请稍候...');
        try {
            const res = await fetch('/api/ocr', {
                method: 'POST',
                body: form,
            });

            // Try to parse response as JSON
            let data;
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                data = await res.json();
            } else {
                const text = await res.text();
                throw new Error('服务器返回异常: HTTP ' + res.status + ' - ' + text.slice(0, 200));
            }

            if (!res.ok) {
                throw new Error(data.error || '服务器错误 (HTTP ' + res.status + ')');
            }

            if (!data.raw_text && (!data.lines || data.lines.length === 0)) {
                throw new Error('未能识别出文字，请确认图片中有清晰的手写内容');
            }

            showResult(data);
        } catch (err) {
            if (err.name === 'TypeError' && err.message.includes('fetch')) {
                showError('网络连接失败，请确认服务器地址是否正确');
            } else {
                showError('识别失败: ' + err.message);
            }
        } finally {
            showLoading(false);
        }
    }

    // ─── Event: Capture ─────────────────────────────
    captureBtn.addEventListener('click', async () => {
        if (!stream) {
            await startCamera();
            if (!stream) return;
        }
        try {
            const blob = await captureFrame();
            showPreview(blob);
        } catch (err) {
            showError('拍照失败: ' + err.message);
        }
    });

    // ─── Event: Upload ──────────────────────────────
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
            showError('不支持的图片格式，请选择 JPG/PNG/WebP');
            return;
        }
        showPreview(file);
        fileInput.value = '';
    });

    // ─── Event: Retake / Confirm ────────────────────
    retakeBtn.addEventListener('click', () => {
        resetCamera();
        if (!stream) startCamera();
    });

    confirmBtn.addEventListener('click', () => {
        if (capturedBlob) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '识别中...';
            sendOcr(capturedBlob);
        }
    });

    // ─── Event: Save ────────────────────────────────
    saveBtn.addEventListener('click', () => {
        if (!lastResult) return;
        alert('✅ 已保存到历史记录');
        loadNotes();
    });

    // ─── Event: Copy ────────────────────────────────
    copyBtn.addEventListener('click', () => {
        const text = formattedText.textContent;
        if (!text || text === '(无识别结果)') {
            showError('没有可复制的内容');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                alert('📋 已复制到剪贴板');
            }).catch(() => {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    });

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); alert('📋 已复制到剪贴板'); }
        catch (e) { showError('复制失败，请手动复制'); }
        document.body.removeChild(ta);
    }

    // ─── Event: New ─────────────────────────────────
    newBtn.addEventListener('click', () => {
        lastResult = null;
        showPanel(inputPanel);
        resetCamera();
    });

    // ─── View toggle ────────────────────────────────
    toggleViewBtn.addEventListener('click', () => {
        if (currentView === 'input') {
            currentView = 'list';
            showPanel(listPanel);
            loadNotes();
        } else {
            currentView = 'input';
            showPanel(inputPanel);
        }
    });

    // ─── Notes list ─────────────────────────────────
    async function loadNotes(query) {
        let url = '/api/notes';
        if (query) url += '?q=' + encodeURIComponent(query);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            renderNotes(data.notes);
        } catch (err) {
            notesList.innerHTML = '<div class="empty-state">加载失败，请检查网络</div>';
        }
    }

    function renderNotes(notes) {
        if (!notes || notes.length === 0) {
            notesList.innerHTML = '<div class="empty-state">暂无记录</div>';
            return;
        }
        notesList.innerHTML = notes.map(n => `
            <div class="note-card" data-id="${n.id}">
                <div class="note-card-title">${escapeHtml(n.title || '无标题')}</div>
                <div class="note-card-preview">${escapeHtml((n.raw_text || '').slice(0, 80))}</div>
                <div class="note-card-meta">${n.created_at || ''}</div>
            </div>
        `).join('');

        notesList.querySelectorAll('.note-card').forEach(card => {
            card.addEventListener('click', () => openNote(parseInt(card.dataset.id)));
        });
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    // ─── Search ─────────────────────────────────────
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            loadNotes(searchInput.value.trim());
        }, 300);
    });

    // ─── Note detail modal ──────────────────────────
    async function openNote(id) {
        try {
            const res = await fetch('/api/notes/' + id);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const note = await res.json();
            modalTitle.textContent = note.title || '无标题';
            modalBody.innerHTML = `
                <div style="margin-bottom:12px;color:var(--gray-500);font-size:13px">${note.created_at || ''}</div>
                <div style="font-size:15px;line-height:1.8;white-space:pre-wrap">${escapeHtml(note.formatted || note.raw_text || '')}</div>
                ${note.image_url ? `<img src="${note.image_url}" style="width:100%;border-radius:8px;margin-top:12px">` : ''}
            `;
            detailModal.style.display = 'flex';
            detailModal.dataset.noteId = id;
            detailModal.dataset.note = JSON.stringify(note);
        } catch (err) {
            showError('加载记录失败');
        }
    }

    closeModal.addEventListener('click', () => {
        detailModal.style.display = 'none';
    });
    detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) detailModal.style.display = 'none';
    });

    // ─── Modal: Edit ────────────────────────────────
    modalEditBtn.addEventListener('click', () => {
        const note = JSON.parse(detailModal.dataset.note);
        modalBody.innerHTML = `
            <input class="edit-title-input" id="editTitle" value="${escapeHtml(note.title || '')}">
            <textarea class="edit-content-textarea" id="editContent">${escapeHtml(note.formatted || note.raw_text || '')}</textarea>
        `;
        modalEditBtn.textContent = '💾 保存修改';
        modalEditBtn.onclick = async () => {
            const title = document.getElementById('editTitle').value;
            const formatted = document.getElementById('editContent').value;
            try {
                const r = await fetch('/api/notes/' + note.id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, formatted }),
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                alert('✅ 已更新');
                detailModal.style.display = 'none';
                loadNotes();
            } catch (err) {
                showError('更新失败: ' + err.message);
            }
            modalEditBtn.textContent = '✏️ 编辑';
            modalEditBtn.onclick = null;
        };
    });

    // ─── Modal: Delete ──────────────────────────────
    modalDeleteBtn.addEventListener('click', async () => {
        if (!confirm('确定要删除这条记录吗？')) return;
        const id = detailModal.dataset.noteId;
        try {
            const r = await fetch('/api/notes/' + id, { method: 'DELETE' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            detailModal.style.display = 'none';
            loadNotes();
        } catch (err) {
            showError('删除失败');
        }
    });

    // ─── Init ───────────────────────────────────────
    // Delay camera start to avoid autoplay issues on mobile
    setTimeout(() => startCamera(), 500);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !stream && currentView === 'input') {
            startCamera();
        }
    });

    // Inject fadeIn animation
    const style = document.createElement('style');
    style.textContent = '@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }';
    document.head.appendChild(style);

})();
