// UI плагина: работает в iframe — есть DOM, createImageBitmap.
// Принцип batch-сканера сохранён: Scan → список групп → Generate All (очередь) → превью → ZIP.
//
// ДВИЖОК КОДИРОВАНИЯ — ТОЛЬКО gifski (gifski-wasm), как в сервисе «пакетная сборка GIF»
// на сайте https://hallizar.ru (Services → GIF Studio). Сайт открывается в скрытом iframe
// этого UI; кадры PNG и готовые GIF передаются через window.postMessage.
// Локальные кодировщики (gif.js / self-made) удалены: если сайт недоступен, плагин честно
// сообщает об ошибке сети, а не кодирует «чем попало».

import { createZipBlob } from './jszip-lite';

const ENGINE_URL = 'https://hallizar.ru/#services/gif-studio';
const HANDSHAKE_TIMEOUT_MS = 20000;
const ENCODE_TIMEOUT_MS = 120000;

type GroupFrame = { id: string; name: string };
type ScannedGroup = { id: string; name: string; info: string; frames: GroupFrame[] };
type RenderedFrame = { index: number; name: string; bytes: Uint8Array };
type GeneratedGif = { bytes: Uint8Array; filename: string; url: string; size: number };

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const scanBtn = el<HTMLButtonElement>('scan-btn');
const generateAllBtn = el<HTMLButtonElement>('generate-all');
const downloadAllBtn = el<HTMLButtonElement>('download-all');
const listContainer = el<HTMLDivElement>('group-list');
const statusEl = el<HTMLDivElement>('status');

// Settings
const delayInput = el<HTMLInputElement>('delay');
const scaleSelect = el<HTMLSelectElement>('scale');
const qualityInput = el<HTMLInputElement>('quality');
const qualityDisplay = el<HTMLSpanElement>('quality-val');

// State
let scannedGroups: ScannedGroup[] = [];
const generatedGifs: Record<string, GeneratedGif> = {};
let batchQueue: string[] = [];
let isBatchProcessing = false;

// --- SETTINGS LOGIC ---
qualityInput.addEventListener('input', () => {
  qualityDisplay.textContent = qualityInput.value;
  void engineSendSettings();
});

function currentSettings() {
  return {
    delay: Math.max(20, parseInt(delayInput.value, 10) || 2500),
    quality: Math.min(100, Math.max(1, parseInt(qualityInput.value, 10) || 90)),
    repeat: 0, // бесконечная прокрутка
    colorLock: false,
    targetColor: '#FFFFFF',
  };
}

// --- GIFSKI ENGINE (iframe сайта hallizar.ru) ---
type PendingEncode = {
  resolve: (r: { bytes: Uint8Array; fileName: string }) => void;
  reject: (e: Error) => void;
  timer: number;
};

let engineFrame: HTMLIFrameElement | null = null;
let engineReady = false;
let engineReadyPromise: Promise<void> | null = null;
let handshakeTimer = 0;
const pendingEncodes = new Map<string, PendingEncode>();

function setStatus(text: string) {
  statusEl.textContent = text;
}

function engineLoad(): Promise<void> {
  if (engineReady) return Promise.resolve();
  if (engineReadyPromise) return engineReadyPromise;

  engineReadyPromise = new Promise<void>((resolve, reject) => {
    engineFrame = document.createElement('iframe');
    engineFrame.src = ENGINE_URL;
    // Скрытый фрейм: сайт нужен только как вычислительный движок gifski
    engineFrame.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:0;visibility:hidden;';
    engineFrame.setAttribute('aria-hidden', 'true');

    handshakeTimer = window.setTimeout(() => {
      engineReadyPromise = null;
      reject(new Error('Сайт hallizar.ru не ответил за 20 с. Проверьте интернет и доступность сайта.'));
    }, HANDSHAKE_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.pluginMode !== true) return;

      if (data.type === 'plugin-ready') {
        clearTimeout(handshakeTimer);
        window.removeEventListener('message', onMessage);
        engineFrame?.removeEventListener('load', onLoadError);
        engineReady = true;
        setStatus('Движок gifski подключён (hallizar.ru).');
        void engineSendSettings();
        resolve();
        return;
      }

      if (data.type === 'gif-result' || data.type === 'gif-error') {
        const groupId = String(data.groupId ?? '');
        const pending = pendingEncodes.get(groupId);
        if (!pending) return;
        pendingEncodes.delete(groupId);
        clearTimeout(pending.timer);
        if (data.type === 'gif-result') {
          const bytes = data.bytes instanceof Uint8Array
            ? data.bytes
            : new Uint8Array(data.bytes as number[]);
          pending.resolve({ bytes, fileName: String(data.fileName ?? `${groupId}.gif`) });
        } else {
          pending.reject(new Error(String(data.message ?? 'Ошибка кодирования')));
        }
      }
    };

    const onLoadError = () => {
      clearTimeout(handshakeTimer);
      window.removeEventListener('message', onMessage);
      engineReadyPromise = null;
      reject(new Error('Не удалось загрузить hallizar.ru (нет сети или сайт заблокирован networkAccess).'));
    };

    window.addEventListener('message', onMessage);
    engineFrame.addEventListener('error', onLoadError);
    document.body.appendChild(engineFrame);
  });

  return engineReadyPromise;
}

async function engineSendSettings() {
  if (!engineFrame || !engineReady) return;
  try {
    engineFrame.contentWindow?.postMessage(
      { type: 'settings', payload: currentSettings() },
      'https://hallizar.ru',
    );
  } catch {
    /* настройки улетят вместе с следующим encode-batch */
  }
}

function encodeWithGifski(groupId: string, jobsFrames: { name: string; bytes: Uint8Array }[]): Promise<{ bytes: Uint8Array; fileName: string }> {
  return engineLoad().then(
    () =>
      new Promise((resolve, reject) => {
        const frameWin = engineFrame?.contentWindow;
        if (!frameWin) {
          reject(new Error('Движок не готов.'));
          return;
        }
        const timer = window.setTimeout(() => {
          pendingEncodes.delete(groupId);
          reject(new Error('Кодирование заняло слишком долго (>2 мин). Попробуйте уменьшить разрешение или число кадров.'));
        }, ENCODE_TIMEOUT_MS);
        pendingEncodes.set(groupId, { resolve, reject, timer });
        frameWin.postMessage(
          { type: 'encode-batch', payload: { jobs: [{ groupId, frames: jobsFrames }] } },
          'https://hallizar.ru',
        );
      }),
  );
}

// --- NAMING LOGIC (как в эталонном batch-сканере) ---
function generateFilename(groupId: string, scale: number): string {
  const separator = '::';
  const lastIdx = groupId.lastIndexOf(separator);
  const name = lastIdx >= 0 ? groupId.substring(0, lastIdx) : groupId;
  const dims = lastIdx >= 0 ? groupId.substring(lastIdx + 2) : '';
  const [w, h] = dims.split('x').map(Number);
  const safeName = name.replace(/[:\/\\*?"<>|]/g, '_').trim() || 'sequence';

  if (scale === 1) {
    return `${w}x${h}_${safeName}.gif`;
  }
  const scaledW = Math.round(w * scale);
  const scaledH = Math.round(h * scale);
  return `${w}x${h}(x1)__${scaledW}x${scaledH}(x${scale})_${safeName}.gif`;
}

// --- MAIN ACTIONS ---
scanBtn.onclick = () => {
  parent.postMessage({ pluginMessage: { type: 'scan-layers' } }, '*');
  listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Scanning layers...</div>';
  for (const g of Object.values(generatedGifs)) URL.revokeObjectURL(g.url);
  Object.keys(generatedGifs).forEach((k) => delete generatedGifs[k]);
  scannedGroups = [];
  updateButtons();
};

// --- BATCH GENERATION QUEUE ---
generateAllBtn.onclick = () => {
  if (scannedGroups.length === 0) return;

  batchQueue = scannedGroups.map((g) => g.id);
  isBatchProcessing = true;

  generateAllBtn.disabled = true;
  generateAllBtn.textContent = 'Processing Queue...';
  scanBtn.disabled = true;

  processNextInQueue();
};

function processNextInQueue() {
  if (batchQueue.length === 0) {
    isBatchProcessing = false;
    generateAllBtn.textContent = 'All Done!';
    setTimeout(() => {
      generateAllBtn.disabled = false;
      generateAllBtn.textContent = '▶ Generate All GIFs';
      scanBtn.disabled = false;
    }, 1500);
    return;
  }

  const nextId = batchQueue.shift() as string;
  if (generatedGifs[nextId]) {
    processNextInQueue();
    return;
  }
  triggerGeneration(nextId);
}

function setBadge(groupId: string, cls: string, text: string) {
  const badge = document.querySelector(`.group-item[data-id="${CSS.escape(groupId)}"] .status-badge`);
  if (badge) {
    badge.className = `status-badge ${cls}`;
    badge.textContent = text;
  }
}

function triggerGeneration(groupId: string) {
  const group = scannedGroups.find((g) => g.id === groupId);
  if (!group) return;

  setBadge(groupId, 'loading', 'Rendering frames...');
  parent.postMessage(
    {
      pluginMessage: {
        type: 'render-group',
        groupId: group.id,
        frameIds: group.frames.map((f) => f.id),
        settingScale: parseFloat(scaleSelect.value) || 1,
      },
    },
    '*',
  );
}

async function handleRenderData(msg: { groupId: string; framesData: RenderedFrame[] }) {
  const groupId = msg.groupId;
  const scale = parseFloat(scaleSelect.value) || 1;
  const frames = [...msg.framesData].sort((a, b) => a.index - b.index);

  setBadge(groupId, 'loading', 'Encoding with gifski...');
  setStatus('Кодирование через gifski (hallizar.ru)...');

  try {
    const result = await encodeWithGifski(
      groupId,
      frames.map((f) => ({ name: f.name.endsWith('.png') ? f.name : `${f.name}.png`, bytes: f.bytes })),
    );
    displayPreview(groupId, result.bytes, scale, result.fileName);
    setStatus('Готово.');
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    setBadge(groupId, '', 'Error');
    setStatus(`Ошибка gifski: ${text}`);
  }

  if (isBatchProcessing) processNextInQueue();
}

// --- MESSAGE HANDLER (sandbox → UI) ---
window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage;
  if (!msg) return;

  if (msg.type === 'scan-result') {
    renderGroups(msg.data as ScannedGroup[]);
  } else if (msg.type === 'render-data') {
    void handleRenderData(msg);
  } else if (msg.type === 'render-progress') {
    setStatus(`Рендер кадра ${Number(msg.index) + 1} из ${msg.total}...`);
  } else if (msg.type === 'error' || msg.type === 'warning') {
    setStatus(`${msg.type === 'error' ? 'Ошибка' : 'Внимание'}: ${msg.text}`);
  }
};

function renderGroups(groups: ScannedGroup[]) {
  scannedGroups = groups;
  listContainer.innerHTML = '';

  if (groups.length === 0) {
    listContainer.innerHTML =
      '<div style="text-align:center; color:#999; margin-top: 20px;">No grouped frames found.</div>';
    generateAllBtn.disabled = true;
    return;
  }

  groups.forEach((group) => {
    const item = document.createElement('div');
    item.className = 'group-item';
    item.dataset.id = group.id;
    const frameNames = group.frames.map((f) => f.name).join('\n');

    item.innerHTML = `
      <div class="group-header">
        <div>
          <span class="group-title"></span>
          <span class="status-badge"></span>
          <div class="group-meta"></div>
        </div>
        <button class="secondary" style="width:auto; padding: 6px 10px; font-size:10px;">Toggle</button>
      </div>
      <div class="group-content">
        <label style="font-size:10px; margin-bottom:4px;">Frames:</label>
        <div style="max-height:60px; overflow-y:auto; font-size:10px; color:#666; background:rgba(128,128,128,.08); padding:4px; margin-bottom:8px; white-space:pre-wrap;"></div>
        <div class="action-row">
          <button class="generate-btn">Create GIF</button>
        </div>
        <div class="preview-area" style="display:none;"></div>
      </div>
    `;

    item.querySelector('.group-title')!.textContent = group.name;
    item.querySelector('.group-meta')!.textContent = `${group.info} • ${group.frames.length} frames`;
    item.querySelector('.group-content > div:nth-of-type(2)')!.textContent = frameNames;

    const content = item.querySelector('.group-content') as HTMLElement;
    const toggle = () => content.classList.toggle('open');
    (item.querySelector('.group-header') as HTMLElement).onclick = (e) => {
      if ((e.target as HTMLElement).tagName !== 'BUTTON') toggle();
    };
    (item.querySelector('.group-header button') as HTMLElement).onclick = toggle;
    (item.querySelector('.generate-btn') as HTMLButtonElement).onclick = () => triggerGeneration(group.id);

    listContainer.appendChild(item);
  });
  generateAllBtn.disabled = false;
}

// --- PREVIEW ---
function displayPreview(groupId: string, bytes: Uint8Array, usedScale: number, serverFileName?: string) {
  const groupEl = document.querySelector(`.group-item[data-id="${CSS.escape(groupId)}"]`);
  if (!groupEl) return;

  const previewArea = groupEl.querySelector('.preview-area') as HTMLElement;
  const genBtn = groupEl.querySelector('.generate-btn') as HTMLButtonElement;
  const badge = groupEl.querySelector('.status-badge') as HTMLElement;

  const filename = serverFileName || generateFilename(groupId, usedScale);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'image/gif',
  });
  const url = URL.createObjectURL(blob);
  const sizeKB = (blob.size / 1024).toFixed(1);

  previewArea.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'preview-img';
  img.src = url;
  previewArea.appendChild(img);

  const info = document.createElement('div');
  info.style.cssText = 'font-size:10px; color:#888; margin-bottom:5px; text-align:center;';
  info.innerHTML = `Size: ${sizeKB} KB<br>`;
  const fname = document.createElement('span');
  fname.style.cssText = 'font-size:9px; color:#aaa; word-break:break-all;';
  fname.textContent = filename;
  info.appendChild(fname);
  previewArea.appendChild(info);

  const row = document.createElement('div');
  row.className = 'action-row';
  row.style.width = '100%';
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.cssText = 'text-decoration:none; flex:1;';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'secondary';
  saveBtn.textContent = 'Save GIF';
  link.appendChild(saveBtn);
  row.appendChild(link);
  previewArea.appendChild(row);

  previewArea.style.display = 'flex';
  genBtn.textContent = 'Regenerate';

  if (badge) {
    badge.className = 'status-badge done';
    badge.textContent = 'Done (gifski)';
  }

  generatedGifs[groupId] = { bytes, filename, url, size: blob.size };
  updateButtons();
}

function updateButtons() {
  const count = Object.keys(generatedGifs).length;
  downloadAllBtn.disabled = count === 0;
  downloadAllBtn.textContent = count > 0 ? `Download All (${count}) as ZIP` : 'Download ZIP';
}

// --- ZIP (собирается локально, без внешних библиотек) ---
downloadAllBtn.onclick = async () => {
  const entries = Object.values(generatedGifs).map((g) => ({ name: g.filename, data: g.bytes }));
  if (!entries.length) return;
  const blob = createZipBlob(entries);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gifs_bundle.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

// Подключаем движок заранее, чтобы первый запуск не ждал handshake
void engineLoad().catch((error) => {
  setStatus(`Движок пока недоступен: ${error instanceof Error ? error.message : error}`);
});
