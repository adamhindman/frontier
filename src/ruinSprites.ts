import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

function getContentRect(canvas: HTMLCanvasElement) {
  const r  = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else          { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

interface RuinEntry {
  tileX:  number;
  tileY:  number;
  el:     HTMLDivElement;
  wTiles: number; // footprint width in tiles
  hTiles: number; // footprint height in tiles
}

export class RuinSpriteManager {
  private ruins: RuinEntry[] = [];

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera:   THREE.OrthographicCamera,
  ) {}

  addRuin(tileX: number, tileY: number, wTiles: number, hTiles: number): void {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      background: #888;
      pointer-events: none;
      z-index: 620;
      transform: translate(-50%, -50%);
      display: none;
    `;
    document.body.appendChild(el);
    this.ruins.push({ tileX, tileY, el, wTiles, hTiles });
  }

  // Scatter count ruin footprints around (cx, cy) using the supplied rng.
  scatter(cx: number, cy: number, count: number, rng: () => number, radius = 3): void {
    const placed = new Set<string>();
    placed.add(`${cx},${cy}`);

    let n = 0;
    for (let attempt = 0; attempt < 500 && n < count; attempt++) {
      const dx = Math.round((rng() * 2 - 1) * radius);
      const dy = Math.round((rng() * 2 - 1) * radius);
      if (dx === 0 && dy === 0) continue;
      const key = `${cx + dx},${cy + dy}`;
      if (placed.has(key)) continue;
      placed.add(key);
      // Vary footprint size: 1–2 tiles wide, 1–2 tiles tall
      const w = 1 + Math.floor(rng() * 2);
      const h = 1 + Math.floor(rng() * 2);
      this.addRuin(cx + dx, cy + dy, w, h);
      n++;
    }
  }

  getFootprintPositions(): { tileX: number; tileY: number }[] {
    return this.ruins.map(r => ({ tileX: r.tileX, tileY: r.tileY }));
  }

  update(): void {
    const cr    = getContentRect(this.canvasEl);
    const scale = cr.w / CANVAS_WIDTH;

    for (const r of this.ruins) {
      const worldX = (r.tileX + 0.5) * TILE_SIZE;
      const worldY = -(r.tileY + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH) * cr.w;
      const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;

      const pw = r.wTiles * TILE_SIZE * scale;
      const ph = r.hTiles * TILE_SIZE * scale;
      const onScreen = sx + pw >= cr.x && sx - pw <= cr.x + cr.w
                    && sy + ph >= cr.y && sy - ph <= cr.y + cr.h;

      r.el.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        r.el.style.left   = `${sx}px`;
        r.el.style.top    = `${sy}px`;
        r.el.style.width  = `${pw}px`;
        r.el.style.height = `${ph}px`;
      }
    }
  }
}
