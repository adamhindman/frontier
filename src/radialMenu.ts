import * as THREE from "three";
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from "./constants";
import { canvasCoordsToTile } from "./coordinates";

export interface RadialItem {
  label: string;
  action?: () => void;
  children?: RadialItem[];
  disabled?: boolean;
}

const COL_W      = 210;
const ITEM_H     = 36;
const GAP        = 32;   // px between player and right edge of column
const STAGGER_MS = 28;   // delay between each item appearing
const SLIDE_MS   = 160;  // item slide+fade duration
const SUB_MS     = 120;  // submenu crossfade duration

function getContentRect(el: HTMLCanvasElement) {
  const r = el.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

function tileToScreen(tileX: number, tileY: number, camera: THREE.OrthographicCamera, canvas: HTMLCanvasElement) {
  const worldX = (tileX + 0.5) * TILE_SIZE;
  const worldY = -(tileY + 0.5) * TILE_SIZE;
  const cr = getContentRect(canvas);
  return {
    x: cr.x + (0.5 + (worldX - camera.position.x) / CANVAS_WIDTH)  * cr.w,
    y: cr.y + (0.5 - (worldY - camera.position.y) / CANVAS_HEIGHT) * cr.h,
  };
}

export function createRadialMenu(
  canvas: HTMLCanvasElement,
  camera: THREE.OrthographicCamera,
  getItems: (tileX: number, tileY: number) => RadialItem[],
  clickEnabled?: () => boolean,
  onClose?: () => void,
) {
  // Outer container — fixed, full viewport, click-through by default.
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1001;display:none;";
  document.body.appendChild(container);

  // Column panel — visible box, pointer-events on.
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: absolute;
    width: ${COL_W}px;
    background: rgba(14,14,14,0.96);
    border: 1px solid rgba(255,255,255,0.13);
    border-radius: 5px;
    overflow: hidden;
    pointer-events: auto;
    box-shadow: 0 4px 24px rgba(0,0,0,0.6);
  `;
  container.appendChild(panel);

  // Stack of item arrays: [root, submenu, …]
  let itemStack: RadialItem[][] = [];
  let anchorX = 0, anchorY = 0;
  let renderedItems: RadialItem[] = [];
  let selectedIdx = -1;

  function getRows() { return Array.from(panel.children) as HTMLDivElement[]; }

  function setSelected(i: number) {
    const rows = getRows();
    if (selectedIdx >= 0 && rows[selectedIdx]) {
      const prev = rows[selectedIdx];
      const prevItem = renderedItems[selectedIdx];
      const prevBack = prevItem?.label === '← Back';
      prev.style.background = '';
      prev.style.color = prevItem?.disabled ? '#555' : prevBack ? '#888' : '#d0d0d0';
    }
    selectedIdx = i;
    if (i >= 0 && rows[i]) {
      rows[i].style.background = 'rgba(80,80,80,0.95)';
      rows[i].style.color = '#fff';
    }
  }

  function moveSelection(delta: number) {
    const rows = getRows();
    if (!rows.length) return;
    let next = selectedIdx < 0 ? (delta > 0 ? 0 : rows.length - 1) : selectedIdx + delta;
    next = ((next % rows.length) + rows.length) % rows.length;
    // Skip disabled rows.
    let attempts = rows.length;
    while (renderedItems[next]?.disabled && attempts-- > 0) {
      next = ((next + delta + rows.length) % rows.length);
    }
    setSelected(next);
  }

  function isOpen() { return itemStack.length > 0; }

  function positionPanel(px: number, py: number) {
    const colH = renderedItems.length * ITEM_H;
    let left = px - COL_W - GAP;
    if (left < 8) left = px + GAP;          // flip right if off-screen left
    let top  = py - colH / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - colH - 8));
    panel.style.left = `${left}px`;
    panel.style.top  = `${top}px`;
  }

  function renderItems(items: RadialItem[], direction: 'in' | 'left' | 'right' = 'in') {
    // Prepend a back item when inside a submenu.
    const hasBack = itemStack.length > 1;
    const backItem: RadialItem = { label: '← Back', action: undefined };
    const displayItems = hasBack ? [backItem, ...items] : items;
    renderedItems = displayItems;

    // Build new rows off-screen, then swap.
    let badgeCounter = 0;
    const rows = displayItems.map((item, i) => {
      const hasChildren = !!item.children?.length;
      const isDisabled  = !!item.disabled;
      const isBack      = item.label === '← Back';

      const row = document.createElement("div");
      row.style.cssText = `
        display: flex;
        align-items: center;
        height: ${ITEM_H}px;
        padding: 0 14px;
        gap: 9px;
        color: ${isDisabled ? '#555' : isBack ? '#888' : '#d0d0d0'};
        font: 12px/1 monospace;
        cursor: ${isDisabled ? 'default' : 'pointer'};
        pointer-events: ${isDisabled ? 'none' : 'auto'};
        border-top: ${i > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none'};
        user-select: none;
        opacity: 0;
        transform: translateX(${direction === 'right' ? '18px' : direction === 'left' ? '-18px' : '-12px'});
        transition:
          opacity ${SLIDE_MS}ms ease-out ${i * STAGGER_MS}ms,
          transform ${SLIDE_MS}ms ease-out ${i * STAGGER_MS}ms,
          background 0.08s;
      `;

      if (!isBack) {
        // Badge assigned to every non-Back item (including disabled) so the
        // number is consistent regardless of which items are currently enabled.
        const badge = document.createElement("span");
        badge.textContent = String(++badgeCounter);
        badge.style.cssText = `
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          font-size: 10px;
          font-weight: bold;
          color: ${isDisabled ? '#444' : '#aaa'};
          background: rgba(255,255,255,${isDisabled ? '0.04' : '0.08'});
          border: 1px solid rgba(255,255,255,${isDisabled ? '0.08' : '0.18'});
          border-bottom: 2px solid rgba(255,255,255,${isDisabled ? '0.05' : '0.12'});
          border-radius: 3px;
          flex-shrink: 0;
        `;
        row.appendChild(badge);
      }

      const label = document.createElement("span");
      label.textContent = item.label + (hasChildren ? ' ›' : '');
      label.style.flex = '1';
      row.appendChild(label);

      if (!isDisabled) {
        row.addEventListener("mouseenter", () => {
          setSelected(i);
          row.style.background = "rgba(55,55,55,0.95)";
          row.style.color      = "#fff";
        });
        row.addEventListener("mouseleave", () => {
          if (selectedIdx === i) {
            row.style.background = "rgba(55,55,55,0.95)";
            row.style.color      = "#fff";
          }
        });
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isBack) {
            itemStack.pop();
            renderItems(itemStack[itemStack.length - 1], 'left');
          } else if (hasChildren) {
            itemStack.push(item.children!);
            renderItems(item.children!, 'right');
          } else if (item.action) {
            item.action();
            closeAll();
          }
        });
      }

      return row;
    });

    selectedIdx = -1;
    panel.innerHTML = '';
    rows.forEach(r => panel.appendChild(r));
    positionPanel(anchorX, anchorY);

    // Trigger animation next frame.
    requestAnimationFrame(() => {
      rows.forEach(r => {
        r.style.opacity   = '1';
        r.style.transform = 'translateX(0)';
      });
    });
  }

  function open(px: number, py: number, items: RadialItem[]) {
    anchorX = px;
    anchorY = py;
    itemStack = [items];
    container.style.display = 'block';
    renderItems(items, 'in');
  }

  function closeAll() {
    const wasOpen = itemStack.length > 0;
    itemStack = [];
    container.style.display = 'none';
    panel.innerHTML = '';
    if (wasOpen) onClose?.();
  }

  function closeTop() {
    if (!itemStack.length) return;
    if (itemStack.length === 1) {
      closeAll();
    } else {
      itemStack.pop();
      renderItems(itemStack[itemStack.length - 1], 'left');
    }
  }

  // --- Events ---

  canvas.addEventListener("click", (e) => {
    if (isOpen()) return;
    if (clickEnabled && !clickEnabled()) return;

    const cr = getContentRect(canvas);
    const lx = e.clientX - cr.x, ly = e.clientY - cr.y;
    if (lx < 0 || lx > cr.w || ly < 0 || ly > cr.h) return;

    const { tileX, tileY } = canvasCoordsToTile(
      (lx / cr.w) * CANVAS_WIDTH,
      (ly / cr.h) * CANVAS_HEIGHT,
      camera.position.x,
      camera.position.y,
    );

    const items = getItems(tileX, tileY);
    if (!items.length) return;

    const pos = tileToScreen(tileX, tileY, camera, canvas);
    open(pos.x, pos.y, items);
    e.stopPropagation();
  });

  function openAtTile(tileX: number, tileY: number) {
    if (isOpen()) { closeAll(); return; }
    const items = getItems(tileX, tileY);
    if (!items.length) return;
    const pos = tileToScreen(tileX, tileY, camera, canvas);
    open(pos.x, pos.y, items);
  }

  window.addEventListener("click", (e) => {
    if (!isOpen()) return;
    if (!panel.contains(e.target as Node)) closeAll();
  });

  window.addEventListener("keydown", (e) => {
    if (!isOpen()) return;

    if (e.key === "Escape" || e.key === " ") {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeAll();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopImmediatePropagation();
      moveSelection(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      moveSelection(-1);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (selectedIdx >= 0) getRows()[selectedIdx]?.click();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeTop();
      return;
    }

    const num = parseInt(e.key, 10);
    if (!isNaN(num) && num >= 1) {
      // Walk non-Back items by position (matching badge assignment).
      // Skip only the Back item when counting; disabled items keep their slot
      // but the key press is ignored when that slot is disabled.
      const rows = getRows();
      let count = 0;
      for (let i = 0; i < renderedItems.length; i++) {
        if (renderedItems[i].label === '← Back') continue;
        if (++count === num) {
          if (!renderedItems[i].disabled) { e.preventDefault(); rows[i]?.click(); }
          break;
        }
      }
    }
  });

  window.addEventListener("blur", closeAll);

  return { isOpen, closeAll, openAtTile };
}
