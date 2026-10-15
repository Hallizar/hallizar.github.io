// Мини-версия JSZip: ZIP (STORE, без сжатия) + CRC-32. Достаточно для бандла GIF'ов.
// Работает в браузере (UI плагина), без зависимостей и сети.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

export type ZipEntry = { name: string; data: Uint8Array };

// Возвращает Blob типа application/zip со списком файлов (метод STORE).
export function createZipBlob(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  // DOS timestamp (фиксированный, чтобы не зависеть от часов окружения)
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    writeU32(lv, 0, 0x04034b50); // local file header signature
    writeU16(lv, 4, 20); // version needed
    writeU16(lv, 6, 0x0800); // flags: UTF-8 names
    writeU16(lv, 8, 0); // method: STORE
    writeU16(lv, 10, dosTime);
    writeU16(lv, 12, dosDate);
    writeU32(lv, 14, crc);
    writeU32(lv, 18, entry.data.length);
    writeU32(lv, 22, entry.data.length);
    writeU16(lv, 26, nameBytes.length);
    writeU16(lv, 28, 0);
    local.set(nameBytes, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    writeU32(cv, 0, 0x02014b50); // central directory signature
    writeU16(cv, 4, 20); // version made by
    writeU16(cv, 6, 20); // version needed
    writeU16(cv, 8, 0x0800); // flags: UTF-8
    writeU16(cv, 10, 0); // method STORE
    writeU16(cv, 12, dosTime);
    writeU16(cv, 14, dosDate);
    writeU32(cv, 16, crc);
    writeU32(cv, 20, entry.data.length);
    writeU32(cv, 24, entry.data.length);
    writeU16(cv, 28, nameBytes.length);
    writeU16(cv, 30, 0); // extra
    writeU16(cv, 32, 0); // comment
    writeU16(cv, 34, 0); // disk start
    writeU16(cv, 36, 0); // internal attrs
    writeU32(cv, 38, 0); // external attrs
    writeU32(cv, 42, offset); // relative offset of local header
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + entry.data.length;
  }

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  writeU32(ev, 0, 0x06054b50); // EOCD signature
  writeU16(ev, 8, entries.length);
  writeU16(ev, 10, entries.length);
  writeU32(ev, 12, centralSize);
  writeU32(ev, 16, offset); // central dir offset

  return new Blob(
    [...localParts, ...centralParts, end] as unknown as BlobPart[],
    { type: 'application/zip' },
  );
}
