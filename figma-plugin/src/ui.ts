// UI плагина: работает в iframe — есть DOM, createImageBitmap, Canvas.
// Здесь происходит декодирование PNG-кадров, ресэмплинг, кодирование GIF (gif-encoder.ts)
// и предпросмотр анимации. Общение с sandbox — через parent.postMessage / onmessage.

import { encodeGif, type RgbaFrame } from './gif-encoder';

type FrameMeta = { index: number; name: string; width: number; height: number; bytes: number };
type ReadyFrame = { meta: FrameMeta; buffer: number[] };

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const scanBtn = el<HTMLButtonElement>('scan');
const encodeBtn = el<HTMLButtonElement>('encode');
const cancelBtn = el<HTMLButtonElement>('cancel');
const downloadBtn = el<HTMLAnchorElement>('download');
const insertBtn = el<HTMLButtonElement>('insert');
const statusEl = el<HTMLDivElement>('status');
const progressWrap = el<HTMLDivElement>('progress-wrap');
const progressBar = el<HTMLDivElement>('progress-bar');
const canvasEl = el<HTMLCanvasElement>('preview');
const infoEl = el<HTMLDivElement>('info');
const delayInput = el<HTMLInputElement>('delay');
const scaleInput = el<HTMLInputElement>('scale');
const qualityInput = el<HTMLInputElement>('quality');
const fpsRow = el<HTMLDivElement>('fps-row');

let frames: ReadyFrame[] = [];
let rgbaFrames: RgbaFrame[] = [];
let gifBytes: Uint8Array | null = null;
let gifUrl = '';
let encoding = false;

function setStatus(text: string, kind: 'info' | 'warn' | 'error' | 'ok' = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function setProgress(value: number | null) {
  if (value === null) { progressWrap.style.display = 'none'; return; }
  progressWrap.style.display = 'block';
  progressBar.style.width = `${Math.round(value)}%`;
}

function sendToPlugin(message: Record<string, unknown>) {
  parent.postMessage({ pluginMessage: message }, '*');
}

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage;
  if (!msg) return;
  switch (msg.type) {
    case 'selection':
      scanBtn.disabled = msg.count === 0;
      el('selection-count').textContent = msg.count
        ? `Выделено: ${msg.count}${msg.names?.length ? ` (${msg.names.join(', ')})` : ''}`
        : 'Ничего не выделено';
      break;
    case 'export-progress':
      setStatus(`Экспорт кадров из Figma: ${msg.index + 1}/${msg.total}…`, 'info');
      setProgress(((msg.index + 1) / msg.total) * 40);
      break;
    case 'frames-ready':
      frames = msg.frames;
      setStatus(`${frames.length} кадр(ов) получено. Декодирую…`, 'info');
      void prepareFrames();
      break;
    case 'warning':
      setStatus(msg.text, 'warn');
      break;
    case 'error':
      setStatus(msg.text, 'error');
      setProgress(null);
      break;
    case 'inserted':
      setStatus('GIF вставлен на страницу как изображение.', 'ok');
      break;
  }
};

async function prepareFrames() {
  try {
    rgbaFrames = [];
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i];
      const blob = new Blob([(new Uint8Array(f.buffer)).buffer as ArrayBuffer], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Нет 2D-контекста');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      rgbaFrames.push({ data: imageData.data, width: canvas.width, height: canvas.height });
      setProgress(40 + ((i + 1) / frames.length) * 20);
    }
    setProgress(null);
    encodeBtn.disabled = false;
    drawFirstFrame();
    setStatus(`Готово: ${rgbaFrames[0].width}×${rgbaFrames[0].height}, ${rgbaFrames.length} кадр(ов). Настройте параметры и жмите «Собрать GIF».`, 'ok');
  } catch (error) {
    setStatus(`Ошибка декодирования: ${error instanceof Error ? error.message : String(error)}`, 'error');
    setProgress(null);
  }
}

function drawFirstFrame() {
  const frame = rgbaFrames[0];
  if (!frame) return;
  canvasEl.width = frame.width;
  canvasEl.height = frame.height;
  const ctx = canvasEl.getContext('2d');
  ctx?.putImageData(new ImageData(cloneClamped(frame.data), frame.width, frame.height), 0, 0);
}

function cloneClamped(data: Uint8ClampedArray) {
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  return copy;
}

function resample(framesSource: RgbaFrame[], width: number, height: number): RgbaFrame[] {
  if (framesSource.every((f) => f.width === width && f.height === height)) return framesSource;
  return framesSource.map((source) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Нет 2D-контекста');
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = source.width;
    sourceCanvas.height = source.height;
    sourceCanvas.getContext('2d')?.putImageData(new ImageData(cloneClamped(source.data), source.width, source.height), 0, 0);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    return { data: image.data, width, height };
  });
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function startEncode() {
  if (encoding || !rgbaFrames.length) return;
  encoding = true;
  encodeBtn.disabled = true;
  cancelBtn.style.display = 'inline-block';
  gifBytes = null;
  downloadBtn.style.display = 'none';
  insertBtn.style.display = 'none';

  const delay = Math.max(10, Math.min(30000, Number(delayInput.value) || 100));
  const scale = Math.max(0.1, Math.min(4, Number(scaleInput.value) || 1));
  const quality = Math.max(1, Math.min(100, Number(qualityInput.value) || 90));
  const targetWidth = Math.max(1, Math.round(rgbaFrames[0].width * scale));
  const targetHeight = Math.max(1, Math.round(rgbaFrames[0].height * scale));

  try {
    setStatus('Привожу кадры к одному размеру…', 'info');
    const scaled = resample(rgbaFrames, targetWidth, targetHeight);
    setStatus('Кодирую GIF…', 'info');
    // Кодирование синхронное, но разбиваем по кадрам через setTimeout, чтобы UI не зависал намертво
    const result = await encodeGifChunked(scaled, delay, quality);
    gifBytes = result.bytes;
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    gifUrl = URL.createObjectURL(new Blob([(result.bytes.slice().buffer) as ArrayBuffer], { type: 'image/gif' }));
    // Предпросмотр: картинка-gif анимируется сама
    const img = new Image();
    img.onload = () => {
      canvasEl.width = img.naturalWidth;
      canvasEl.height = img.naturalHeight;
      const ctx = canvasEl.getContext('2d');
      if (ctx) { ctx.clearRect(0, 0, canvasEl.width, canvasEl.height); ctx.drawImage(img, 0, 0); }
      // Перерисовываем каждые N мс, чтобы гиф «прокручивался» (blob-URL гифа анимируется в <img>, но не в drawImage)
      startPreviewLoop(result.bytes, img);
    };
    img.src = gifUrl;
    canvasEl.style.display = 'block';

    const size = formatBytes(result.bytes.length);
    infoEl.textContent = `${targetWidth}×${targetHeight} · ${scaled.length} кадров · ${delay} мс (${Math.round(1000 / delay)} fps) · ${size}`;
    downloadBtn.href = gifUrl;
    downloadBtn.download = `figma-animation-${Date.now()}.gif`;
    downloadBtn.style.display = 'inline-block';
    insertBtn.style.display = 'inline-block';
    setStatus(`GIF собран: ${size}. Скачайте или вставьте в документ.`, 'ok');
  } catch (error) {
    setStatus(`Ошибка кодирования: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    encoding = false;
    encodeBtn.disabled = false;
    cancelBtn.style.display = 'none';
    setProgress(null);
  }
}

function encodeGifChunked(scaled: RgbaFrame[], delay: number, quality: number) {
  return new Promise<{ bytes: Uint8Array; width: number; height: number }>((resolve, reject) => {
    let processed = 0;
    const tick = () => {
      try {
        // Кодируем целиком, но прогресс обновляем инкрементально через onProgress
        const result = encodeGif(scaled, { delay, quality, repeat: 0 }, (p) => {
          processed = p;
          setProgress(60 + (p / 100) * 40);
        });
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    setStatus(`Кодирую… (${processed}%)`, 'info');
    setTimeout(tick, 30);
  });
}

let previewTimer = 0;
function startPreviewLoop(bytes: Uint8Array, img: HTMLImageElement) {
  // Простой проигрыватель: парсить GIF покадрово дорого, поэтому показываем статичный
  // первый кадр и перерисовываем из <img>-элемента, добавленного в DOM (он анимируется нативно).
  clearInterval(previewTimer);
  const holder = el<HTMLImageElement>('preview-img');
  holder.src = gifUrl;
  holder.alt = 'Предпросмотр GIF';
  holder.style.display = 'block';
  canvasEl.style.display = 'none';
}

scanBtn.onclick = () => {
  frames = [];
  rgbaFrames = [];
  encodeBtn.disabled = true;
  downloadBtn.style.display = 'none';
  insertBtn.style.display = 'none';
  setProgress(0);
  setStatus('Читаю выделенные кадры из Figma…', 'info');
  sendToPlugin({ type: 'scan', scale: Number(scaleInput.value) || 1 });
};

encodeBtn.onclick = () => void startEncode();

cancelBtn.onclick = () => {
  sendToPlugin({ type: 'cancel' });
  setStatus('Отменено.', 'warn');
  setProgress(null);
};

insertBtn.onclick = () => {
  if (!gifBytes) return;
  const first = rgbaFrames[0];
  const scale = Math.max(0.1, Math.min(4, Number(scaleInput.value) || 1));
  sendToPlugin({
    type: 'insert-result',
    bytes: Array.from(gifBytes),
    name: downloadBtn.download,
    rect: { x: 0, y: 0, width: Math.round(first.width / scale), height: Math.round(first.height / scale) },
  });
};

delayInput.oninput = () => {
  fpsRow.textContent = `≈ ${Math.round(1000 / Math.max(10, Number(delayInput.value) || 100))} fps`;
};

sendToPlugin({ type: 'ready' });
