import * as THREE from 'three';
import type { NoiseFunction2D } from 'simplex-noise';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome, type Biome } from './biomes';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

// ── Types ──────────────────────────────────────────────────────────────────

type Rarity = 'common' | 'uncommon' | 'rare' | 'mythical';

interface AnimalDef {
  emoji: string;
  name: string;
  biomes: Biome[];
  rarity: Rarity;
  fleeRadius: number;   // tiles; 0 = never flees
  fleeSpeed: number;    // tiles/second while fleeing
  wanderSpeed: number;  // tiles/second while wandering
  meatLbs: number;      // processed meat yield in lbs
  furPelts: number;     // pelt/hide yield (0 = none — birds, crustaceans, etc.)
  size: number;         // emoji font-size in px (base 18px = medium animal ~deer)
  hp: number;           // hits to kill (1 = one-shot)
  prey: boolean;        // true = flees from gunshots; false = predator, holds ground
  nocturnal?: boolean;  // only active at night
}

// ── Animal roster ──────────────────────────────────────────────────────────
//   meatLbs: realistic processed yield from a typical adult specimen
//   furPelts: 0 for feathered/shelled animals; 1 for a single pelt/hide

const ANIMAL_DEFS: AnimalDef[] = [
  // Common prey
  { emoji: '🦌', name: 'Deer',         biomes: ['plains','forest','hills'],              rarity: 'common',   fleeRadius: 5,  fleeSpeed: 9.0, wanderSpeed: 0.8,  meatLbs:   60, furPelts: 1, size: 24, hp: 1, prey: true  },
  { emoji: '🐇', name: 'Rabbit',       biomes: ['plains','forest','hills','beach'],       rarity: 'common',   fleeRadius: 4,  fleeSpeed: 10.0, wanderSpeed: 1.2, meatLbs:    2, furPelts: 1, size: 12, hp: 1, prey: true  },
  { emoji: '🐗', name: 'Boar',         biomes: ['forest','swamp','hills'],                rarity: 'common',   fleeRadius: 3,  fleeSpeed: 7.5, wanderSpeed: 0.6,  meatLbs:   75, furPelts: 1, size: 18, hp: 1, prey: true  },
  { emoji: '🦃', name: 'Turkey',       biomes: ['plains','forest'],                       rarity: 'common',   fleeRadius: 4,  fleeSpeed: 7.5, wanderSpeed: 0.7,  meatLbs:    8, furPelts: 0, size: 16, hp: 1, prey: true  },
  { emoji: '🦆', name: 'Duck',         biomes: ['beach','swamp'],                         rarity: 'common',   fleeRadius: 5,  fleeSpeed: 8.0, wanderSpeed: 1.0,  meatLbs:    2, furPelts: 0, size: 13, hp: 1, prey: true  },
  // Predators
  { emoji: '🐻', name: 'Bear',         biomes: ['forest','hills','mountains'],             rarity: 'uncommon', fleeRadius: 0,  fleeSpeed: 0,   wanderSpeed: 0.5,  meatLbs:  200, furPelts: 1, size: 26, hp: 2, prey: false },
  { emoji: '🦊', name: 'Fox',          biomes: ['plains','forest','hills','snow'],         rarity: 'uncommon', fleeRadius: 6,  fleeSpeed: 9.0, wanderSpeed: 1.0,  meatLbs:    5, furPelts: 1, size: 15, hp: 1, prey: true  },
  { emoji: '🐺', name: 'Wolf',         biomes: ['forest','hills','mountains','snow'],      rarity: 'uncommon', fleeRadius: 5,  fleeSpeed: 5.5, wanderSpeed: 0.8,  meatLbs:   40, furPelts: 1, size: 18, hp: 1, prey: false, nocturnal: true },
  { emoji: '🦅', name: 'Eagle',        biomes: ['mountains','hills','snow'],               rarity: 'uncommon', fleeRadius: 8,  fleeSpeed: 11.0, wanderSpeed: 1.5, meatLbs:    3, furPelts: 0, size: 16, hp: 1, prey: true  },
  { emoji: '🦬', name: 'Bison',        biomes: ['plains'],                                rarity: 'uncommon', fleeRadius: 4,  fleeSpeed: 7.0, wanderSpeed: 0.4,  meatLbs:  600, furPelts: 1, size: 28, hp: 2, prey: true  },
  { emoji: '🐊', name: 'Crocodile',    biomes: ['swamp'],                                 rarity: 'uncommon', fleeRadius: 0,  fleeSpeed: 0,   wanderSpeed: 0.3,  meatLbs:  100, furPelts: 1, size: 22, hp: 2, prey: false },
  // Rare
  { emoji: '🐆', name: 'Snow Leopard', biomes: ['mountains','snow'],                      rarity: 'rare',     fleeRadius: 10, fleeSpeed: 6.5, wanderSpeed: 1.0,  meatLbs:   30, furPelts: 1, size: 20, hp: 1, prey: false },
  { emoji: '🦁', name: 'Lion',         biomes: ['desert','plains'],                       rarity: 'rare',     fleeRadius: 0,  fleeSpeed: 0,   wanderSpeed: 0.6,  meatLbs:  150, furPelts: 1, size: 24, hp: 2, prey: false },
  { emoji: '🦜', name: 'Parrot',       biomes: ['forest','swamp'],                        rarity: 'rare',     fleeRadius: 6,  fleeSpeed: 9.0, wanderSpeed: 1.0,  meatLbs:    0, furPelts: 0, size: 13, hp: 1, prey: true  },
  { emoji: '🦀', name: 'Crab',         biomes: ['beach'],                                 rarity: 'rare',     fleeRadius: 3,  fleeSpeed: 6.0, wanderSpeed: 0.5,  meatLbs:    1, furPelts: 0, size: 13, hp: 1, prey: true  },
  // Mythical
  { emoji: '🦄', name: 'Unicorn',      biomes: ['plains','forest'],                       rarity: 'mythical', fleeRadius: 12, fleeSpeed: 12.0, wanderSpeed: 1.2, meatLbs:  440, furPelts: 1, size: 22, hp: 1, prey: true  },
  { emoji: '🐉', name: 'Dragon',       biomes: ['mountains','snow'],                      rarity: 'mythical', fleeRadius: 0,  fleeSpeed: 0,   wanderSpeed: 0.8,  meatLbs: 1000, furPelts: 1, size: 36, hp: 5, prey: false },
  { emoji: '🦖', name: 'T-Rex',        biomes: ['forest','swamp'],                        rarity: 'mythical', fleeRadius: 0,  fleeSpeed: 0,   wanderSpeed: 0.7,  meatLbs: 5000, furPelts: 1, size: 40, hp: 8, prey: false },
  { emoji: '👹', name: 'Troll',        biomes: ['forest','hills'],                        rarity: 'mythical', fleeRadius: 0,  fleeSpeed: 0,   wanderSpeed: 0.4,  meatLbs:   80, furPelts: 1, size: 30, hp: 2, prey: false, nocturnal: true },
  { emoji: '🫈', name: 'Bigfoot',      biomes: ['forest','mountains','snow'],             rarity: 'mythical', fleeRadius: 15, fleeSpeed: 11.0, wanderSpeed: 1.0, meatLbs:  150, furPelts: 1, size: 32, hp: 3, prey: true  },
];

export const RIFLE_RANGE = 10; // tiles

const RARITY_WEIGHT: Record<Rarity, number> = {
  common:   100,
  uncommon:  20,
  rare:       4,
  mythical:   0.3,
};

const MAX_ANIMALS      = 40;
const SPAWN_RADIUS_MIN = 28;  // just past screen corners (~27 tiles)
const SPAWN_RADIUS_MAX = 42;
const DESPAWN_RADIUS   = 50;
const WANDER_RETARGET  = 3;   // seconds between new wander targets

// ── Per-animal state ───────────────────────────────────────────────────────

interface AnimalInstance {
  def: AnimalDef;
  x: number; y: number;       // continuous tile-space position
  targetX: number; targetY: number;
  el: HTMLElement;
  wanderTimer: number;        // seconds until next wander retarget
  fleeing: boolean;
  hidden: boolean;            // true when suppressed by day/night cycle
  currentHp: number;
  blinkTimer: number;         // seconds of red-blink remaining after a hit
  dead: boolean;
  deadEl: HTMLElement | null; // faded emoji shown at death position
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const cw = r.width, ch = r.height;
  const aspect = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w = cw, h = ch;
  if (cw / ch > aspect) { w = ch * aspect; } else { h = cw / aspect; }
  return { x: r.left + (cw - w) / 2, y: r.top + (ch - h) / 2, w, h };
}

function sampleBiome(tx: number, ty: number, elev: NoiseFunction2D, moist: NoiseFunction2D, river: NoiseFunction2D): Biome {
  return getBiome(
    sampleElevation(tx, ty, elev),
    sampleMoisture(tx, ty, moist),
    sampleRiver(tx, ty, river),
    sampleLake(tx, ty, river),
  );
}

function isLand(biome: Biome): boolean {
  return biome !== 'deep_water' && biome !== 'shallow_water';
}

function pickWeighted(defs: AnimalDef[]): AnimalDef {
  const total = defs.reduce((s, d) => s + RARITY_WEIGHT[d.rarity], 0);
  let r = Math.random() * total;
  for (const d of defs) {
    r -= RARITY_WEIGHT[d.rarity];
    if (r <= 0) return d;
  }
  return defs[defs.length - 1];
}

function tooltipText(def: AnimalDef): string {
  const meat = def.meatLbs > 0 ? `~${def.meatLbs} lbs` : '—';
  const fur  = def.furPelts > 0 ? `${def.furPelts} pelt` : '—';
  return `${def.name}\nMeat  ${meat}\nFur   ${fur}`;
}

// ── AnimalManager ──────────────────────────────────────────────────────────

export class AnimalManager {
  private animals: AnimalInstance[] = [];
  private canvas: HTMLCanvasElement;
  private camera: THREE.OrthographicCamera;
  private elev: NoiseFunction2D;
  private moist: NoiseFunction2D;
  private river: NoiseFunction2D;
  private tooltip: HTMLDivElement;
  private huntingMode = false;

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.OrthographicCamera,
    elev: NoiseFunction2D,
    moist: NoiseFunction2D,
    river: NoiseFunction2D,
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.elev   = elev;
    this.moist  = moist;
    this.river  = river;

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = `
      position: fixed;
      background: rgba(0,0,0,0.82);
      color: #e8e8e8;
      font: 12px/1.6 monospace;
      padding: 5px 10px;
      border-radius: 4px;
      pointer-events: none;
      white-space: pre;
      z-index: 602;
      opacity: 0;
      transition: opacity 0.12s ease;
    `;
    document.body.appendChild(this.tooltip);
  }

  setHuntingMode(active: boolean) {
    this.huntingMode = active;
    const pe = active ? 'none' : 'auto';
    for (const a of this.animals) {
      a.el.style.pointerEvents = pe;
      if (a.deadEl) a.deadEl.style.pointerEvents = pe;
    }
    if (active) this.tooltip.style.opacity = '0';
  }

  update(delta: number, playerX: number, playerY: number, daysTraveled: number) {
    const isDay = isDaylightFrac(daysTraveled);
    this.despawn(playerX, playerY);
    this.spawn(playerX, playerY, isDay);
    this.moveAnimals(delta, playerX, playerY, isDay);
    this.reposition();
  }

  // Fire a ray from (ox, oy) in direction (dx, dy) (normalized) for up to `range` tiles.
  // Returns the bullet endpoint in continuous tile space and whether an animal was hit.
  fireRay(ox: number, oy: number, dx: number, dy: number, range: number): { endX: number; endY: number } {
    const HIT_RADIUS = 0.6;
    let bestT = range;
    let bestAnimal: AnimalInstance | null = null;

    for (const a of this.animals) {
      if (a.dead || a.hidden) continue;
      // Ray-circle: find t of closest approach
      const ax = a.x - ox, ay = a.y - oy;
      const t = ax * dx + ay * dy;
      if (t < 0 || t > range) continue;
      const cx = ox + t * dx - a.x;
      const cy = oy + t * dy - a.y;
      if (cx * cx + cy * cy < HIT_RADIUS * HIT_RADIUS && t < bestT) {
        bestT = t;
        bestAnimal = a;
      }
    }

    if (bestAnimal) {
      bestAnimal.blinkTimer = 0.3;
      bestAnimal.currentHp--;
      if (bestAnimal.currentHp <= 0) {
        this.killAnimal(bestAnimal);
      }
    }

    return { endX: ox + dx * bestT, endY: oy + dy * bestT };
  }

  // Startle all visible prey animals — call after firing a shot.
  scareAll(playerX: number, playerY: number) {
    for (const a of this.animals) {
      if (a.dead || a.hidden || !a.def.prey) continue;
      const dx = a.x - playerX, dy = a.y - playerY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      a.fleeing = true;
      a.targetX = a.x + (dx / dist) * 40;
      a.targetY = a.y + (dy / dist) * 40;
      a.wanderTimer = WANDER_RETARGET;
    }
  }

  // Collect a dead animal within 1 tile of the given tile center.
  collectAt(tileX: number, tileY: number): { meatLbs: number; furPelts: number } | null {
    const cx = tileX + 0.5, cy = tileY + 0.5;
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (!a.dead) continue;
      if (Math.abs(a.x - cx) < 1.0 && Math.abs(a.y - cy) < 1.0) {
        const result = { meatLbs: a.def.meatLbs, furPelts: a.def.furPelts };
        a.deadEl?.remove();
        a.el.remove();
        this.animals.splice(i, 1);
        return result;
      }
    }
    return null;
  }

  destroy() {
    for (const a of this.animals) { a.el.remove(); a.deadEl?.remove(); }
    this.animals = [];
    this.tooltip.remove();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private killAnimal(a: AnimalInstance) {
    a.dead = true;
    const deadEl = document.createElement('div');
    deadEl.textContent = a.def.emoji;
    deadEl.style.cssText = `
      position: fixed;
      font-size: ${a.def.size}px;
      line-height: 1;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 598;
      display: none;
      user-select: none;
      opacity: 0.35;
      filter: grayscale(1);
    `;
    document.body.appendChild(deadEl);
    a.deadEl = deadEl;
  }

  private despawn(px: number, py: number) {
    this.animals = this.animals.filter(a => {
      const dx = a.x - px, dy = a.y - py;
      if (Math.sqrt(dx*dx + dy*dy) > DESPAWN_RADIUS) {
        a.el.remove();
        return false;
      }
      return true;
    });
  }

  private spawn(px: number, py: number, isDay: boolean) {
    if (this.animals.length >= MAX_ANIMALS) return;
    if (Math.random() > 0.15) return;

    const angle = Math.random() * Math.PI * 2;
    const dist  = SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    const tx = Math.floor(px + Math.cos(angle) * dist);
    const ty = Math.floor(py + Math.sin(angle) * dist);
    const biome = sampleBiome(tx, ty, this.elev, this.moist, this.river);
    if (!isLand(biome)) return;

    // nocturnal:true animals are night-only; all others are day-only
    const valid = ANIMAL_DEFS.filter(d =>
      d.biomes.includes(biome) && (d.nocturnal ? !isDay : isDay)
    );
    if (valid.length === 0) return;
    this.addAnimal(pickWeighted(valid), tx + 0.5, ty + 0.5);
  }

  private addAnimal(def: AnimalDef, x: number, y: number) {
    const el = document.createElement('div');
    el.textContent = def.emoji;
    el.style.cssText = `
      position: fixed;
      font-size: ${def.size}px;
      line-height: 1;
      transform: translate(-50%, -50%);
      pointer-events: ${this.huntingMode ? 'none' : 'auto'};
      z-index: 599;
      display: none;
      user-select: none;
      cursor: default;
    `;
    document.body.appendChild(el);

    const tip = this.tooltip;
    el.addEventListener('mouseenter', () => {
      if (this.huntingMode) return;
      tip.textContent = tooltipText(def);
      tip.style.opacity = '1';
    });
    el.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
    el.addEventListener('mousemove', (e) => {
      const tr = tip.getBoundingClientRect();
      const tx = e.clientX + 14 + tr.width > window.innerWidth ? e.clientX - 14 - tr.width : e.clientX + 14;
      tip.style.left = `${tx}px`;
      tip.style.top  = `${e.clientY - 8}px`;
    });

    this.animals.push({ def, x, y, targetX: x, targetY: y, el, wanderTimer: Math.random() * WANDER_RETARGET, fleeing: false, hidden: false, currentHp: def.hp, blinkTimer: 0, dead: false, deadEl: null });
  }

  private moveAnimals(delta: number, px: number, py: number, isDay: boolean) {
    for (const a of this.animals) {
      if (a.blinkTimer > 0) a.blinkTimer = Math.max(0, a.blinkTimer - delta);
      if (a.dead) continue;
      const visible = a.def.nocturnal ? !isDay : isDay;
      a.hidden = !visible;
      if (!visible) continue;

      const dx = px - a.x, dy = py - a.y;
      const distToPlayer = Math.sqrt(dx*dx + dy*dy);
      const shouldFlee = a.def.fleeRadius > 0 && distToPlayer < a.def.fleeRadius;

      if (shouldFlee) {
        a.fleeing = true;
        const len = distToPlayer || 1;
        a.targetX = a.x - (dx / len) * 8;
        a.targetY = a.y - (dy / len) * 8;
        a.wanderTimer = WANDER_RETARGET;
      } else {
        a.fleeing = false;
        a.wanderTimer -= delta;
        if (a.wanderTimer <= 0) {
          a.wanderTimer = WANDER_RETARGET * (0.5 + Math.random());
          const angle = Math.random() * Math.PI * 2;
          const wanderDist = 3 + Math.random() * 7;
          const ntx = Math.floor(a.x + Math.cos(angle) * wanderDist);
          const nty = Math.floor(a.y + Math.sin(angle) * wanderDist);
          const targetBiome = sampleBiome(ntx, nty, this.elev, this.moist, this.river);
          if (isLand(targetBiome) && a.def.biomes.includes(targetBiome)) {
            a.targetX = ntx + 0.5;
            a.targetY = nty + 0.5;
          }
        }
      }

      const speed = a.fleeing ? a.def.fleeSpeed : a.def.wanderSpeed;
      const tdx = a.targetX - a.x;
      const tdy = a.targetY - a.y;
      const tdist = Math.sqrt(tdx*tdx + tdy*tdy);
      if (tdist > 0.05) {
        const step = Math.min(speed * delta, tdist);
        a.x += (tdx / tdist) * step;
        a.y += (tdy / tdist) * step;
      }
    }
  }

  private reposition() {
    const cr = getContentRect(this.canvas);
    for (const a of this.animals) {
      const worldX =  a.x * TILE_SIZE;
      const worldY = -a.y * TILE_SIZE;
      const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
      const onScreen = sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h;

      if (a.dead) {
        a.el.style.display = 'none';
        if (a.deadEl) {
          a.deadEl.style.display = onScreen ? 'block' : 'none';
          a.deadEl.style.left = `${sx}px`;
          a.deadEl.style.top  = `${sy}px`;
        }
        continue;
      }

      if (a.hidden) { a.el.style.display = 'none'; continue; }
      a.el.style.filter = a.blinkTimer > 0 ? 'sepia(1) saturate(20) hue-rotate(-20deg)' : '';
      a.el.style.display = onScreen ? 'block' : 'none';
      a.el.style.left = `${sx}px`;
      a.el.style.top  = `${sy}px`;
    }
  }
}

// ── Fish jump effect ───────────────────────────────────────────────────────

export class FishJumpEffect {
  private canvas: HTMLCanvasElement;
  private camera: THREE.OrthographicCamera;
  private elev: NoiseFunction2D;
  private moist: NoiseFunction2D;
  private river: NoiseFunction2D;
  private timer = 0;

  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.OrthographicCamera,
    elev: NoiseFunction2D,
    moist: NoiseFunction2D,
    river: NoiseFunction2D,
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.elev   = elev;
    this.moist  = moist;
    this.river  = river;
  }

  update(delta: number, playerX: number, playerY: number) {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = 5 + Math.random() * 6;

    const angle = Math.random() * Math.PI * 2;
    const dist  = 3 + Math.random() * 8;
    const tx = Math.floor(playerX + Math.cos(angle) * dist);
    const ty = Math.floor(playerY + Math.sin(angle) * dist);
    const biome = sampleBiome(tx, ty, this.elev, this.moist, this.river);
    if (biome !== 'shallow_water' && biome !== 'deep_water') return;

    this.spawnJump(tx, ty);
  }

  private spawnJump(tx: number, ty: number) {
    const cr = getContentRect(this.canvas);
    const worldX =  (tx + 0.5) * TILE_SIZE;
    const worldY = -(ty + 0.5) * TILE_SIZE;
    const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
    const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
    if (sx < cr.x || sx > cr.x + cr.w || sy < cr.y || sy > cr.y + cr.h) return;

    const el = document.createElement('div');
    el.textContent = '🐟';
    el.style.cssText = `
      position: fixed;
      font-size: 14px;
      left: ${sx}px;
      top: ${sy}px;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 598;
      transition: top 0.35s ease-out, opacity 0.7s ease-in;
      opacity: 1;
    `;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.style.top     = `${sy - 28}px`;
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 750);
  }
}

// ── Day/night helper (mirrors playerStats.isDaylight) ─────────────────────

function isDaylightFrac(daysTraveled: number): boolean {
  const frac = daysTraveled % 1;
  return frac >= 0.25 && frac < 0.75;
}
