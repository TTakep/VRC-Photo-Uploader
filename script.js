// --- Elements ---
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const webhookInput = document.getElementById('webhookUrl');
const threadIdInput = document.getElementById('threadId');
const maxSizeInput = document.getElementById('maxFileSize');
const themeSelector = document.getElementById('themeSelector');
const logArea = document.getElementById('logArea');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// --- State ---
let uploadQueue = [];
let totalFilesToProcess = 0;
let processedFilesCount = 0;
let isProcessing = false;

// --- Initialization ---
window.addEventListener('load', () => {
    // Load Settings
    const savedUrl = localStorage.getItem('vrc_discord_webhook');
    if (savedUrl) webhookInput.value = savedUrl;
    
    const savedThread = localStorage.getItem('vrc_discord_thread_id');
    if (savedThread) threadIdInput.value = savedThread;

    const savedSize = localStorage.getItem('vrc_max_file_size');
    if (savedSize) maxSizeInput.value = savedSize;

    // Load Theme
    const savedTheme = localStorage.getItem('vrc_theme_preference') || 'system';
    themeSelector.value = savedTheme;
    applyTheme(savedTheme);
});

// --- Event Listeners for Settings ---
webhookInput.addEventListener('change', () => localStorage.setItem('vrc_discord_webhook', webhookInput.value.trim()));
threadIdInput.addEventListener('change', () => localStorage.setItem('vrc_discord_thread_id', threadIdInput.value.trim()));
maxSizeInput.addEventListener('change', () => localStorage.setItem('vrc_max_file_size', maxSizeInput.value));

// --- Theme Logic ---
themeSelector.addEventListener('change', (e) => {
    const selected = e.target.value;
    localStorage.setItem('vrc_theme_preference', selected);
    applyTheme(selected);
});

// Watch for system changes if mode is 'system'
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeSelector.value === 'system') {
        applyTheme('system');
    }
});

function applyTheme(mode) {
    let targetTheme = mode;
    if (mode === 'system') {
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        targetTheme = isSystemDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', targetTheme);
}

// --- Drag & Drop Handlers ---
dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = ''; 
});

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    handleFiles(dt.files);
});

// --- Main Logic ---

function handleFiles(files) {
    if (!webhookInput.value) {
        alert('先にWebhook URLを設定してください。');
        return;
    }

    const fileArray = Array.from(files).filter(file => file.type.startsWith('image/'));
    const total = fileArray.length;
    
    if (total === 0) {
        addLog('画像ファイルが選択されていません。', '#ff5555');
        return;
    }

    addLog(`--- ${total}枚の画像を受け付けました ---`, 'var(--accent)');

    fileArray.forEach(file => uploadQueue.push(file));
    totalFilesToProcess += total;

    if (!isProcessing) {
        processQueue();
    }
}

async function processQueue() {
    if (uploadQueue.length === 0) {
        isProcessing = false;
        totalFilesToProcess = 0;
        processedFilesCount = 0;
        updateProgress(0);
        addLog('すべての処理が完了しました。', '#4caf50');
        return;
    }

    isProcessing = true;
    const file = uploadQueue.shift();
    
    // Progress update (Start of file)
    let currentPercent = 0;
    if (totalFilesToProcess > 0) {
         currentPercent = Math.round((processedFilesCount / totalFilesToProcess) * 100);
    }
    updateProgress(currentPercent);

    try {
        await processAndUpload(file);
    } catch (error) {
        addLog(`エラー: ${file.name} - ${error.message}`, '#ff5555');
    } finally {
        processedFilesCount++;
        const finalPercent = Math.round((processedFilesCount / totalFilesToProcess) * 100);
        updateProgress(finalPercent);
    }

    // Wait to avoid rate limits (Default 1s)
    await new Promise(r => setTimeout(r, 1000));
    processQueue();
}

async function processAndUpload(file) {
    const maxBytes = maxSizeInput.value * 1024 * 1024;
    let fileToSend = file;
    
    addLog(`処理中: ${file.name}`, 'var(--text-muted)');

    if (file.size > maxBytes) {
        addLog(`サイズ調整中 (${(file.size/1024/1024).toFixed(1)}MB -> ${maxSizeInput.value}MB以下)`, '#ffa500');
        try {
            fileToSend = await resizeImageToFit(file, maxBytes);
        } catch (e) {
            throw new Error('リサイズ失敗: ' + e);
        }
    }

    await uploadToDiscord(fileToSend, file.name);
}

function resizeImageToFit(file, maxBytes) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
            let canvas = document.createElement('canvas');
            let ctx = canvas.getContext('2d');
            
            let width = img.width;
            let height = img.height;
            let scale = (file.size > maxBytes * 2) ? 0.75 : 0.9;
            let blob = null;
            let attempts = 0;

            do {
                if (attempts > 0) {
                    width = Math.floor(width * scale);
                    height = Math.floor(height * scale);
                    if (attempts > 5) scale = 0.8;
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                const mimeType = 'image/png'; // Always PNG
                blob = await new Promise(r => canvas.toBlob(r, mimeType));
                attempts++;
                
                if (attempts > 20 || width < 100) break;

            } while (blob.size > maxBytes);

            if (blob.size > maxBytes) {
                reject('目標サイズに収まりませんでした。');
            } else {
                const newFile = new File([blob], file.name, { type: blob.type });
                resolve(newFile);
            }
            canvas = null;
        };
        img.onerror = () => reject('画像読込エラー');
        
        const objectUrl = URL.createObjectURL(file);
        img.src = objectUrl;
        img.onloadend = () => URL.revokeObjectURL(objectUrl);
    });
}

function uploadToDiscord(file, originalName, retryCount = 0) {
    return new Promise((resolve, reject) => {
        if (retryCount > 5) {
            reject('リトライ上限到達');
            return;
        }

        const formData = new FormData();
        formData.append('file', file, originalName);

        const xhr = new XMLHttpRequest();
        
        // Construct URL with Thread ID
        let url = webhookInput.value.trim();
        const threadId = threadIdInput.value.trim();
        if (threadId) {
            // Check if URL already has params
            const separator = url.includes('?') ? '&' : '?';
            url += `${separator}thread_id=${encodeURIComponent(threadId)}`;
        }

        xhr.open('POST', url);

        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                addLog(`送信完了: ${originalName} ✅`, '#4caf50');
                resolve();
            } else if (xhr.status === 429) {
                let retryAfter = 5;
                try {
                    const res = JSON.parse(xhr.responseText);
                    retryAfter = res.retry_after || 5;
                    if (retryAfter > 100) retryAfter /= 1000; // ms to sec
                } catch(e){}
                
                addLog(`制限待ち: ${retryAfter.toFixed(1)}秒後に再試行...`, '#ffa500');
                setTimeout(() => {
                    uploadToDiscord(file, originalName, retryCount + 1).then(resolve).catch(reject);
                }, (retryAfter * 1000) + 500);

            } else {
                reject(`HTTP ${xhr.status}`);
            }
        };

        xhr.onerror = () => reject('ネットワークエラー');
        xhr.send(formData);
    });
}

// --- UI Helpers (Safe XSS) ---
function addLog(text, color) {
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const timeSpan = document.createElement('span');
    timeSpan.textContent = `[${time}] `;
    timeSpan.style.color = 'var(--text-muted)';
    timeSpan.style.fontSize = '0.8em';

    const messageNode = document.createTextNode(text);
    
    div.appendChild(timeSpan);
    div.appendChild(messageNode);
    
    if (color) {
        if (color.startsWith('var')) {
            div.style.color = color;
        } else {
            div.style.color = color;
        }
    } else {
        div.style.color = 'var(--text-primary)';
    }

    logArea.appendChild(div);
    logArea.scrollTo({ top: logArea.scrollHeight, behavior: 'smooth' });
}

function updateProgress(percent) {
    progressBar.style.width = percent + '%';
    progressText.textContent = percent + '%';
}

document.getElementById('clearLog').addEventListener('click', () => {
    logArea.innerHTML = '';
    updateProgress(0);
});
