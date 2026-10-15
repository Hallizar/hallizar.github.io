// Код плагина (main): работает в sandbox Figma, без DOM.
// Собирается esbuild'ом в dist/code.js. Типы @figma/plugin-typings подключаются через tsconfig.
//
// Протокол (как в эталонном batch-сканере):
//   UI → 'scan-layers'            : просканировать выделение и сгруппировать фреймы по размерам
//   UI → 'render-group'           : отрендерить PNG-кадры конкретной группы (инкрементально)
//   sandbox → 'scan-result'       : массив групп { id: "Name::WxH", name, info, frames[] }
//   sandbox → 'render-data'       : { groupId, framesData: [{ index, name, bytes }] }
// Кадры передаются как Uint8Array — structured clone сохраняет тип, поэтому в UI
// new Blob([bytes]) получает корректный ArrayBuffer (передача number[] ломала декодирование PNG).

const MAX_FRAMES = 300;

type GroupFrame = { id: string; name: string };
type ScannedGroup = { id: string; name: string; info: string; frames: GroupFrame[] };

function postUi(message: Record<string, unknown>) {
  figma.ui.postMessage(message);
}

// Кандидаты в кадры: выделенные фреймы/слои; если выделен один контейнер — его дети.
function getLeafCandidates(): SceneNode[] | null {
  const selection = [...figma.currentPage.selection];
  if (!selection.length) {
    postUi({ type: 'error', text: 'Ничего не выделено. Выделите кадры или контейнер с кадрами.' });
    return null;
  }
  // Разворачиваем верхнеуровневые фреймы/группы в детей, если самих детей ≥2
  // (эталонный сканер работает именно по фреймам внутри выделения).
  const leaves: SceneNode[] = [];
  for (const node of selection) {
    if ((node.type === 'FRAME' || node.type === 'GROUP') && 'children' in node) {
      const children = (node as FrameNode | GroupNode).children.filter(
        (child) => child.visible && child.width > 0 && child.height > 0,
      );
      if (children.length >= 2) {
        leaves.push(...children);
        continue;
      }
    }
    leaves.push(node);
  }
  return leaves;
}

// Группировка по «имя без суффикса» + размер, как в оригинальном сканере:
// имя группы = имя первого фрейма до разделителя размера; id = "Name::WxH".
function roundSize(n: number): number {
  return Math.round(n);
}

function buildGroups(nodes: SceneNode[]): ScannedGroup[] {
  const map = new Map<string, ScannedGroup>();
  for (const node of nodes) {
    const w = roundSize(node.width);
    const h = roundSize(node.height);
    // Имя без хвостовых цифр/слешей — «Screen 3», «Screen 7» → «Screen»
    const baseName = node.name.replace(/[\s_-]*\d+\s*$/, '').trim() || node.name;
    const key = `${baseName}::${w}x${h}`;
    let group = map.get(key);
    if (!group) {
      group = {
        id: key,
        name: baseName,
        info: `${w}×${h}`,
        frames: [],
      };
      map.set(key, group);
    }
    group.frames.push({ id: node.id, name: node.name });
  }
  // Сортировка: сначала мног кадровые группы, затем по имени
  return [...map.values()].sort((a, b) => b.frames.length - a.frames.length || a.name.localeCompare(b.name));
}

let renderCancelled = false;

async function exportNode(node: SceneNode, scale: number): Promise<Uint8Array> {
  return node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
}

figma.showUI(__html__, { width: 420, height: 620, themeColors: true });

figma.ui.onmessage = async (msg: { type: string; [key: string]: unknown }) => {
  if (msg.type === 'cancel') {
    renderCancelled = true;
    return;
  }

  if (msg.type === 'scan-layers') {
    renderCancelled = false;
    const nodes = getLeafCandidates();
    if (!nodes) return;
    if (nodes.length > MAX_FRAMES) {
      postUi({ type: 'error', text: `Слишком много кадров (${nodes.length}). Максимум ${MAX_FRAMES}.` });
      return;
    }
    const groups = buildGroups(nodes);
    postUi({ type: 'scan-result', data: groups });
    return;
  }

  if (msg.type === 'render-group') {
    renderCancelled = false;
    const groupId = String(msg.groupId ?? '');
    const frameIds = msg.frameIds as string[];
    const scale = Math.max(0.1, Math.min(4, Number(msg.settingScale) || 1));

    const framesData: { index: number; name: string; bytes: Uint8Array }[] = [];
    for (let index = 0; index < frameIds.length; index += 1) {
      if (renderCancelled) {
        postUi({ type: 'error', text: 'Рендер отменён.' });
        return;
      }
      const node = await figma.getNodeByIdAsync(frameIds[index]);
      if (!node || !('width' in node)) {
        postUi({ type: 'warning', text: `Слой ${frameIds[index]} не найден — пропущен.` });
        continue;
      }
      try {
        const bytes = await exportNode(node as SceneNode, scale);
        // Uint8Array передаётся через structured clone без потерь (number[] ломал Blob в UI).
        framesData.push({ index, name: node.name, bytes });
        postUi({ type: 'render-progress', index, total: frameIds.length });
      } catch (error) {
        postUi({
          type: 'warning',
          text: `Пропущен слой «${node.name}»: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    if (!framesData.length) {
      postUi({ type: 'error', text: `Не удалось отрендерить кадры группы «${groupId}».` });
      return;
    }
    postUi({ type: 'render-data', groupId, framesData });
    return;
  }

  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
};
