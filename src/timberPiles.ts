import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

interface TimberPile {
  tileX: number;
  tileY: number;
  amount: number;
  el: HTMLDivElement;
  tooltipEl: HTMLDivElement;
}

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

const PLACE_OFFSETS = [[0,1],[1,0],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[0,0]] as const;

export class TimberPileManager {
  private piles: TimberPile[] = [];
  private canvas: HTMLCanvasElement;
  private camera: THREE.OrthographicCamera;

  constructor(canvas: HTMLCanvasElement, camera: THREE.OrthographicCamera) {
    this.canvas = canvas;
    this.camera = camera;
  }

  // Add timber near a position. Merges with existing adjacent pile or places a new one.
  addAmount(nearTileX: number, nearTileY: number, amount: number, isWater?: (tx: number, ty: number) => boolean) {
    const existing = this.piles.find(p =>
      Math.abs(p.tileX - nearTileX) <= 1 && Math.abs(p.tileY - nearTileY) <= 1
    );
    if (existing) {
      existing.amount += amount;
      this.updateTooltip(existing);
      return;
    }
    const found = PLACE_OFFSETS.find(([dx, dy]) => !isWater?.(nearTileX + dx, nearTileY + dy));
    const [ox, oy] = found ?? [0, 1];
    this.createPile(nearTileX + ox, nearTileY + oy, amount);
  }

  // Total timber within 1 tile (8-directional + same tile).
  getAdjacentAmount(tileX: number, tileY: number): number {
    return this.piles
      .filter(p => Math.abs(p.tileX - tileX) <= 1 && Math.abs(p.tileY - tileY) <= 1)
      .reduce((sum, p) => sum + p.amount, 0);
  }

  // Consume `amount` from adjacent piles, nearest first.
  consumeFromAdjacent(tileX: number, tileY: number, amount: number) {
    const adjacent = this.piles
      .filter(p => Math.abs(p.tileX - tileX) <= 1 && Math.abs(p.tileY - tileY) <= 1)
      .sort((a, b) =>
        Math.hypot(a.tileX - tileX, a.tileY - tileY) -
        Math.hypot(b.tileX - tileX, b.tileY - tileY)
      );
    let remaining = amount;
    for (const pile of adjacent) {
      if (remaining <= 0) break;
      const consumed = Math.min(remaining, pile.amount);
      pile.amount -= consumed;
      remaining -= consumed;
      if (pile.amount < 0.001) {
        pile.el.remove();
        pile.tooltipEl.remove();
        this.piles.splice(this.piles.indexOf(pile), 1);
      } else {
        this.updateTooltip(pile);
      }
    }
  }

  getSaveData(): { tileX: number; tileY: number; amount: number }[] {
    return this.piles.map(({ tileX, tileY, amount }) => ({ tileX, tileY, amount }));
  }

  restorePile(tileX: number, tileY: number, amount: number) {
    this.createPile(tileX, tileY, amount);
  }

  private createPile(tileX: number, tileY: number, amount: number) {
    const tooltipEl = document.createElement('div');
    tooltipEl.style.cssText = `
      position: fixed;
      background: rgba(0,0,0,0.82);
      color: #e8e8e8;
      font: 12px/1.6 monospace;
      padding: 5px 10px;
      border-radius: 4px;
      pointer-events: none;
      white-space: pre;
      z-index: 601;
      opacity: 0;
      transition: opacity 0.12s ease;
    `;
    document.body.appendChild(tooltipEl);

    const el = document.createElement('div');
    el.textContent = '🪵';
    el.style.cssText = `
      position: fixed;
      font-size: 20px;
      line-height: 1;
      transform: translate(-50%, -50%);
      pointer-events: auto;
      z-index: 600;
      cursor: default;
      user-select: none;
    `;
    el.addEventListener('mouseenter', () => { tooltipEl.style.opacity = '1'; });
    el.addEventListener('mouseleave', () => { tooltipEl.style.opacity = '0'; });
    el.addEventListener('mousemove', (e) => {
      const tr = tooltipEl.getBoundingClientRect();
      const tx = e.clientX + 14 + tr.width > window.innerWidth ? e.clientX - 14 - tr.width : e.clientX + 14;
      tooltipEl.style.left = `${tx}px`;
      tooltipEl.style.top  = `${e.clientY - 8}px`;
    });
    document.body.appendChild(el);

    const pile: TimberPile = { tileX, tileY, amount, el, tooltipEl };
    this.updateTooltip(pile);
    this.piles.push(pile);
  }

  private updateTooltip(pile: TimberPile) {
    pile.tooltipEl.textContent = `Timber\n${Math.floor(pile.amount)} units`;
  }

  update() {
    const cr = getContentRect(this.canvas);
    for (const pile of this.piles) {
      const worldX = (pile.tileX + 0.5) * TILE_SIZE;
      const worldY = -(pile.tileY + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
      const onScreen = sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h;
      pile.el.style.display = onScreen ? 'block' : 'none';
      pile.el.style.left = `${sx}px`;
      pile.el.style.top  = `${sy}px`;
    }
  }
}
