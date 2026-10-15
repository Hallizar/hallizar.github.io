// Сборка плагина: esbuild bundling + инлайн UI в dist/ui.html.
// Запуск: node figma-plugin/build.mjs
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');
await mkdir(dist, { recursive: true });

// 1. Sandbox-код плагина (без импортов, IIFE)
await build({
  entryPoints: [resolve(here, 'src/code.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2017',
  outfile: resolve(dist, 'code.js'),
});

// 2. UI-скрипт
await build({
  entryPoints: [resolve(here, 'src/ui.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: resolve(dist, 'ui.js'),
});

// 3. Инлайн ui.js в ui.html — Figma требует один файл для поля "ui" в manifest
const html = await readFile(resolve(here, 'src/ui.html'), 'utf8');
const uiJs = await readFile(resolve(dist, 'ui.js'), 'utf8');
const inlined = html.replace('<script src="ui.js"></script>', `<script>\n${uiJs}\n</script>`);
await writeFile(resolve(dist, 'ui.html'), inlined);

console.log('figma-plugin: собрано в figma-plugin/dist (code.js, ui.html)');
