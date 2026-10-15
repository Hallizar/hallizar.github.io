# Установка плагина «GIF Studio» на свой компьютер

Это **локальный (dev) плагин** — он не публикуется в Figma Community, а подключается
как файл `manifest.json` прямо с диска.

## Шаг 0. Что должно быть в папке

После сборки обязательны эти файлы:

```
figma-plugin/
├── manifest.json     ← его и нужно указывать в Figma
└── dist/
    ├── code.js       ← код плагина (sandbox)
    └── ui.html       ← интерфейс плагина
```

⚠️ В скачанном архиве может **не быть папки `dist/`** (она в `.gitignore`).
Тогда сначала соберите её (шаг 1). Если `dist/` уже есть — сразу к шагу 2.

## Шаг 1. Сборка (нужен Node.js ≥ 18)

Установить Node.js: https://nodejs.org (LTS-версия), если ещё нет.

В терминале / PowerShell / CMD внутри папки `figma-plugin`:

```bash
npm install
npm run build
```

Проверить, что появились `dist/code.js` и `dist/ui.html`.

## Шаг 2. Импорт в Figma

### Desktop-приложение Figma
1. Откройте любой файл в Figma Desktop.
2. Меню **Plugins** → **Development** → **Import plugin from manifest…**
   (или: правой кнопкой на холсте → Plugins → Development → Import plugin from manifest…)
3. В проводнике укажите файл **`manifest.json`** из папки `figma-plugin`.
4. Готово — плагин появится в списке: Plugins → Development → **GIF Studio**.

### Браузерная версия Figma (figma.com)
❌ Импорт плагинов с диска работает **только в Desktop-приложении**.
Если у вас только браузер — установите Figma Desktop App (бесплатно).

## Шаг 3. Запуск

Откройте фрейм/слой → Plugins → Development → GIF Studio.

## Частые проблемы

| Симптом | Причина / решение |
|---|---|
| Figma ругается на манифест / не видит плагин | Указан не тот путь: нужен именно `manifest.json`, а не папка и не `package.json`. |
| Ошибка «Failed to load dist/ui.html» или пустой UI | Не собран `dist/` — выполните `npm install && npm run build`. |
| После правки кода плагин не меняется | Пересоберите (`npm run build`) и перезапустите плагин в Figma (для автопересборки: `npm run watch`). |
| GIF не генерируется / «Worker load failed» | Плагин грузит gif.js/JSZip с CDN (`cdnjs.cloudflare.com` разрешён в `manifest.json → networkAccess`). Проверьте интернет. Если сеть недоступна, плагин автоматически переключится на встроенный кодировщик — генерация всё равно должна работать. |

## Публикация (по желанию)
Чтобы другие ставили плагин без сборки: опубликуйте его через
Figma → Plugins → Development → **Publish plugin** (нужен аккаунт и проверка модерацией).
