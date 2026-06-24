import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { canvasCoordsToTile } from './coordinates';

export interface RadialItem {
  label: string;
  action?: () => void;
  children?: RadialItem[];
  disabled?: boolean;
}

const RADIUS  = 110;
const BTN_H   = 44;
const ANIM_MS = 180;
const LEAD_MS = 70; // circle leads the buttons by this many ms

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

interface MenuLevel {
  div: HTMLDivElement;
  btns: HTMLDivElement[];
  ring: SVGCircleElement;
  items: RadialItem[];
  openedBy: number;
  expandedChild: number;
}

export function createRadialMenu(
  canvas: HTMLCanvasElement,
  camera: THREE.OrthographicCamera,
  getItems: (tileX: number, tileY: number) => RadialItem[],
) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1001;display:none;';
  document.body.appendChild(container);

  let stack: MenuLevel[] = [];

  // --- Style helpers ---

  function defaultBorderColor(hasChildren: boolean) {
    return hasChildren ? 'rgba(255,200,80,0.45)' : 'rgba(255,255,255,0.2)';
  }

  function applyDefault(btn: HTMLDivElement, hasChildren: boolean) {
    btn.style.background  = 'rgba(20,20,20,0.88)';
    btn.style.borderColor = defaultBorderColor(hasChildren);
    btn.style.color       = '#d0d0d0';
  }

  function applySelected(btn: HTMLDivElement) {
    btn.style.background  = 'rgba(50,50,50,0.92)';
    btn.style.borderColor = 'rgba(255,255,255,0.5)';
    btn.style.color       = '#ffffff';
  }

  // --- Stack management ---

  function restoreParent(level: MenuLevel) {
    level.btns.forEach(b => {
      b.style.opacity       = '1';
      b.style.pointerEvents = 'auto';
    });
    level.ring.style.opacity = '1';
    if (level.expandedChild >= 0) {
      applyDefault(level.btns[level.expandedChild], !!level.items[level.expandedChild].children?.length);
    }
    level.expandedChild = -1;
  }

  function popTopRaw() {
    const closed = stack.pop()!;
    closed.div.remove();
    if (stack.length > 0) restoreParent(stack[stack.length - 1]);
  }

  function closeTop() {
    if (!stack.length) return;
    const closed = stack.pop()!;
    closed.div.remove();
    if (stack.length > 0) {
      restoreParent(stack[stack.length - 1]);
    } else {
      container.style.display = 'none';
    }
  }

  function closeAll() {
    container.innerHTML = '';
    stack = [];
    container.style.display = 'none';
  }

  // --- Level construction ---

  function pushLevel(cx: number, cy: number, items: RadialItem[], openedBy = -1, spawnX = cx, spawnY = cy) {
    if (stack.length > 0 && openedBy >= 0) {
      const parent = stack[stack.length - 1];
      parent.btns.forEach((b, i) => {
        b.style.opacity       = i === openedBy ? '1' : '0.15';
        b.style.pointerEvents = i === openedBy ? 'auto' : 'none';
      });
      parent.ring.style.opacity = '0.15';
    }

    const levelDiv = document.createElement('div');
    levelDiv.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    container.appendChild(levelDiv);

    // SVG ring — behind buttons in DOM order, starts collapsed at circle center.
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx',           String(cx));
    ring.setAttribute('cy',           String(cy));
    ring.setAttribute('r',            String(RADIUS));
    ring.setAttribute('fill',         'none');
    ring.setAttribute('stroke',       'rgba(0,0,0,0.28)');
    ring.setAttribute('stroke-width', '1');
    ring.style.cssText = 'transform-box:fill-box;transform-origin:center;transform:scale(0);opacity:0;';
    svg.appendChild(ring);
    levelDiv.appendChild(svg);

    const myIndex = stack.length;
    const level: MenuLevel = { div: levelDiv, btns: [], ring, items, openedBy, expandedChild: -1 };
    const btnsForAnim: HTMLDivElement[] = [];

    const arcStart = -Math.PI / 2; // item 1 at 12 o'clock
    for (let i = 0; i < items.length; i++) {
      const angle = arcStart + (i / items.length) * Math.PI * 2;
      const bx    = cx + Math.cos(angle) * RADIUS;
      const by    = cy + Math.sin(angle) * RADIUS;
      const item  = items[i];
      const hasChildren = !!item.children?.length;

      const isDisabled = !!item.disabled;

      const btn = document.createElement('div');
      btn.innerHTML = `<span style="opacity:0.45;font-size:10px;margin-right:5px">${i + 1}</span>${item.label}${hasChildren ? ' ›' : ''}`;
      btn.style.cssText = `
        position: absolute;
        left: ${bx}px;
        top:  ${by}px;
        height: ${BTN_H}px;
        padding: 0 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(20,20,20,0.88);
        color: ${isDisabled ? '#555' : '#d0d0d0'};
        font: 12px/1.3 monospace;
        border: 1px solid ${isDisabled ? 'rgba(255,255,255,0.07)' : defaultBorderColor(hasChildren)};
        border-radius: 6px;
        text-align: center;
        pointer-events: ${isDisabled ? 'none' : 'auto'};
        cursor: ${isDisabled ? 'default' : 'pointer'};
        user-select: none;
        white-space: nowrap;
        opacity: 0;
        transform: translate(calc(-50% + ${spawnX - bx}px), calc(-50% + ${spawnY - by}px));
      `;

      if (!isDisabled) {
        btn.addEventListener('mouseenter', () => {
          btn.style.background  = 'rgba(70,70,70,0.95)';
          btn.style.borderColor = 'rgba(255,255,255,0.65)';
          btn.style.color       = '#ffffff';
        });
        btn.addEventListener('mouseleave', () => {
          if (level.expandedChild === i) applySelected(btn);
          else applyDefault(btn, hasChildren);
        });
      }

      btn.addEventListener('click', (e) => {
        if (isDisabled) return;
        e.stopPropagation();

        if (hasChildren) {
          const subOpenForMe = stack.length > myIndex + 1 && stack[myIndex + 1].openedBy === i;

          if (subOpenForMe) {
            closeTop();
          } else {
            while (stack.length > myIndex + 1) popTopRaw();

            if (level.expandedChild >= 0 && level.expandedChild !== i) {
              applyDefault(level.btns[level.expandedChild], !!level.items[level.expandedChild].children?.length);
            }
            level.expandedChild = i;
            applySelected(btn);

            const r   = btn.getBoundingClientRect();
            const cx2 = r.left + r.width  / 2;
            const cy2 = r.top  + r.height / 2;
            pushLevel(cx2, cy2, item.children!, i, cx2, cy2);
          }
        } else if (item.action) {
          item.action();
          closeAll();
        }
      });

      levelDiv.appendChild(btn);
      level.btns.push(btn);
      btnsForAnim.push(btn);
    }

    stack.push(level);
    container.style.display = 'block';

    // Commit initial state, then animate: circle first, buttons after LEAD_MS.
    void levelDiv.offsetHeight;

    ring.style.transition = `transform ${ANIM_MS}ms ease-out, opacity ${ANIM_MS}ms ease-out`;
    ring.style.transform  = 'scale(1)';
    ring.style.opacity    = '1';

    btnsForAnim.forEach(b => {
      b.style.transition = `transform ${ANIM_MS}ms ease-out ${LEAD_MS}ms, opacity ${ANIM_MS}ms ease-out ${LEAD_MS}ms, background 0.08s, border-color 0.08s, color 0.08s`;
      b.style.transform  = 'translate(-50%, -50%)';
      b.style.opacity    = '1';
    });
  }

  // --- Events ---

  canvas.addEventListener('click', (e) => {
    if (stack.length > 0) return;

    const cr = getContentRect(canvas);
    const lx = e.clientX - cr.x, ly = e.clientY - cr.y;
    if (lx < 0 || lx > cr.w || ly < 0 || ly > cr.h) return;

    const { tileX, tileY } = canvasCoordsToTile(
      (lx / cr.w) * CANVAS_WIDTH,
      (ly / cr.h) * CANVAS_HEIGHT,
      camera.position.x, camera.position.y,
    );

    const items = getItems(tileX, tileY);
    if (!items.length) return;

    const pos = tileToScreen(tileX, tileY, camera, canvas);
    pushLevel(pos.x, pos.y, items, -1, pos.x, pos.y);
    e.stopPropagation();
  });

  function openAtTile(tileX: number, tileY: number) {
    if (stack.length > 0) { closeAll(); return; }
    const items = getItems(tileX, tileY);
    if (!items.length) return;
    const pos = tileToScreen(tileX, tileY, camera, canvas);
    pushLevel(pos.x, pos.y, items, -1, pos.x, pos.y);
  }

  window.addEventListener('click', () => { if (stack.length > 0) closeTop(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length > 0) { closeTop(); return; }

    // Number keys activate the corresponding button in the top-most level.
    const num = parseInt(e.key, 10);
    if (!isNaN(num) && num >= 1 && stack.length > 0) {
      const top = stack[stack.length - 1];
      const idx = num - 1;
      if (idx < top.btns.length) {
        e.preventDefault();
        top.btns[idx].click();
      }
    }
  });
  window.addEventListener('blur', closeAll);

  return { isOpen: () => stack.length > 0, closeAll, openAtTile };
}
