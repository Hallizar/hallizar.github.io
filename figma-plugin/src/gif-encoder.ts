// Чистый TS, без DOM/WebAPI — работает и в браузере (UI плагина), и в Node (тесты).
// Порт движка кодирования GIF из LocalGifStudio (src/components/LocalGifStudio.tsx):
// квантование палитры через 5-битные RGB-бакеты + LZW-сжатие.

export type RgbaFrame = { data: Uint8ClampedArray; width: number; height: number };

export interface GifSettings {
  delay: number; // мс на кадр
  quality: number; // 1..100 — размер палитры
  repeat: number; // 0 = бесконечно
  colorLock?: boolean;
  targetColor?: string; // #rrggbb
}

export function le16(value: number) {
  return [value & 255, (value >> 8) & 255];
}

export function hexToRgb(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbDistance(a: number[], b: number[]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function createPalette(
  frames: RgbaFrame[],
  quality: number,
  target: ReturnType<typeof hexToRgb>,
  lock: boolean,
): number[][] {
  const buckets = new Set<number>();
  for (const frame of frames) {
    const data = frame.data;
    for (let pixel = 0; pixel < data.length; pixel += 4) {
      if (data[pixel + 3] < 8) continue;
      buckets.add(((data[pixel] >> 3) << 10) | ((data[pixel + 1] >> 3) << 5) | (data[pixel + 2] >> 3));
    }
  }
  const maxColors = Math.max(2, Math.min(256, Math.round((quality / 100) * 256)));
  const list: number[][] = [];
  // При colorLock целевой цвет занимает индекс 0 — пиксели «замка» мапятся ровно на него.
  if (lock && target) list.push([target.r, target.g, target.b]);
  const sortedBuckets = Array.from(buckets).sort((a, b) => a - b);
  for (const bucket of sortedBuckets) {
    if (list.length >= maxColors) break;
    list.push([(bucket >> 10 & 31) * 255 / 31, (bucket >> 5 & 31) * 255 / 31, (bucket & 31) * 255 / 31].map(Math.round));
  }
  if (list.length > maxColors) list.length = maxColors;
  if (list.length < 1) list.push([0, 0, 0]);
  return list;
}

export function makeLzw(indexes: Uint8Array): Uint8Array {
  // GIF LZW с переменной шириной кода (minCodeSize = 8 по умолчанию для 256 цветов)
  let codeSize = 8;
  let nextCode = 256 + 1; // +1 — end-of-data код после таблицы
  const clearCode = 256;
  let dict = new Map<number, number>();
  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 255);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  let current = indexes[0];
  for (let i = 1; i < indexes.length; i += 1) {
    const next = indexes[i];
    const key = (current << 8) | next;
    const existing = dict.get(key);
    if (existing !== undefined) {
      current = existing;
    } else {
      emit(current);
      if (nextCode < 4096) {
        dict.set(key, nextCode);
        nextCode += 1;
        // Следующий код будет записан в таблицу под этим номером: ширина растёт,
        // когда следующий код переполняет текущую ширину (классический вариант GIF).
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      } else {
        emit(clearCode);
        dict = new Map();
        codeSize = 8;
        nextCode = 257;
      }
      current = next;
    }
  }
  emit(current);
  emit(nextCode); // End Of Information = последний свободный код после таблицы
  if (bitCount > 0) out.push(bitBuffer & 255);
  return Uint8Array.from(out);
}

export function encodeGif(
  frames: RgbaFrame[],
  settings: GifSettings,
  onProgress?: (value: number) => void,
): { bytes: Uint8Array; width: number; height: number } {
  if (!frames.length) throw new Error('Нет кадров для кодирования');
  const width = frames[0].width;
  const height = frames[0].height;
  const target = settings.targetColor ? hexToRgb(settings.targetColor) : null;
  const realColors = createPalette(frames, settings.quality, target, !!settings.colorLock);

  // Есть ли в кадрах прозрачные пиксели? Если да — добавляем резервный цвет и
  // объявляем его transparency index в GCE (индекс 0 при отсутствии colorLock).
  let hasAlpha = false;
  outer: for (const frame of frames) {
    for (let pixel = 3; pixel < frame.data.length; pixel += 4) {
      if (frame.data[pixel] < 128) { hasAlpha = true; break outer; }
    }
  }
  const lockFirst = !!settings.colorLock && !!target;
  // Прозрачный пиксель обязан иметь СВОЙ уникальный индекс в палитре — иначе он
  // «красит» дыру цветом совпадающего индекса (классический баг чёрных пятен).
  // slot=0 резервируется под прозрачность, если целевой цвет замка не занял его.
  const maxColors = Math.max(2, Math.min(256, Math.round((settings.quality / 100) * 256)));
  let colors = realColors;
  let transparentIndex: number | null = null;
  let palette: number[][];
  if (hasAlpha) {
    if (maxColors < 2) {
      palette = colors; // палитра из 1 цвета — прозрачность не поддерживаем
    } else if (lockFirst) {
      // индекс 0 занят целевым цветом → резерв прозрачности в конце
      if (colors.length >= maxColors) colors = colors.slice(0, maxColors - 1);
      transparentIndex = colors.length;
      palette = [...colors, [0, 0, 0]];
    } else {
      // резервируем индекс 0 под прозрачность, реальные цвета со сдвигом +1
      if (colors.length > maxColors - 1) colors = colors.slice(0, maxColors - 1);
      transparentIndex = 0;
      palette = [[0, 0, 0], ...colors];
    }
  } else {
    palette = colors;
  }
  const alphaShift = hasAlpha && !lockFirst && palette.length === colors.length + 1 ? 1 : 0;

  const bucketIndexes = new Uint8Array(32768);
  for (let bucket = 0; bucket < bucketIndexes.length; bucket += 1) {
    const color = [(bucket >> 10 & 31) * 255 / 31, (bucket >> 5 & 31) * 255 / 31, (bucket & 31) * 255 / 31];
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < colors.length; index += 1) {
      const nextDistance = rgbDistance(color, colors[index]);
      if (nextDistance < distance) { distance = nextDistance; closest = index; }
    }
    bucketIndexes[bucket] = closest + alphaShift;
  }

  const paletteBytes = new Uint8Array(palette.length * 3);
  palette.forEach((c, i) => { paletteBytes[i * 3] = c[0]; paletteBytes[i * 3 + 1] = c[1]; paletteBytes[i * 3 + 2] = c[2]; });
  const bitsPerPixel = Math.max(1, Math.ceil(Math.log2(palette.length)) || 1);
  const paletteSize = 1 << bitsPerPixel;
  const fullPalette = new Uint8Array(paletteSize * 3);
  fullPalette.set(paletteBytes);

  const chunks: Uint8Array[] = [];
  const push = (...parts: (Uint8Array | number[])[]) => {
    for (const p of parts) {
      chunks.push(p instanceof Uint8Array ? p : Uint8Array.from(p));
    }
  };

  // Header + Logical Screen Descriptor
  push(new TextEncoder().encode('GIF89a'), le16(width), le16(height));
  const sizeFlag = bitsPerPixel - 1; // paletteSize = 2^(sizeFlag+1)
  const gctFlags = 0x80 | sizeFlag; // GCT present, color resolution=8, не интерлейс
  push([gctFlags, 0, 0], fullPalette);

  // Netscape loop extension
  const repeat = settings.repeat === 0 ? 0 : settings.repeat;
  push([0x21, 0xff, 0x0b], new TextEncoder().encode('NETSCAPE2.0'), [0x03, 0x01, ...le16(repeat), 0x00]);

  const totalPixels = width * height;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    const indexes = new Uint8Array(totalPixels);
    for (let pixel = 0, index = 0; index < totalPixels; pixel += 4, index += 1) {
      const r = frame.data[pixel];
      const g = frame.data[pixel + 1];
      const b = frame.data[pixel + 2];
      const a = frame.data[pixel + 3];
      if (settings.colorLock && target && Math.abs(r - target.r) <= 2 && Math.abs(g - target.g) <= 2 && Math.abs(b - target.b) <= 2) {
        indexes[index] = 0;
      } else if (a < 128) {
        indexes[index] = transparentIndex ?? 0;
      } else {
        indexes[index] = bucketIndexes[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
      }
    }
    const lzw = makeLzw(indexes);
    const delay = Math.max(2, Math.min(6000, Math.round(settings.delay / 10)));
    // Graphics Control Extension: disposal=1 (do not dispose)
    const gceFlags = transparentIndex !== null ? 0x09 : 0x01; // бит 0 — transparency flag
    push([0x21, 0xf9, 0x04, gceFlags, ...le16(delay), transparentIndex ?? 0, 0x00]);
    // Image Descriptor
    push([0x2c], le16(0), le16(0), le16(width), le16(height), [0x00]);
    // LZW data в sub-block'ах ≤255 байт
    push([8]);
    for (let offset = 0; offset < lzw.length; offset += 255) {
      const part = lzw.subarray(offset, offset + 255);
      push([part.length], part);
    }
    push([0]);
    onProgress?.(Math.round(((frameIndex + 1) / frames.length) * 100));
  }
  push([0x3b]);

  let length = 0;
  for (const c of chunks) length += c.length;
  const bytes = new Uint8Array(length);
  let writeOffset = 0;
  for (const c of chunks) { bytes.set(c, writeOffset); writeOffset += c.length; }
  return { bytes, width, height };
}
