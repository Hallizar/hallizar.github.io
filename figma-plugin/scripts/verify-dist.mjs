// Проверка результата сборки: dist/code.js и dist/ui.html пригодны для Figma.
// Запуск: node figma-plugin/scripts/verify-dist.mjs (или npm run verify в figma-plugin)
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(dirname(fileURLToPath(import.meta.url))); // figma-plugin/
const errors = [];

// manifest должен указывать на dist-файлы, которые реально существуют
const manifest = JSON.parse(await readFile(resolve(here, 'manifest.json'), 'utf8'));
for (const field of ['main', 'ui']) {
  const p = resolve(here, manifest[field]);
  try {
    await readFile(p);
  } catch {
    errors.push(`manifest.${field} -> "${manifest[field]}" не найден (нужно запустить npm run build)`);
  }
}

// sandbox-код: без import/export/DOM-глобалов
const codeJs = await readFile(resolve(here, 'dist/code.js'), 'utf8');
if (/\b(?:import|export)\s/.test(codeJs)) errors.push('dist/code.js содержит import/export — Figma sandbox их не поддерживает');
if (/\bdocument\b|\bwindow\b/.test(codeJs)) errors.push('dist/code.js обращается к document/window — в sandbox этого нет');

// UI: скрипт должен быть инлайном (Figma грузит один html-файл)
const uiHtml = await readFile(resolve(here, 'dist/ui.html'), 'utf8');
if (/<script[^>]+src=/.test(uiHtml)) errors.push('dist/ui.html ссылается на внешний <script src=...> — инлайн не выполнен');
if (!/<script>[\s\S]{100,}<\/script>/.test(uiHtml)) errors.push('dist/ui.html: инлайновый скрипт пуст или отсутствует');

if (errors.length) {
  console.error('figma-plugin verify: ПРОВАЛ:');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('figma-plugin verify: OK (manifest, dist/code.js, dist/ui.html)');
