import * as THREE from 'three';
import type { PlayerStats } from './playerStats';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import canoeEmptyUrl from './assets/tiles/canoe-empty.png';

export type StructureType = 'canoe' | 'shelter' | 'campfire';

interface StructureConfig {
  emoji: string;
  totalHours: number;
  label: string;
  timberCost: number;
}

export const CANOE_TIMBER_COST     = 10;
export const SHELTER_TIMBER_COST   = 8;
export const CAMPFIRE_TIMBER_COST  = 0;

export const STRUCTURE_CONFIGS: Record<StructureType, StructureConfig> = {
  canoe:    { emoji: '🛶', totalHours: 24, label: 'Canoe',     timberCost: CANOE_TIMBER_COST    },
  shelter:  { emoji: '🛖', totalHours: 3,  label: 'Shelter',   timberCost: SHELTER_TIMBER_COST  },
  campfire: { emoji: '🔥', totalHours: 1,  label: 'Campfire',  timberCost: CAMPFIRE_TIMBER_COST },
};

// Campfire burns 1 timber unit per this many game-days.
const CAMPFIRE_BURN_INTERVAL_DAYS = 2 / 24;

interface PlacedStructure {
  tileX: number;
  tileY: number;
  type: StructureType;
  complete: boolean;
  progressDays: number;
  burnProgress: number; // game-days elapsed since campfire was lit (not persisted)
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

export class DroppedCanoeManager {
  private items: { tileX: number; tileY: number; el: HTMLImageElement }[] = [];
  private canvas: HTMLCanvasElement;
  private camera: THREE.OrthographicCamera;

  constructor(canvas: HTMLCanvasElement, camera: THREE.OrthographicCamera) {
    this.canvas = canvas;
    this.camera = camera;
  }

  drop(tileX: number, tileY: number) {
    const el = document.createElement('img');
    el.src = canoeEmptyUrl;
    el.style.cssText = `
      position: fixed;
      width: 53px;
      height: 20px;
      image-rendering: pixelated;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 599;
    `;
    document.body.appendChild(el);
    this.items.push({ tileX, tileY, el });
  }

  // Returns true if a canoe was at this tile and is now picked up.
  tryPickup(tileX: number, tileY: number): boolean {
    const idx = this.items.findIndex(c => c.tileX === tileX && c.tileY === tileY);
    if (idx < 0) return false;
    this.items[idx].el.remove();
    this.items.splice(idx, 1);
    return true;
  }

  hasCanoeAt(tileX: number, tileY: number): boolean {
    return this.items.some(c => c.tileX === tileX && c.tileY === tileY);
  }

  getSaveData(): { tileX: number; tileY: number }[] {
    return this.items.map(({ tileX, tileY }) => ({ tileX, tileY }));
  }

  update() {
    const cr = getContentRect(this.canvas);
    for (const item of this.items) {
      const worldX = (item.tileX + 0.5) * TILE_SIZE;
      const worldY = -(item.tileY + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
      const onScreen = sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h;
      item.el.style.display = onScreen ? 'block' : 'none';
      item.el.style.left = `${sx}px`;
      item.el.style.top  = `${sy}px`;
    }
  }
}

export class StructureManager {
  private slots: (PlacedStructure | null)[] = [];
  private canvas: HTMLCanvasElement;
  private camera: THREE.OrthographicCamera;

  constructor(canvas: HTMLCanvasElement, camera: THREE.OrthographicCamera) {
    this.canvas = canvas;
    this.camera = camera;
  }

  add(tileX: number, tileY: number, type: StructureType): number {
    const cfg = STRUCTURE_CONFIGS[type];

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
    el.textContent = cfg.emoji;
    el.style.cssText = `
      position: fixed;
      font-size: 22px;
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

    // Set initial tooltip text
    tooltipEl.textContent = `${cfg.label}\n0 / ${cfg.totalHours} hrs`;

    const idx = this.slots.length;
    this.slots.push({ tileX, tileY, type, complete: false, progressDays: 0, burnProgress: 0, el, tooltipEl });
    return idx;
  }

  setProgress(index: number, progressDays: number) {
    const s = this.slots[index];
    if (!s || s.complete) return;
    s.progressDays = progressDays;
    const cfg = STRUCTURE_CONFIGS[s.type];
    const hours = Math.min(Math.floor(progressDays * 24), cfg.totalHours);
    s.tooltipEl.textContent = `${cfg.label}\n${hours} / ${cfg.totalHours} hrs`;
  }

  getProgressDays(index: number): number {
    return this.slots[index]?.progressDays ?? 0;
  }

  findUnfinished(tileX: number, tileY: number, type: StructureType): number {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && !s.complete && s.type === type && s.tileX === tileX && s.tileY === tileY) return i;
    }
    return -1;
  }

  getTile(index: number): { tileX: number; tileY: number } | null {
    const s = this.slots[index];
    return s ? { tileX: s.tileX, tileY: s.tileY } : null;
  }

  complete(index: number, stats: PlayerStats) {
    const s = this.slots[index];
    if (!s) return;
    s.complete = true;
    if (s.type === 'canoe') {
      stats.canoes++;
      s.el.remove();
      s.tooltipEl.remove();
      this.slots[index] = null;
    } else {
      s.tooltipEl.textContent = `${STRUCTURE_CONFIGS[s.type].label}\nComplete`;
      if (s.type === 'campfire') s.el.style.fontSize = '26px'; // slightly larger when lit
    }
  }

  // Advance campfire burn timers by gameDays. Returns entries for each campfire that
  // crossed a burn interval and needs fuel consumed by the caller.
  // fuelNeeded is the integer number of timber units required this tick.
  tickCampfires(gameDays: number): { index: number; tileX: number; tileY: number; fuelNeeded: number }[] {
    const results: { index: number; tileX: number; tileY: number; fuelNeeded: number }[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s || !s.complete || s.type !== 'campfire') continue;
      const ticksBefore = Math.floor(s.burnProgress / CAMPFIRE_BURN_INTERVAL_DAYS);
      s.burnProgress += gameDays;
      const ticksNow = Math.floor(s.burnProgress / CAMPFIRE_BURN_INTERVAL_DAYS);
      const fuelNeeded = ticksNow - ticksBefore;
      if (fuelNeeded > 0) results.push({ index: i, tileX: s.tileX, tileY: s.tileY, fuelNeeded });
    }
    return results;
  }

  // Extinguish a complete campfire exactly at (tileX, tileY), if one exists.
  extinguishAt(tileX: number, tileY: number) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s || !s.complete || s.type !== 'campfire') continue;
      if (s.tileX === tileX && s.tileY === tileY) { this.burnOut(i); return; }
    }
  }

  // Remove a campfire that has run out of fuel.
  burnOut(index: number) {
    const s = this.slots[index];
    if (!s) return;
    s.el.remove();
    s.tooltipEl.remove();
    this.slots[index] = null;
  }

  hasStructureAt(tileX: number, tileY: number): boolean {
    return this.slots.some(s => s !== null && s.tileX === tileX && s.tileY === tileY);
  }

  playerInCompletedShelter(tileX: number, tileY: number): boolean {
    for (const s of this.slots) {
      if (s && s.complete && s.type === 'shelter' && s.tileX === tileX && s.tileY === tileY) return true;
    }
    return false;
  }

  // Returns true when the player's tile is warmed by a nearby campfire or enclosing shelter.
  isWarmed(tileX: number, tileY: number): boolean {
    for (const s of this.slots) {
      if (!s || !s.complete) continue;
      if (s.type === 'campfire') {
        if (Math.abs(s.tileX - tileX) <= 1 && Math.abs(s.tileY - tileY) <= 1) return true;
      } else if (s.type === 'shelter') {
        if (s.tileX === tileX && s.tileY === tileY) return true;
      }
    }
    return false;
  }

  getSaveData(): { tileX: number; tileY: number; type: StructureType; progressDays: number; complete: boolean }[] {
    return this.slots
      .filter((s): s is PlacedStructure => s !== null && !(s.type === 'canoe' && s.complete))
      .map(s => ({ tileX: s.tileX, tileY: s.tileY, type: s.type, progressDays: s.progressDays, complete: s.complete }));
  }

  restore(tileX: number, tileY: number, type: StructureType, progressDays: number, complete: boolean): number {
    const idx = this.add(tileX, tileY, type);
    if (complete) {
      const s = this.slots[idx]!;
      s.complete = true;
      s.tooltipEl.textContent = `${STRUCTURE_CONFIGS[type].label}\nComplete`;
    } else {
      this.setProgress(idx, progressDays);
    }
    return idx;
  }

  update() {
    const cr = getContentRect(this.canvas);
    for (const s of this.slots) {
      if (!s) continue;
      const worldX = (s.tileX + 0.5) * TILE_SIZE;
      const worldY = -(s.tileY + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
      const onScreen = sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h;
      s.el.style.display = onScreen ? 'block' : 'none';
      s.el.style.left = `${sx}px`;
      s.el.style.top  = `${sy}px`;
    }
  }
}
