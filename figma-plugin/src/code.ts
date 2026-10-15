// Код плагина (main): работает в sandbox Figma, без DOM.
// Собирается esbuild'ом в dist/code.js. Типы @figma/plugin-typings подключаются через tsconfig.

const MIN_DELAY = 10; // мс — меньше FigJam/браузеры не гарантируют
const MAX_DELAY = 30000;
const MAX_FRAMES = 300;
const MAX_PIXELS = 4_000_000; // ограничение памяти на кадр

type PluginFrameMeta = {
  index: number;
  name: string;
  width: number;
  height: number;
  bytes: number;
};

function clampDelay(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.round(n)));
}

function postUi(message: Record<string, unknown>) {
  figma.ui.postMessage(message);
}

async function exportNode(node: SceneNode, scale: number): Promise<Uint8Array> {
  const bytes = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale },
  });
  return bytes;
}

// Инкрементальный экспорт кадров: по одному, с прогрессом и возможностью отмены.
let cancelled = false;

async function collectFrames(nodes: SceneNode[], scale: number) {
  const frames: { bytes: Uint8Array; meta: PluginFrameMeta }[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (cancelled) return { frames, cancelled: true };
    const node = nodes[index];
    try {
      const bytes = await exportNode(node, scale);
      frames.push({ bytes, meta: { index, name: node.name, width: node.width, height: node.height, bytes: byteLength(bytes) } });
      postUi({ type: 'export-progress', index, total: nodes.length });
    } catch (error) {
      postUi({
        type: 'warning',
        text: `Пропущен слой «${node.name}»: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { frames, cancelled: false };
}

function byteLength(bytes: Uint8Array): number {
  return bytes.byteLength;
}

function getSelectedNodes(): SceneNode[] | null {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    postUi({ type: 'error', text: 'Выделите кадры — слои или фреймы на странице.' });
    return null;
  }
  // Если выделен один фрейм-контейнер — считаем его детьми покадровую анимацию.
  if (selection.length === 1) {
    const only = selection[0];
    if ('children' in only && (only.type === 'FRAME' || only.type === 'GROUP')) {
      const children = (only as FrameNode | GroupNode).children.filter(
        (child) => child.visible && child.width > 0 && child.height > 0,
      );
      if (children.length >= 2) return children;
    }
  }
  return [...selection];
}

figma.on('selectionchange', () => {
  const nodes = figma.currentPage.selection;
  postUi({
    type: 'selection',
    count: nodes.length,
    names: nodes.slice(0, 5).map((n) => n.name),
  });
});

figma.showUI(__html__, { width: 360, height: 520, themeColors: true });

figma.ui.onmessage = async (msg: { type: string; [key: string]: unknown }) => {
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }

  if (msg.type === 'scan') {
    cancelled = false;
    const nodes = getSelectedNodes();
    if (!nodes) return;
    const scale = Math.max(0.1, Math.min(4, Number(msg.scale) || 1));
    const totalPixels = nodes.reduce((sum, n) => sum + n.width * scale * (n.height * scale), 0);
    if (nodes.length > MAX_FRAMES) {
      postUi({ type: 'error', text: `Слишком много кадров (${nodes.length}). Максимум ${MAX_FRAMES}.` });
      return;
    }
    if (totalPixels > MAX_PIXELS * nodes.length) {
      postUi({ type: 'error', text: 'Кадры слишком большие — уменьшите масштаб.' });
      return;
    }
    const first = nodes[0];
    const mismatched = nodes.filter((n) => Math.abs(n.width - first.width) > 0.5 || Math.abs(n.height - first.height) > 0.5);
    if (mismatched.length) {
      postUi({
        type: 'warning',
        text: `Размеры кадров отличаются: «${mismatched[0].name}» ${Math.round(mismatched[0].width)}×${Math.round(mismatched[0].height)} против ${Math.round(first.width)}×${Math.round(first.height)}. Все кадры будут приведены к размеру первого.`,
      });
    }
    const { frames, cancelled: wasCancelled } = await collectFrames(nodes, scale);
    if (wasCancelled || !frames.length) {
      if (!wasCancelled) postUi({ type: 'error', text: 'Не удалось экспортировать ни одного кадра.' });
      return;
    }
    // Передаём в UI как массивы чисел (structured clone Uint8Array между sandbox и iframe нестабилен на некоторых версиях)
    postUi({
      type: 'frames-ready',
      scale,
      frames: frames.map((f) => ({
        meta: f.meta,
        buffer: Array.from(f.bytes),
      })),
    });
    return;
  }

  if (msg.type === 'insert-result') {
    // msg.bytes — числа из UI, пересобираем в Uint8Array и вставляем как изображение
    const bytes = Uint8Array.from(msg.bytes as number[]);
    const name = String(msg.name ?? 'animation.gif');
    const image = figma.createImage(bytes);
    const rect = (msg.rect as { x: number; y: number; width: number; height: number }) ?? null;
    const rectangle = figma.createRectangle();
    rectangle.name = name;
    rectangle.resize(rect?.width ?? 320, rect?.height ?? 320);
    rectangle.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
    if (rect) {
      rectangle.x = rect.x;
      rectangle.y = rect.y;
    } else {
      const bounds = figma.currentPage.selection[0] ?? null;
      rectangle.x = bounds ? bounds.x + bounds.width + 40 : 0;
      rectangle.y = bounds ? bounds.y : 0;
    }
    figma.currentPage.appendChild(rectangle);
    figma.currentPage.selection = [rectangle];
    figma.viewport.scrollAndZoomIntoView([rectangle]);
    postUi({ type: 'inserted', hash: image.hash });
    return;
  }

  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
};
