import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { BIOMES } from './biomes';

const CATCH_MIN_PER_HOUR = 0.005;
const CATCH_MAX_PER_HOUR = 0.030;
const GAME_MIN = 1;
const GAME_MAX = 9; // forest tops out at 7; use 9 as scale ceiling for headroom

// Denser cover gives deadfalls a slight edge beyond what the biome's raw game value implies.
const CATCH_RATE_BONUS: Record<string, number> = {
  forest: 1.15,
  hills: 1.15,
  swamp: 1.15,
};

function catchRateForBiome(biome: string): number {
  const game = (BIOMES as Record<string, { baseResources: { game: number } }>)[biome]?.baseResources.game ?? 1;
  const t = Math.max(0, Math.min(1, (game - GAME_MIN) / (GAME_MAX - GAME_MIN)));
  const rate = CATCH_MIN_PER_HOUR + t * (CATCH_MAX_PER_HOUR - CATCH_MIN_PER_HOUR);
  return rate * (CATCH_RATE_BONUS[biome] ?? 1);
}

// Animals that can be caught per biome. Empty array = no catch possible.
// weight drives relative frequency; higher = more common.
const TRAPPABLE: Record<string, { emoji: string; meatLbs: number; pelts: number; weight: number }[]> = {
  plains:    [{ emoji: '🐇', meatLbs: 2, pelts: 1, weight: 6 }, { emoji: '🦃', meatLbs: 8, pelts: 0, weight: 1 }],
  forest:    [{ emoji: '🐇', meatLbs: 2, pelts: 1, weight: 6 }, { emoji: '🦊', meatLbs: 5, pelts: 1, weight: 2 }, { emoji: '🦃', meatLbs: 8, pelts: 0, weight: 1 }],
  hills:     [{ emoji: '🐇', meatLbs: 2, pelts: 1, weight: 5 }, { emoji: '🦊', meatLbs: 5, pelts: 1, weight: 2 }],
  snow:      [{ emoji: '🐇', meatLbs: 2, pelts: 1, weight: 5 }, { emoji: '🦊', meatLbs: 5, pelts: 1, weight: 2 }],
  beach:     [{ emoji: '🦆', meatLbs: 2, pelts: 0, weight: 2 }, { emoji: '🦀', meatLbs: 1, pelts: 0, weight: 5 }],
  swamp:     [{ emoji: '🦆', meatLbs: 2, pelts: 0, weight: 1 }],
  desert:    [],
  mountains: [],
};

function pickFromPool<T extends { weight: number }>(pool: T[]): T {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of pool) { r -= p.weight; if (r <= 0) return p; }
  return pool[pool.length - 1];
}

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

interface Trap {
  tileX: number;
  tileY: number;
  biome: string;
  ageHours: number;
  el: HTMLElement;
}

export interface TrapCheckResult {
  caught: boolean;
  emoji?: string;
  meatLbs?: number;
  pelts?: number;
}

export interface TrapSaveEntry {
  tileX: number;
  tileY: number;
  biome: string;
  ageHours: number;
}

export class TrapManager {
  private traps: Trap[] = [];

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera: THREE.OrthographicCamera,
  ) {}

  add(tileX: number, tileY: number, biome: string, ageHours = 0): void {
    const el = document.createElement('div');
    el.textContent = '🪤';
    el.style.cssText = `
      position: fixed; font-size: 16px; line-height: 1;
      pointer-events: none; z-index: 613;
      transform: translate(-50%, -50%); display: none;
    `;
    document.body.appendChild(el);
    this.traps.push({ tileX, tileY, biome, ageHours, el });
  }

  // Advance trap ages each game tick.
  advanceAge(gameDaysElapsed: number): void {
    const hoursElapsed = gameDaysElapsed * 24;
    for (const trap of this.traps) {
      trap.ageHours += hoursElapsed;
    }
  }

  // Called when the player steps onto a tile. Returns result if a trap was there, null otherwise.
  checkStep(tileX: number, tileY: number): TrapCheckResult | null {
    const idx = this.traps.findIndex(t => t.tileX === tileX && t.tileY === tileY);
    if (idx < 0) return null;

    const trap = this.traps[idx];
    trap.el.remove();
    this.traps.splice(idx, 1);

    const pool = TRAPPABLE[trap.biome] ?? [];
    if (pool.length === 0) return { caught: false };

    // Cumulative probability: at least one hourly roll succeeded over trap's lifetime.
    const catchChance = 1 - Math.pow(1 - catchRateForBiome(trap.biome), trap.ageHours);
    if (Math.random() < catchChance) {
      const prey = pickFromPool(pool);
      return { caught: true, ...prey };
    }
    return { caught: false };
  }

  update(): void {
    const cr = getContentRect(this.canvasEl);
    const scale = cr.w / CANVAS_WIDTH;
    const fs = Math.round(16 * scale);

    for (const trap of this.traps) {
      const wx = (trap.tileX + 0.5) * TILE_SIZE;
      const wy = -(trap.tileY + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (wx - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - (wy - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
      const pad = 64;
      const on = sx >= cr.x - pad && sx <= cr.x + cr.w + pad
              && sy >= cr.y - pad && sy <= cr.y + cr.h + pad;
      trap.el.style.display = on ? 'block' : 'none';
      if (on) {
        trap.el.style.left     = `${sx}px`;
        trap.el.style.top      = `${sy}px`;
        trap.el.style.fontSize = `${fs}px`;
      }
    }
  }

  getSaveData(): TrapSaveEntry[] {
    return this.traps.map(t => ({ tileX: t.tileX, tileY: t.tileY, biome: t.biome, ageHours: t.ageHours }));
  }

  restoreTrap(tileX: number, tileY: number, biome: string, ageHours = 0): void {
    this.add(tileX, tileY, biome, ageHours);
  }
}
