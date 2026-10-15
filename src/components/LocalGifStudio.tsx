import { useEffect, useMemo, useRef, useState } from 'react';
import gifskiEncode from 'gifski-wasm';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileImage,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type Frame = {
  id: string;
  file: File;
  name: string;
  number: number | null;
  groupKey: string;
  width: number;
  height: number;
  previewUrl: string;
};

type GifResult = {
  url: string;
  bytes: Uint8Array;
  name: string;
  width: number;
  height: number;
};

type Group = {
  id: string;
  key: string;
  frames: Frame[];
};

type RgbaFrame = { data: Uint8ClampedArray; width: number; height: number };

type RenderSettings = {
  delay: number;
  scale: number;
  quality: number;
  repeat: number;
  colorLock: boolean;
  targetColor: string;
};

const NUMBER_PATTERN = /(?:[_\-\s])(\d+)$/;
const FALLBACK_NUMBER_PATTERN = /(\d+)$/;

function parseFrameName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const match = stem.match(NUMBER_PATTERN) ?? stem.match(FALLBACK_NUMBER_PATTERN);
  if (!match) return { groupKey: stem || 'Без названия', number: null };
  const number = Number(match[1]);
  const groupKey = stem.slice(0, match.index).replace(/[_\-\s]+$/, '') || 'Без названия';
  return { groupKey, number };
}

function inspectGroup(frames: Frame[]) {
  const reasons: string[] = [];
  const numbers = frames.map((frame) => frame.number);
  if (frames.length < 2) reasons.push('нужно минимум 2 кадра');
  if (numbers.some((number) => number === null)) reasons.push('есть кадр без номера в конце имени');
  const validNumbers = numbers.filter((number): number is number => number !== null);
  const duplicate = validNumbers.find((number, index) => validNumbers.indexOf(number) !== index);
  if (duplicate !== undefined) reasons.push(`дублируется кадр ${duplicate}`);
  if (validNumbers.length) {
    const missing = Array.from({ length: Math.max(...validNumbers) }, (_, index) => index + 1)
      .filter((number) => !validNumbers.includes(number));
    if (missing.length) reasons.push(`пропущены кадры ${missing.join(', ')}`);
    if (Math.min(...validNumbers) !== 1) reasons.push('нумерация должна начинаться с 1');
  }
  return { valid: reasons.length === 0, reasons };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function hexToRgb(hex: string) {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

async function readImage(file: File): Promise<RgbaFrame> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Браузер не создал контекст изображения');
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    const url = URL.createObjectURL(file);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Не удалось декодировать изображение'));
      element.src = url;
    });
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
  }
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

function le16(value: number) {
  return [value & 255, (value >> 8) & 255];
}

function le32(value: number) {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255];
}

function rgbDistance(a: number[], b: number[]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr * 2 + dg * dg * 4 + db * db * 3;
}

function createPalette(frames: RgbaFrame[], quality: number, target: ReturnType<typeof hexToRgb>, lock: boolean) {
  const buckets = new Map<number, number>();
  const stride = Math.max(1, Math.floor((101 - quality) / 12));
  for (const frame of frames) {
    for (let index = 0; index < frame.data.length; index += 4 * stride) {
      const r = frame.data[index];
      const g = frame.data[index + 1];
      const b = frame.data[index + 2];
      const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const colors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, lock ? 255 : 256)
    .map(([key]) => [(key >> 10 & 31) * 255 / 31, (key >> 5 & 31) * 255 / 31, (key & 31) * 255 / 31]);
  const palette = lock && target ? [[target.r, target.g, target.b], ...colors] : colors;
  while (palette.length < 256) palette.push(palette[palette.length % Math.max(1, palette.length)] ?? [0, 0, 0]);
  return palette.slice(0, 256);
}

function makeLzw(indexes: Uint8Array) {
  const clear = 1 << 8;
  const end = clear + 1;
  const dictionary = new Map<string, number>();
  let next = end + 1;
  let codeSize = 9;
  let bits = 0;
  let bitCount = 0;
  const output: number[] = [];
  const emit = (value: number) => {
    bits |= value << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bits & 255);
      bits >>= 8;
      bitCount -= 8;
    }
  };
  emit(clear);
  if (indexes.length) {
    let phrase = String(indexes[0]);
    for (let index = 1; index < indexes.length; index += 1) {
      const nextPhrase = `${phrase},${indexes[index]}`;
      if (dictionary.has(nextPhrase)) {
        phrase = nextPhrase;
      } else {
        emit(phrase.includes(',') ? dictionary.get(phrase)! : Number(phrase));
        if (next < 4096) {
          dictionary.set(nextPhrase, next);
          next += 1;
          if (next === (1 << codeSize) && codeSize < 12) codeSize += 1;
        } else {
          emit(clear);
          dictionary.clear();
          next = end + 1;
          codeSize = 9;
        }
        phrase = String(indexes[index]);
      }
    }
    emit(phrase.includes(',') ? dictionary.get(phrase)! : Number(phrase));
  }
  emit(end);
  if (bitCount > 0) output.push(bits & 255);
  return new Uint8Array(output);
}

function encodeGif(frames: RgbaFrame[], settings: RenderSettings, onProgress: (value: number) => void) {
  const width = frames[0].width;
  const height = frames[0].height;
  const palette = createPalette(frames, settings.quality, hexToRgb(settings.targetColor), settings.colorLock);
  const bucketIndexes = new Uint8Array(32768);
  for (let bucket = 0; bucket < bucketIndexes.length; bucket += 1) {
    const color = [(bucket >> 10 & 31) * 255 / 31, (bucket >> 5 & 31) * 255 / 31, (bucket & 31) * 255 / 31];
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index += 1) {
      const nextDistance = rgbDistance(color, palette[index]);
      if (nextDistance < distance) { distance = nextDistance; closest = index; }
    }
    bucketIndexes[bucket] = closest;
  }
  const output: number[] = [...new TextEncoder().encode('GIF89a'), ...le16(width), ...le16(height), 0xf7, 0, 0];
  for (const color of palette) output.push(color[0], color[1], color[2]);
  output.push(0x21, 0xff, 0x0b, ...new TextEncoder().encode('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    const indexes = new Uint8Array(width * height);
    const target = hexToRgb(settings.targetColor);
    for (let pixel = 0, index = 0; pixel < frame.data.length; pixel += 4, index += 1) {
      const r = frame.data[pixel];
      const g = frame.data[pixel + 1];
      const b = frame.data[pixel + 2];
      if (settings.colorLock && target && Math.abs(r - target.r) <= 2 && Math.abs(g - target.g) <= 2 && Math.abs(b - target.b) <= 2) {
        indexes[index] = 0;
      } else {
        indexes[index] = bucketIndexes[(r >> 3) << 10 | (g >> 3) << 5 | (b >> 3)];
      }
    }
    const lzw = makeLzw(indexes);
    const delay = Math.max(2, Math.min(6000, Math.round(settings.delay / 10)));
    output.push(0x21, 0xf9, 0x04, 0x00, ...le16(delay), 0x00, 0x00, 0x2c, ...le16(0), ...le16(0), ...le16(width), ...le16(height), 0x00, 0x08);
    for (let offset = 0; offset < lzw.length; offset += 255) {
      const part = lzw.subarray(offset, offset + 255);
      output.push(part.length, ...part);
    }
    output.push(0);
    onProgress(Math.round((frameIndex + 1) / frames.length * 100));
  }
  output.push(0x3b);
  return { bytes: new Uint8Array(output), width, height };
}

async function encodeGifWithGifski(
  frames: RgbaFrame[],
  settings: RenderSettings,
  onProgress: (value: number) => void,
) {
  const imageFrames = frames.map(
    (frame) => new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
  );
  const bytes = await gifskiEncode({
    frames: imageFrames,
    width: frames[0].width,
    height: frames[0].height,
    frameDurations: frames.map(() => settings.delay),
    quality: settings.quality,
    repeat: settings.repeat === 0 ? undefined : settings.repeat,
  });
  onProgress(100);
  return { bytes, width: frames[0].width, height: frames[0].height };
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: { name: string; bytes: Uint8Array }[]) {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localSize = 0;
  let centralSize = 0;
  let offset = 0;
  for (const file of files) {
    const name = [...new TextEncoder().encode(file.name)];
    const crc = crc32(file.bytes);
    const localHeader = Uint8Array.from([
      0x50, 0x4b, 0x03, 0x04, 20, 0, 0x00, 0x08, 0, 0, 0, 0, 0, 0,
      ...le32(crc), ...le32(file.bytes.length), ...le32(file.bytes.length), ...le16(name.length), 0, 0, ...name,
    ]);
    const centralHeader = Uint8Array.from([
      0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0x00, 0x08, 0, 0, 0, 0, 0, 0,
      ...le32(crc), ...le32(file.bytes.length), ...le32(file.bytes.length), ...le16(name.length),
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(offset), ...name,
    ]);
    localChunks.push(localHeader, file.bytes);
    centralChunks.push(centralHeader);
    localSize += localHeader.length + file.bytes.length;
    centralSize += centralHeader.length;
    offset = localSize;
  }
  const end = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, ...le16(files.length), ...le16(files.length), ...le32(centralSize), ...le32(localSize), 0, 0]);
  const archive = new Uint8Array(localSize + centralSize + end.length);
  let writeOffset = 0;
  for (const chunk of localChunks) { archive.set(chunk, writeOffset); writeOffset += chunk.length; }
  for (const chunk of centralChunks) { archive.set(chunk, writeOffset); writeOffset += chunk.length; }
  archive.set(end, writeOffset);
  return archive;
}

function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer as ArrayBuffer], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function LocalGifStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [results, setResults] = useState<Record<string, GifResult>>({});
  const [rendering, setRendering] = useState<Record<string, number>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [step, setStep] = useState(1);
  const [settings, setSettings] = useState<RenderSettings>({
    delay: 2500,
    scale: 1,
    quality: 90,
    repeat: 0,
    colorLock: false,
    targetColor: '#FFFFFF',
  });

  const [previewModal, setPreviewModal] = useState<{
    groupId: string;
    frameIndex: number;
  } | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Frame[]>();
    for (const frame of frames) {
      map.set(frame.groupKey, [...(map.get(frame.groupKey) ?? []), frame]);
    }
    return [...map.entries()].map(([key, groupFrames]) => ({
      id: key.toLowerCase().replace(/[^a-z0-9а-я]+/gi, '-'),
      key,
      frames: [...groupFrames].sort(
        (a, b) =>
          (a.number ?? Number.MAX_SAFE_INTEGER) -
            (b.number ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      ),
    }));
  }, [frames]);

  const readyGroups = groups.filter((group) => inspectGroup(group.frames).valid);
  const renderedCount = Object.keys(results).length;
  const totalBytes = Object.values(results).reduce((sum, result) => sum + result.bytes.length, 0);
  const hasRendering = Object.keys(rendering).length > 0;

  const previewGroup = previewModal
    ? groups.find((g) => g.id === previewModal.groupId) ?? null
    : null;
  const currentPreviewFrame = previewGroup
    ? previewGroup.frames[previewModal?.frameIndex ?? 0] ?? null
    : null;

  const openPreview = (group: Group, index: number) => {
    setPreviewModal({ groupId: group.id, frameIndex: index });
    setPreviewZoom(1);
    setIsPlayingPreview(false);
  };

  const closePreview = () => {
    setPreviewModal(null);
    setIsPlayingPreview(false);
  };

  const prevFrame = () => {
    if (!previewGroup || previewGroup.frames.length <= 1) return;
    setPreviewModal((curr) =>
      curr
        ? {
            ...curr,
            frameIndex:
              (curr.frameIndex - 1 + previewGroup.frames.length) %
              previewGroup.frames.length,
          }
        : null,
    );
  };

  const nextFrame = () => {
    if (!previewGroup || previewGroup.frames.length <= 1) return;
    setPreviewModal((curr) =>
      curr
        ? {
            ...curr,
            frameIndex: (curr.frameIndex + 1) % previewGroup.frames.length,
          }
        : null,
    );
  };

  useEffect(() => {
    if (!previewModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePreview();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevFrame();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextFrame();
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlayingPreview((playing) => !playing);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewModal, previewGroup]);

  useEffect(() => {
    if (!isPlayingPreview || !previewGroup || previewGroup.frames.length <= 1) return;
    const intervalTime = Math.max(60, Math.min(1000, settings.delay));
    const timer = setInterval(() => {
      setPreviewModal((curr) =>
        curr
          ? {
              ...curr,
              frameIndex: (curr.frameIndex + 1) % previewGroup.frames.length,
            }
          : null,
      );
    }, intervalTime);
    return () => clearInterval(timer);
  }, [isPlayingPreview, previewGroup, settings.delay]);

  const showToast = (message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(() => setToast(null), 3600);
  };

  const addFiles = async (fileList: FileList | File[]) => {
    const candidates = [...fileList].filter(
      (file) =>
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif)$/i.test(file.name),
    );
    if (!candidates.length) {
      showToast('Добавьте PNG, JPG, WebP или GIF', true);
      return;
    }

    setLoadingFiles(true);
    const accepted: Frame[] = [];
    const existing = new Set(frames.map((frame) => frame.id));

    for (const file of candidates) {
      const id = `${file.name}:${file.size}:${file.lastModified}`;
      if (existing.has(id)) continue;
      try {
        const image = await readImage(file);
        const parsed = parseFrameName(file.name);
        const previewUrl = URL.createObjectURL(file);
        accepted.push({
          id,
          file,
          name: file.name,
          ...parsed,
          width: image.width,
          height: image.height,
          previewUrl,
        });
      } catch {
        showToast(`Не удалось прочитать ${file.name}`, true);
      }
    }

    setFrames((current) => [...current, ...accepted]);
    setLoadingFiles(false);

    if (accepted.length) {
      showToast(`Добавлено кадров: ${accepted.length}`);
      setStep(2);
    }
  };

  const updateSettings = (patch: Partial<RenderSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));

  const renderGroup = async (group: Group) => {
    const check = inspectGroup(group.frames);
    if (!check.valid) {
      showToast('Исправьте диагностику группы перед кодированием', true);
      setStep(2);
      return null;
    }

    setRendering((current) => ({ ...current, [group.id]: 0 }));

    try {
      const sourceFrames = await Promise.all(
        group.frames.map((frame) => readImage(frame.file)),
      );
      const width = Math.max(1, Math.round(sourceFrames[0].width * settings.scale));
      const height = Math.max(1, Math.round(sourceFrames[0].height * settings.scale));

      const scaled = sourceFrames.map((source) => {
        if (source.width === width && source.height === height) return source;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Не удалось подготовить холст');

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = source.width;
        sourceCanvas.height = source.height;
        sourceCanvas
          .getContext('2d')
          ?.putImageData(
            new ImageData(
              source.data as Uint8ClampedArray<ArrayBuffer>,
              source.width,
              source.height,
            ),
            0,
            0,
          );
        context.drawImage(sourceCanvas, 0, 0, width, height);
        return {
          data: context.getImageData(0, 0, width, height).data,
          width,
          height,
        };
      });

      let encoded: { bytes: Uint8Array; width: number; height: number };
      try {
        encoded = await encodeGifWithGifski(
          scaled,
          settings,
          (progress) =>
            setRendering((current) => ({ ...current, [group.id]: progress })),
        );
      } catch (gifskiErr) {
        console.warn('gifski-wasm fallback to internal encoder:', gifskiErr);
        encoded = encodeGif(
          scaled,
          settings,
          (progress) =>
            setRendering((current) => ({ ...current, [group.id]: progress })),
        );
      }

      const name = `${
        group.key.replace(/[^a-z0-9а-яё_-]+/gi, '-').replace(/-+/g, '-') ||
        'sequence'
      }.gif`;
      const url = URL.createObjectURL(
        new Blob([encoded.bytes.buffer as ArrayBuffer], { type: 'image/gif' }),
      );
      const result = { ...encoded, url, bytes: encoded.bytes, name };

      setResults((current) => {
        const old = current[group.id];
        if (old) URL.revokeObjectURL(old.url);
        return { ...current, [group.id]: result };
      });

      showToast(`Готово: ${name}`);
      return result;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Не удалось закодировать GIF',
        true,
      );
      return null;
    } finally {
      setRendering((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
    }
  };

  const renderAll = async () => {
    if (!readyGroups.length) {
      showToast('Нет готовых последовательностей', true);
      setStep(2);
      return;
    }

    setStep(4);
    for (const group of readyGroups) {
      await renderGroup(group);
    }
  };

  const downloadZip = () => {
    const files = groups
      .map((group) => ({
        name: results[group.id]?.name ?? `${group.key}.gif`,
        bytes: results[group.id]?.bytes,
      }))
      .filter(
        (file): file is { name: string; bytes: Uint8Array } =>
          Boolean(file.bytes),
      );

    if (!files.length) {
      showToast('Сначала создайте хотя бы один GIF', true);
      return;
    }

    try {
      downloadBytes(
        makeZip(files),
        'local-gif-studio-batch.zip',
        'application/zip',
      );
      showToast(`ZIP скачан: ${files.length} GIF`);
    } catch (error) {
      showToast(
        error instanceof Error
          ? `Не удалось собрать ZIP: ${error.message}`
          : 'Не удалось собрать ZIP',
        true,
      );
    }
  };

  const startNewProject = () => {
    Object.values(results).forEach((res) => {
      if (res.url) URL.revokeObjectURL(res.url);
    });
    frames.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setFrames([]);
    setResults({});
    setRendering({});
    setStep(1);
    showToast('Готово к созданию новых GIF');
  };

  const removeFrame = (id: string) => {
    setFrames((current) => {
      const target = current.find((frame) => frame.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((frame) => frame.id !== id);
    });
    setResults({});
    setPreviewModal((curr) => {
      if (!curr) return null;
      const group = groups.find((g) => g.id === curr.groupId);
      if (!group) return null;
      const remainingFrames = group.frames.filter((f) => f.id !== id);
      if (remainingFrames.length === 0) return null;
      return {
        ...curr,
        frameIndex: Math.min(curr.frameIndex, remainingFrames.length - 1),
      };
    });
  };

  const reset = () => {
    Object.values(results).forEach((result) => URL.revokeObjectURL(result.url));
    frames.forEach((frame) => {
      if (frame.previewUrl) URL.revokeObjectURL(frame.previewUrl);
    });
    setFrames([]);
    setResults({});
    setRendering({});
    setPreviewModal(null);
    setIsPlayingPreview(false);
    setStep(1);
  };

  const goNext = () => {
    if (step === 1 && !frames.length) {
      inputRef.current?.click();
      return;
    }

    if (step === 2) {
      if (!groups.length) {
        showToast('Сначала добавьте кадры', true);
        setStep(1);
        return;
      }
      if (!readyGroups.length) {
        showToast('Исправьте проблемные последовательности', true);
        return;
      }
    }

    if (step === 3) {
      void renderAll();
      return;
    }

    setStep((current) => Math.min(4, current + 1));
  };

  const stepTitles = [
    ['01', 'КАДРЫ', 'Добавить исходники'],
    ['02', 'СЕРИИ', 'Проверить порядок'],
    ['03', 'ПАРАМЕТРЫ', 'Настроить экспорт'],
    ['04', 'РЕЗУЛЬТАТ', 'Получить GIF'],
  ];

  return (
    <div className={`step-${step} min-w-0`}>
      <div className="wizard">
        <aside className="step-rail">
          <div className="rail-caption">РАБОЧИЙ ПРОЦЕСС / 04</div>

          <div className="step-list">
            {stepTitles.map(([number, title, caption], index) => {
              const value = index + 1;
              const active = value === step;
              const complete = value < step || (value === 2 && readyGroups.length > 0);

              return (
                <button
                  key={number}
                  className={`step-node${active ? ' active' : ''}${complete ? ' complete' : ''}`}
                  onClick={() => {
                    if (value <= 2 && frames.length) setStep(value);
                    if (value === 3 && readyGroups.length) setStep(3);
                    if (value === 4 && renderedCount) setStep(4);
                  }}
                >
                  <span className="step-number">{number}</span>
                  <span className="step-copy hidden md:grid">
                    <strong>{title}</strong>
                    <small>{caption}</small>
                  </span>
                  <span className="step-state hidden md:inline">{complete ? '✓' : '↗'}</span>
                </button>
              );
            })}
          </div>

          <div className="rail-bottom">
            <span className="corner-mark">↘</span>
            <div>
              <strong>Подсказка</strong>
              <span>Следуйте этапам, все очень просто.</span>
            </div>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-head">
            <div>
              <div className="kicker">ПОСТРОЕНИЕ ПОСЛЕДОВАТЕЛЬНОСТИ / ШАГ {String(step).padStart(2, '0')}</div>
              <h1>
                {step === 1 && <>Загрузите <em>кадры.</em></>}
                {step === 2 && <>Соберите <em>серии.</em></>}
                {step === 3 && <>Настройте <em>движение.</em></>}
                {step === 4 && <>GIF <em>готов.</em></>}
              </h1>
            </div>

            <div className="stage-index">
              <span>0{step}</span>
              <i />
              <span>04</span>
            </div>
          </div>

          <div className="stage-content">
            {step === 1 && (
              <section className="step-panel step-upload">
                <div className="panel-label">ИНПУТ / ДРОП ЗОНА</div>
                <div
                  className={`dropzone${dragging ? ' dragging' : ''}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void addFiles(event.dataTransfer.files);
                  }}
                  data-testid="dropzone-frames"
                >
                  <div className="drop-content">
                    <div className="drop-icon-badge">
                      <ImagePlus size={26} />
                    </div>

                    <div className="drop-index">
                      <span>ШАГ  &middot; ЗАГРУЗКА</span>
                    </div>

                    <h2>{loadingFiles ? 'ЧТЕНИЕ ИЗОБРАЖЕНИЙ…' : 'Перетащите серию кадров сюда'}</h2>
                    <p>
                      Файлы с последовательной нумерацией (например, <span>scene_01.png</span>) автоматически формируют плавную анимацию.
                    </p>

                    <div className="drop-formats">
                      <span className="drop-format-pill">PNG</span>
                      <span className="drop-format-pill">JPG / JPEG</span>
                      <span className="drop-format-pill">WEBP</span>
                      <span className="drop-format-pill">GIF</span>
                    </div>

                    <div className="action-row">
                      <button
                        className="ui-button primary"
                        onClick={() => inputRef.current?.click()}
                        disabled={loadingFiles}
                        data-testid="button-choose-files"
                      >
                        <UploadCloud size={15} />
                        ВЫБРАТЬ ФАЙЛЫ
                      </button>

                      {frames.length > 0 && (
                        <button className="ui-button ghost" onClick={reset}>
                          <Trash2 size={14} />
                          ОЧИСТИТЬ ({frames.length})
                        </button>
                      )}
                    </div>
                  </div>

                  <input
                    ref={inputRef}
                    className="sr-only"
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => {
                      if (event.target.files) void addFiles(event.target.files);
                      event.target.value = '';
                    }}
                    data-testid="input-file-picker"
                  />
                </div>

                <div className="info-strip">
                  <span>01</span>
                  <p>Файлы не отправляются на сервер. Вся обработка выполняется локально.</p>
                  <ShieldCheck size={17} />
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="step-panel">
                <div className="panel-label">ОБНАРУЖЕНИЕ / ПОСЛЕДОВАТЕЛЬНОСТИ</div>

                {groups.length === 0 ? (
                  <div className="empty-state">
                    <FileImage size={24} />
                    <strong>НЕТ ПОСЛЕДОВАТЕЛЬНОСТЕЙ</strong>
                    <p>Вернитесь назад и добавьте два или больше кадров.</p>
                  </div>
                ) : (
                  <>
                    {groups.some((group) => !inspectGroup(group.frames).valid) && (
                      <div className="diagnostics">
                        <AlertTriangle size={15} />
                        <span>Есть последовательности, которые нельзя надёжно собрать.</span>
                      </div>
                    )}

                    <div className="sequence-grid">
                      {groups.map((group, groupIndex) => {
                        const check = inspectGroup(group.frames);
                        const result = results[group.id];
                        const progress = rendering[group.id];
                        const isCollapsed = collapsed[group.id];

                        return (
                          <article
                            className={`sequence-card${check.valid ? ' ready' : ' warning-card'}${isCollapsed ? ' collapsed' : ''}`}
                            key={group.id}
                            data-testid={`card-group-${group.id}`}
                          >
                            <header className="sequence-header">
                              <div className="sequence-id">0{groupIndex + 1}</div>
                              <div className="sequence-title-wrap">
                                <h3>
                                  {group.key}
                                  <span className={`state-tag ${check.valid ? 'ok' : 'bad'}`}>
                                    {check.valid ? 'READY' : 'CHECK'}
                                  </span>
                                </h3>
                                <p>{group.frames[0].width} × {group.frames[0].height} · {group.frames.length} FRAMES</p>
                              </div>
                              <button
                                className="icon-button"
                                onClick={() =>
                                  setCollapsed((current) => ({
                                    ...current,
                                    [group.id]: !current[group.id],
                                  }))
                                }
                                aria-label={isCollapsed ? 'Развернуть серию' : 'Свернуть серию'}
                              >
                                {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                              </button>
                            </header>

                            {!isCollapsed && (
                              <div className="sequence-body">
                                <div className="frame-visuals">
                                  {group.frames.slice(0, 6).map((frame, index) => (
                                    <button
                                      type="button"
                                      className="frame-chip clickable"
                                      key={frame.id}
                                      onClick={() => openPreview(group, index)}
                                      title={`Просмотреть кадр ${frame.name} в полный размер`}
                                      aria-label={`Детальный просмотр кадра ${frame.name}`}
                                    >
                                      <img
                                        src={frame.previewUrl}
                                        alt=""
                                        className="frame-chip-thumb"
                                        loading="lazy"
                                      />
                                      <div className="frame-chip-meta">
                                        <span>{String(index + 1).padStart(2, '0')}</span>
                                        <b>{frame.number === null ? '—' : `#${frame.number}`}</b>
                                      </div>
                                      <span className="frame-chip-zoom">
                                        <ZoomIn size={12} />
                                      </span>
                                    </button>
                                  ))}
                                  {group.frames.length > 6 && (
                                    <button
                                      type="button"
                                      className="frame-chip more clickable"
                                      onClick={() => openPreview(group, 6)}
                                      title={`Показать все кадры начиная с 7-го`}
                                    >
                                      +{group.frames.length - 6}
                                    </button>
                                  )}
                                </div>

                                <div className="frames-list">
                                  {group.frames.map((frame, index) => (
                                    <div
                                      className={`frame-line${frame.number === null ? ' invalid' : ''}`}
                                      key={frame.id}
                                    >
                                      <button
                                        type="button"
                                        className="frame-preview-trigger"
                                        onClick={() => openPreview(group, index)}
                                        title={`Нажмите для детального просмотра кадра ${frame.name}`}
                                      >
                                        <img
                                          src={frame.previewUrl}
                                          alt=""
                                          className="frame-line-thumb"
                                          loading="lazy"
                                        />
                                        <span className="frame-line-name" title={frame.name}>
                                          {frame.name}
                                        </span>
                                        <span className="frame-preview-tag">
                                          <Eye size={12} />
                                        </span>
                                      </button>
                                      <span className="frame-number">
                                        {frame.number === null ? '—' : `#${frame.number}`}
                                        <button
                                          className="remove-frame"
                                          onClick={() => removeFrame(frame.id)}
                                          aria-label={`Удалить ${frame.name}`}
                                        >
                                          ×
                                        </button>
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                {!check.valid && (
                                  <div className="warning">
                                    <AlertTriangle size={14} />
                                    <span>{check.reasons.join(' · ')}.</span>
                                  </div>
                                )}

                                {progress !== undefined && (
                                  <div className="rendering">
                                    <LoaderCircle size={14} className="spin" />
                                    <div className="progress-track">
                                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                                    </div>
                                    <span>{progress}%</span>
                                  </div>
                                )}

                                {result && (
                                  <div className="mini-result">
                                    <Check size={14} />
                                    <span>{result.name}</span>
                                    <b>{formatBytes(result.bytes.length)}</b>
                                  </div>
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            )}

            {step === 3 && (
              <section className="step-panel">
                <div className="panel-label">ВЫХОДНЫЕ ДАННЫЕ / ПАРАМЕТРЫ</div>

                <div className="settings-layout">
                  <div className="settings-main">
                    <div className="parameter-block large">
                      <div className="parameter-heading">
                        <span>01</span>
                        <div>
                          <strong>СКОРОСТЬ КАДРА</strong>
                          <small>Задержка между кадрами</small>
                        </div>
                      </div>
                      <div className="input-slab">
                        <input
                          className="big-input"
                          id="delay"
                          type="number"
                          min="20"
                          max="60000"
                          step="10"
                          value={settings.delay}
                          onChange={(event) =>
                            updateSettings({
                              delay: Math.max(
                                20,
                                Math.min(60000, Number(event.target.value) || 250),
                              ),
                            })
                          }
                        />
                        <span>MS</span>
                      </div>
                    </div>

                    <div className="parameter-block">
                      <div className="parameter-heading">
                        <span>02</span>
                        <div>
                          <strong>МАСШТАБ</strong>
                          <small>Размер результата</small>
                        </div>
                      </div>
                      <div className="segmented">
                        {[1, 2, 4].map((scale) => (
                          <button
                            className={settings.scale === scale ? 'active' : ''}
                            key={scale}
                            onClick={() => updateSettings({ scale })}
                          >
                            ×{scale}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="parameter-block">
                      <div className="parameter-heading">
                        <span>03</span>
                        <div>
                          <strong>КАЧЕСТВО ПАЛИТРЫ</strong>
                          <small>Точность цветового преобразования</small>
                        </div>
                        <b>{settings.quality}</b>
                      </div>
                      <input
                        className="range"
                        id="quality"
                        type="range"
                        min="35"
                        max="100"
                        value={settings.quality}
                        onChange={(event) =>
                          updateSettings({ quality: Number(event.target.value) })
                        }
                      />
                    </div>

                    <div className="parameter-block">
                      <div className="parameter-heading">
                        <span>04</span>
                        <div>
                          <strong>ПОВТОРЫ</strong>
                          <small>Количество циклов воспроизведения</small>
                        </div>
                      </div>
                      <select
                        className="select-input"
                        id="repeat"
                        value={settings.repeat}
                        onChange={(event) =>
                          updateSettings({ repeat: Number(event.target.value) })
                        }
                      >
                        {Array.from({ length: 11 }, (_, repeat) => (
                          <option key={repeat} value={repeat}>
                            {repeat === 0 ? 'БЕСКОНЕЧНО' : repeat}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <aside className="settings-side">
                    <div className="side-card-title">
                      <span>05</span>
                      <strong>ФИКСАЦИЯ ЦВЕТА</strong>
                    </div>

                    <div className="color-row">
                      <input
                        className="text-input"
                        value={settings.targetColor}
                        maxLength={7}
                        onChange={(event) =>
                          updateSettings({ targetColor: event.target.value.toUpperCase() })
                        }
                        aria-label="Точный цвет"
                      />
                      <input
                        className="color-input"
                        type="color"
                        value={hexToRgb(settings.targetColor) ? settings.targetColor : '#FFFFFF'}
                        onChange={(event) =>
                          updateSettings({ targetColor: event.target.value.toUpperCase() })
                        }
                        aria-label="Выбрать цвет"
                      />
                    </div>

                    <label className="lock-option">
                      <input
                        type="checkbox"
                        checked={settings.colorLock}
                        onChange={(event) =>
                          updateSettings({ colorLock: event.target.checked })
                        }
                      />
                      <span>
                        <LockKeyhole size={14} />
                        ГАРАНТИРОВАТЬ ЦВЕТ
                      </span>
                    </label>

                    <p>
                      Подходящие пиксели будут нормализованы к выбранному цвету и попадут
                      в палитру результата.
                    </p>

                    <div className="side-card-note">
                      <ShieldCheck size={15} />
                      <span>ВСЕ ДАННЫЕ ОСТАЮТСЯ ЛОКАЛЬНО</span>
                    </div>
                  </aside>
                </div>
              </section>
            )}

            {step === 4 && (
              <section className="step-panel result-step">
                <div className="panel-label">ЭКСПОРТ</div>

                <div className="result-overview">
                  <div className="result-count">
                    <span>{String(renderedCount).padStart(2, '0')}</span>
                    <div>
                      <strong>GIF СОЗДАНО</strong>
                      <small>{totalBytes ? formatBytes(totalBytes) : 'Готово к сборке'}</small>
                    </div>
                  </div>

                  {hasRendering && (
                    <div className="live-state">
                      <LoaderCircle size={15} className="spin" />
                      КОДИРОВАНИЕ
                    </div>
                  )}
                </div>

                <div className="result-grid">
                  {groups.map((group, index) => {
                    const result = results[group.id];
                    const progress = rendering[group.id];

                    return (
                      <article className="result-card" key={group.id}>
                        <div className="result-card-head">
                          <span>0{index + 1}</span>
                          <strong>{group.key}</strong>
                          {result && <Check size={14} />}
                        </div>

                        {result ? (
                          <>
                            <img
                              className="preview"
                              src={result.url}
                              alt={`Предпросмотр ${result.name}`}
                            />
                            <div className="result-meta">
                              <span>{formatBytes(result.bytes.length)} · {result.width}×{result.height}</span>
                              <span>{result.name}</span>
                            </div>
                            <button
                              className="ui-button primary wide"
                              onClick={() => downloadBytes(result.bytes, result.name, 'image/gif')}
                            >
                              <Download size={14} />
                              СКАЧАТЬ GIF
                              <b>↗</b>
                            </button>
                          </>
                        ) : progress !== undefined ? (
                          <div className="result-progress">
                            <LoaderCircle size={22} className="spin" />
                            <strong>СОБИРАЕМ КАДР ЗА КАДРОМ</strong>
                            <div className="progress-track">
                              <div className="progress-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <span>{progress}%</span>
                          </div>
                        ) : (
                          <div className="result-empty">
                            <span>READY</span>
                            <p>GIF ещё не собран.</p>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                {renderedCount > 0 && (
                  <div className="export-bar">
                    <div>
                      <span>PACKAGE</span>
                      <strong>{renderedCount} GIF · {formatBytes(totalBytes)}</strong>
                    </div>
                    <button className="ui-button primary" onClick={downloadZip}>
                      <Archive size={14} />
                      СКАЧАТЬ ZIP
                      <b>↗</b>
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>

          <footer className="wizard-footer">
            <div className="footer-hint">
              <span>ПАКЕТНАЯ СБОРКА ГИФ / ИЗ ПОСЛЕДОВАТЕЛЬНОСТЕЙ</span>
              <small>{step === 4 ? 'СОТНИ ГИФ' : 'ЗА СЕКУНДЫ · В ЛУЧШЕМ КАЧЕСТВЕ'}</small>
            </div>

            <div className="footer-actions">
              {step > 1 && (
                <button
                  className="ui-button ghost"
                  onClick={() => setStep((current) => Math.max(1, current - 1))}
                  disabled={hasRendering}
                >
                  ← НАЗАД
                </button>
              )}

              {step < 4 && (
                <button
                  className="ui-button primary next-button"
                  onClick={goNext}
                  disabled={hasRendering}
                >
                  {step === 3 ? 'СОБРАТЬ GIF' : 'ПРОДОЛЖИТЬ'}
                  <b>↗</b>
                </button>
              )}

              {step === 4 && (
                <>
                  <button
                    className="ui-button ghost"
                    onClick={() => setStep(3)}
                    disabled={hasRendering}
                  >
                    ИЗМЕНИТЬ ПАРАМЕТРЫ
                  </button>
                  <button
                    className="ui-button primary next-button"
                    onClick={startNewProject}
                    disabled={hasRendering}
                  >
                    <ImagePlus size={14} />
                    СОЗДАТЬ НОВЫЕ GIF <b>+</b>
                  </button>
                </>
              )}
            </div>
          </footer>
        </section>
      </div>

      {previewModal && previewGroup && currentPreviewFrame && (
        <div
          className="modal-backdrop"
          onClick={closePreview}
          role="dialog"
          aria-modal="true"
          aria-label="Предпросмотр кадра"
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div className="modal-header-info">
                <div className="modal-badge">
                  СЕРИЯ: {previewGroup.key} · КАДР {previewModal.frameIndex + 1} ИЗ {previewGroup.frames.length}
                </div>
                <h3 className="modal-title" title={currentPreviewFrame.name}>
                  {currentPreviewFrame.name}
                </h3>
              </div>
              <div className="modal-header-actions">
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={closePreview}
                  aria-label="Закрыть окно предпросмотра"
                  title="Закрыть (Esc)"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="modal-viewport">
              {previewGroup.frames.length > 1 && (
                <>
                  <button
                    type="button"
                    className="modal-nav-btn modal-nav-prev"
                    onClick={prevFrame}
                    title="Предыдущий кадр (Стрелка влево)"
                    aria-label="Предыдущий кадр"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <button
                    type="button"
                    className="modal-nav-btn modal-nav-next"
                    onClick={nextFrame}
                    title="Следующий кадр (Стрелка вправо)"
                    aria-label="Следующий кадр"
                  >
                    <ChevronRight size={22} />
                  </button>
                </>
              )}

              <div
                className="modal-img-container"
                style={{ transform: `scale(${previewZoom})` }}
              >
                <img
                  src={currentPreviewFrame.previewUrl}
                  alt={currentPreviewFrame.name}
                  className="modal-image"
                />
              </div>

              <div className="modal-floating-bar">
                <span className="modal-bar-counter">
                  #{previewModal.frameIndex + 1} / {previewGroup.frames.length}
                </span>
                <div className="modal-bar-sep" />
                <button
                  type="button"
                  className={`modal-bar-btn${isPlayingPreview ? ' active' : ''}`}
                  onClick={() => setIsPlayingPreview((v) => !v)}
                  title={
                    isPlayingPreview
                      ? 'Приостановить показ (Пробел)'
                      : 'Воспроизвести кадры серии (Пробел)'
                  }
                >
                  {isPlayingPreview ? <Pause size={13} /> : <Play size={13} />}
                  {isPlayingPreview ? 'ПАУЗА' : 'ПРОИГРАТЬ'}
                </button>
                <div className="modal-bar-sep" />
                <button
                  type="button"
                  className="modal-bar-btn"
                  onClick={() =>
                    setPreviewZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))
                  }
                  title="Уменьшить масштаб"
                >
                  <ZoomOut size={13} />
                </button>
                <button
                  type="button"
                  className="modal-bar-btn"
                  onClick={() => setPreviewZoom(1)}
                  title="Сбросить масштаб к 100%"
                >
                  {Math.round(previewZoom * 100)}%
                </button>
                <button
                  type="button"
                  className="modal-bar-btn"
                  onClick={() =>
                    setPreviewZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))
                  }
                  title="Увеличить масштаб"
                >
                  <ZoomIn size={13} />
                </button>
              </div>
            </div>

            <footer className="modal-footer">
              <div className="modal-meta-chips">
                <div>
                  РАЗРЕШЕНИЕ: <span>{currentPreviewFrame.width} × {currentPreviewFrame.height} PX</span>
                </div>
                <div>
                  РАЗМЕР: <span>{formatBytes(currentPreviewFrame.file.size)}</span>
                </div>
                <div>
                  ТИП: <span>{currentPreviewFrame.file.type || 'IMAGE'}</span>
                </div>
              </div>

              <div className="modal-footer-actions">
                <button
                  type="button"
                  className="ui-button ghost"
                  onClick={() => {
                    const anchor = document.createElement('a');
                    anchor.href = currentPreviewFrame.previewUrl;
                    anchor.download = currentPreviewFrame.name;
                    anchor.click();
                  }}
                  title="Скачать файл данного кадра"
                >
                  <Download size={13} />
                  СКАЧАТЬ КАДР
                </button>
                <button
                  type="button"
                  className="ui-button ghost"
                  onClick={() => {
                    const idToDelete = currentPreviewFrame.id;
                    removeFrame(idToDelete);
                  }}
                  title="Удалить данный кадр"
                >
                  <Trash2 size={13} />
                  УДАЛИТЬ
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast${toast.error ? ' error' : ''}`} role="status">
          <span>{toast.error ? '!' : '✓'}</span>
          {toast.message}
        </div>
      )}
    </div>
  );
}
