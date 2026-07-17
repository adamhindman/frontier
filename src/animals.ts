import * as THREE from 'three';
import type { NoiseFunction2D } from 'simplex-noise';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome, type Biome } from './biomes';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import type { Trophy } from './playerStats';

// ── Types ──────────────────────────────────────────────────────────────────

type Rarity = 'common' | 'uncommon' | 'rare' | 'mythical';

interface AnimalDef {
  emoji: string;
  name: string;
  biomes: Biome[];
  rarity: Rarity;
  fleeRadius: number;   // tiles; 0 = never flees from player proximity
  fleeSpeed: number;    // tiles/second while fleeing
  wanderSpeed: number;  // tiles/second while wandering
  meatLbs: number;
  furPelts: number;
  size: number;         // emoji font-size in px (base 18 = medium)
  hp: number;
  prey: boolean;        // true = flees from gunshots; false = holds ground
  nocturnal?: boolean;
  detectionRadius?: number; // predators: tiles at which they detect and stalk player
  attackDamage?: number;    // damage per hit when they reach the player
  aggression?: number;      // 0–1 probability of deciding to stalk on detection (default 1)
}

// Predator AI constants
const RUSH_DISTANCE   = 2.5;   // tiles — triggers charge from stalking
const ATTACK_DISTANCE = 0.9;   // tiles — close enough to deal damage
const RETREAT_TILES   = 8;     // how far back to retreat after striking
const RETREAT_PAUSE   = 3.5;   // seconds of retreat-pause before re-stalking
const RUSH_SPEED_MULT = 3.0;   // speed multiplier during rush
const NAMEPLATE_RANGE = 10;    // tiles — man-eater nameplate visible within this distance

type PredatorState = 'idle' | 'stalking' | 'rushing' | 'retreating';

// ── Animal roster ──────────────────────────────────────────────────────────

const ANIMAL_DEFS: AnimalDef[] = [
  // Common prey
  { emoji: '🦌', name: 'Deer',         biomes: ['plains','forest','hills'],              rarity: 'common',   fleeRadius: 4,  fleeSpeed: 9.0,  wanderSpeed: 0.8,  meatLbs:   60, furPelts: 1, size: 24, hp: 1, prey: true  },
  { emoji: '🐇', name: 'Rabbit',       biomes: ['plains','forest','hills','beach'],       rarity: 'common',   fleeRadius: 4,  fleeSpeed: 10.0, wanderSpeed: 1.2,  meatLbs:    2, furPelts: 1, size: 12, hp: 1, prey: true  },
  { emoji: '🐗', name: 'Boar',         biomes: ['forest','swamp','hills'],                rarity: 'common',   fleeRadius: 3,  fleeSpeed: 7.5,  wanderSpeed: 0.6,  meatLbs:   75, furPelts: 1, size: 18, hp: 1, prey: true,  detectionRadius:  8, attackDamage: 15, aggression: 0.10 },
  { emoji: '🦃', name: 'Turkey',       biomes: ['plains','forest'],                       rarity: 'common',   fleeRadius: 4,  fleeSpeed: 7.5,  wanderSpeed: 0.7,  meatLbs:    8, furPelts: 0, size: 16, hp: 1, prey: true  },
  { emoji: '🦆', name: 'Duck',         biomes: ['beach','swamp'],                         rarity: 'common',   fleeRadius: 4,  fleeSpeed: 8.0,  wanderSpeed: 1.0,  meatLbs:    2, furPelts: 0, size: 13, hp: 1, prey: true  },
  // Predators
  { emoji: '🐻', name: 'Bear',         biomes: ['forest','hills','mountains'],             rarity: 'uncommon', fleeRadius: 0,  fleeSpeed: 0,    wanderSpeed: 0.5,  meatLbs:  200, furPelts: 1, size: 26, hp: 2, prey: false, detectionRadius:  7, attackDamage: 25, aggression: 0.25 },
  { emoji: '🦊', name: 'Fox',          biomes: ['plains','forest','hills','snow'],         rarity: 'uncommon', fleeRadius: 6,  fleeSpeed: 9.0,  wanderSpeed: 1.0,  meatLbs:    5, furPelts: 1, size: 15, hp: 1, prey: true  },
  { emoji: '🐺', name: 'Wolf',         biomes: ['forest','hills','mountains','snow'],      rarity: 'uncommon', fleeRadius: 5,  fleeSpeed: 5.5,  wanderSpeed: 0.8,  meatLbs:   40, furPelts: 1, size: 18, hp: 1, prey: false, nocturnal: true, detectionRadius: 12, attackDamage: 15, aggression: 0.30 },
  { emoji: '🦅', name: 'Eagle',        biomes: ['mountains','hills','snow'],               rarity: 'uncommon', fleeRadius: 8,  fleeSpeed: 11.0, wanderSpeed: 1.5,  meatLbs:    3, furPelts: 0, size: 16, hp: 1, prey: true,  detectionRadius: 12, attackDamage: 10, aggression: 0.15 },
  { emoji: '🦬', name: 'Bison',        biomes: ['plains'],                                rarity: 'uncommon', fleeRadius: 0,  fleeSpeed: 7.0,  wanderSpeed: 0.4,  meatLbs:  600, furPelts: 1, size: 28, hp: 2, prey: true,  detectionRadius: 10, attackDamage: 20, aggression: 0.15 },
  { emoji: '🐊', name: 'Crocodile',    biomes: ['swamp'],                                 rarity: 'uncommon', fleeRadius: 0,  fleeSpeed: 0,    wanderSpeed: 0.3,  meatLbs:  100, furPelts: 1, size: 22, hp: 2, prey: false, detectionRadius:  8, attackDamage: 20, aggression: 0.40 },
  // Rare
  { emoji: '🐆', name: 'Snow Leopard', biomes: ['mountains','snow'],                      rarity: 'rare',     fleeRadius: 10, fleeSpeed: 6.5,  wanderSpeed: 1.0,  meatLbs:   30, furPelts: 1, size: 20, hp: 1, prey: false, detectionRadius: 12, attackDamage: 22, aggression: 0.20 },
  { emoji: '🦁', name: 'Lion',         biomes: ['desert','plains'],                       rarity: 'rare',     fleeRadius: 0,  fleeSpeed: 0,    wanderSpeed: 0.6,  meatLbs:  150, furPelts: 1, size: 24, hp: 2, prey: false, detectionRadius: 12, attackDamage: 25, aggression: 0.45 },
  { emoji: '🦜', name: 'Parrot',       biomes: ['forest','swamp'],                        rarity: 'rare',     fleeRadius: 6,  fleeSpeed: 9.0,  wanderSpeed: 1.0,  meatLbs:    0, furPelts: 0, size: 13, hp: 1, prey: true  },
  { emoji: '🦀', name: 'Crab',         biomes: ['beach'],                                 rarity: 'rare',     fleeRadius: 3,  fleeSpeed: 6.0,  wanderSpeed: 0.5,  meatLbs:    1, furPelts: 0, size: 13, hp: 1, prey: true  },
  // Mythical
  { emoji: '🦄', name: 'Unicorn',      biomes: ['plains','forest'],                       rarity: 'mythical', fleeRadius: 12, fleeSpeed: 12.0, wanderSpeed: 1.2,  meatLbs:  440, furPelts: 1, size: 22, hp: 1, prey: true  },
  { emoji: '🐉', name: 'Dragon',       biomes: ['mountains','snow'],                      rarity: 'mythical', fleeRadius: 0,  fleeSpeed: 0,    wanderSpeed: 0.8,  meatLbs: 1000, furPelts: 1, size: 36, hp: 5, prey: false, detectionRadius: 14, attackDamage: 40, aggression: 0.65 },
  { emoji: '🦖', name: 'T-Rex',        biomes: ['forest','swamp'],                        rarity: 'mythical', fleeRadius: 0,  fleeSpeed: 0,    wanderSpeed: 0.7,  meatLbs: 5000, furPelts: 1, size: 40, hp: 8, prey: false, detectionRadius: 12, attackDamage: 35, aggression: 0.55 },
  { emoji: '👹', name: 'Troll',        biomes: ['forest','hills'],                        rarity: 'mythical', fleeRadius: 0,  fleeSpeed: 0,    wanderSpeed: 0.4,  meatLbs:   80, furPelts: 1, size: 30, hp: 2, prey: false, nocturnal: true, detectionRadius: 10, attackDamage: 20, aggression: 0.35 },
  { emoji: '🫈', name: 'Bigfoot',      biomes: ['forest','mountains','snow'],             rarity: 'mythical', fleeRadius: 15, fleeSpeed: 11.0, wanderSpeed: 1.0,  meatLbs:  150, furPelts: 1, size: 32, hp: 3, prey: true  },
];

export const RIFLE_RANGE = 10; // tiles

const RARITY_WEIGHT: Record<Rarity, number> = {
  common:   100,
  uncommon:  20,
  rare:       4,
  mythical:   0.3,
};

const MAX_ANIMALS          = 40;
const MAX_NOCTURNAL_ANIMALS =  8; // wolves/trolls only spawn at night — cap them separately
const SPAWN_RADIUS_MIN = 28;
const SPAWN_RADIUS_MAX = 42;
const DESPAWN_RADIUS   = 50;
const WANDER_RETARGET  = 3;

// ── Save type ──────────────────────────────────────────────────────────────

export interface ManEaterSave {
  questId:      string;
  manEaterName: string;
  animalName:   string;
  x: number;
  y: number;
  currentHp: number;
}

// ── Per-animal state ───────────────────────────────────────────────────────

interface AnimalInstance {
  def: AnimalDef;
  x: number; y: number;
  targetX: number; targetY: number;
  el: HTMLElement;
  wanderTimer: number;
  fleeing: boolean;
  gunFleeTimer: number;
  chargingPlayer: boolean;
  hidden: boolean;
  currentHp: number;
  blinkTimer: number;
  dead: boolean;
  deadEl: HTMLElement | null;
  // Predator AI
  predatorState: PredatorState;
  retreatTimer: number;
  attackCooldown: number;
  ignoreTimer: number;  // seconds before re-rolling aggression on a failed detection check
  // Man-eater extras
  isManEater: boolean;
  manEaterQuestId: string | null;
  manEaterName: string | null;
  nameplateEl: HTMLElement | null;
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

// Returns true if this animal uses the predator AI (either a true predator or a man-eater)
function usesPredatorAI(a: AnimalInstance): boolean {
  return (!!a.def.detectionRadius && !a.def.prey) || a.isManEater;
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
  private lastPlayerX = 0;
  private lastPlayerY = 0;

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

  // Returns attack events {damage} for hits taken this frame.
  update(delta: number, playerX: number, playerY: number, daysTraveled: number, playerMoving = true): { damage: number }[] {
    this.lastPlayerX = playerX;
    this.lastPlayerY = playerY;
    const isDay = isDaylightFrac(daysTraveled);
    this.despawn(playerX, playerY);
    this.spawn(playerX, playerY, isDay);
    const attacks = this.moveAnimals(delta, playerX, playerY, isDay, playerMoving);
    this.reposition();
    return attacks;
  }

  // Fire a ray from (ox, oy) in direction (dx, dy) for up to `range` tiles.
  // Returns endpoint plus trophy info if a man-eater was killed.
  fireRay(ox: number, oy: number, dx: number, dy: number, range: number): {
    endX: number; endY: number;
    manEaterKilled?: Trophy;
  } {
    const HIT_RADIUS = 0.25;
    let bestT = range;
    let bestAnimal: AnimalInstance | null = null;

    for (const a of this.animals) {
      if (a.dead || a.hidden) continue;
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

    let manEaterKilled: Trophy | undefined;
    if (bestAnimal) {
      bestAnimal.blinkTimer = 0.3;
      bestAnimal.currentHp--;
      if (bestAnimal.currentHp <= 0) {
        if (bestAnimal.isManEater && bestAnimal.manEaterQuestId && bestAnimal.manEaterName) {
          manEaterKilled = {
            questId:      bestAnimal.manEaterQuestId,
            manEaterName: bestAnimal.manEaterName,
            animalName:   bestAnimal.def.name,
          };
        }
        this.killAnimal(bestAnimal);
      } else if (usesPredatorAI(bestAnimal)) {
        // Hit predator survived — immediately rush the shooter
        bestAnimal.predatorState = 'rushing';
        bestAnimal.targetX = ox;
        bestAnimal.targetY = oy;
      } else if (!bestAnimal.def.prey) {
        // Old-style charge for any non-prey without predator AI
        bestAnimal.chargingPlayer = true;
        bestAnimal.fleeing = true;
        bestAnimal.gunFleeTimer = 8;
        bestAnimal.targetX = ox;
        bestAnimal.targetY = oy;
        bestAnimal.wanderTimer = WANDER_RETARGET;
      }
    }

    return { endX: ox + dx * bestT, endY: oy + dy * bestT, manEaterKilled };
  }

  // Startle prey animals. Predators hold their ground.
  scareAll(playerX: number, playerY: number) {
    for (const a of this.animals) {
      if (a.dead || a.hidden) continue;
      if (!a.def.prey || a.isManEater) continue; // predators/man-eaters don't flee shots
      if (Math.random() > 1/3) continue;
      const dx = a.x - playerX, dy = a.y - playerY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      a.fleeing = true;
      a.gunFleeTimer = 8;
      a.targetX = a.x + (dx / dist) * 10;
      a.targetY = a.y + (dy / dist) * 10;
      a.wanderTimer = WANDER_RETARGET;
    }
  }

  // Description of a living animal on the given tile (for click-inspect).
  getDescriptionAt(tileX: number, tileY: number): string | null {
    const cx = tileX + 0.5, cy = tileY + 0.5;
    for (const a of this.animals) {
      if (a.dead || a.hidden) continue;
      if (Math.abs(a.x - cx) < 0.75 && Math.abs(a.y - cy) < 0.75) {
        if (a.isManEater && a.manEaterName) {
          return `${a.def.emoji} ${a.manEaterName} (${a.def.name})\n${tooltipText(a.def)}`;
        }
        return tooltipText(a.def);
      }
    }
    return null;
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

  // Spawn a man-eater animal at (tileX, tileY). Returns false if the animal name is unknown.
  addManEater(animalName: string, tileX: number, tileY: number, questId: string, name: string): boolean {
    const baseDef = ANIMAL_DEFS.find(d => d.name === animalName);
    if (!baseDef) return false;

    // Enhanced stats: +1 hp, +2 detection range, ×1.15 speed
    const def: AnimalDef = {
      ...baseDef,
      hp:              baseDef.hp + 1,
      detectionRadius: (baseDef.detectionRadius ?? 8) + 2,
      wanderSpeed:     baseDef.wanderSpeed * 1.15,
      fleeSpeed:       baseDef.fleeSpeed * 1.15,
    };

    const x = tileX + 0.5, y = tileY + 0.5;
    const el = this.createAnimalEl(def);
    document.body.appendChild(el);

    // Nameplate shown when near player
    const nameplateEl = document.createElement('div');
    nameplateEl.textContent = name;
    nameplateEl.style.cssText = `
      position: fixed;
      font: bold 10px monospace;
      color: #cc4444;
      background: rgba(0,0,0,0.75);
      padding: 2px 6px;
      border-radius: 3px;
      pointer-events: none;
      z-index: 600;
      display: none;
      transform: translateX(-50%);
      white-space: nowrap;
    `;
    document.body.appendChild(nameplateEl);

    this.animals.push({
      def, x, y, targetX: x, targetY: y, el,
      wanderTimer: Math.random() * WANDER_RETARGET,
      fleeing: false, gunFleeTimer: 0, chargingPlayer: false,
      hidden: false, currentHp: def.hp,
      blinkTimer: 0, dead: false, deadEl: null,
      predatorState: 'idle', retreatTimer: 0, attackCooldown: 0, ignoreTimer: 0,
      isManEater: true, manEaterQuestId: questId,
      manEaterName: name, nameplateEl,
    });
    return true;
  }

  // Current tile positions of all living man-eaters (for tracking).
  getActiveManEaterPositions(): { questId: string; tileX: number; tileY: number }[] {
    return this.animals
      .filter(a => a.isManEater && !a.dead && a.manEaterQuestId)
      .map(a => ({ questId: a.manEaterQuestId!, tileX: Math.floor(a.x), tileY: Math.floor(a.y) }));
  }

  // Returns save data for all active man-eaters (for persistence).
  getManEaterSaveData(): ManEaterSave[] {
    return this.animals
      .filter(a => a.isManEater && !a.dead && a.manEaterQuestId && a.manEaterName)
      .map(a => ({
        questId:      a.manEaterQuestId!,
        manEaterName: a.manEaterName!,
        animalName:   a.def.name,
        x: a.x, y: a.y,
        currentHp: a.currentHp,
      }));
  }

  // Restore a previously saved man-eater.
  restoreManEater(save: ManEaterSave): void {
    if (!this.addManEater(save.animalName, Math.floor(save.x), Math.floor(save.y), save.questId, save.manEaterName)) return;
    const inst = this.animals[this.animals.length - 1];
    inst.x = save.x;
    inst.y = save.y;
    inst.targetX = save.x;
    inst.targetY = save.y;
    inst.currentHp = save.currentHp;
  }

  destroy() {
    for (const a of this.animals) {
      a.el.remove();
      a.deadEl?.remove();
      a.nameplateEl?.remove();
    }
    this.animals = [];
    this.tooltip.remove();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private createAnimalEl(def: AnimalDef): HTMLElement {
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
    return el;
  }

  private killAnimal(a: AnimalInstance) {
    a.dead = true;
    a.nameplateEl?.remove();
    a.nameplateEl = null;
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
        // Never despawn man-eaters — keep them until dead
        if (a.isManEater) return true;
        a.el.remove();
        a.nameplateEl?.remove();
        return false;
      }
      return true;
    });
  }

  private spawn(px: number, py: number, isDay: boolean) {
    const liveCount = this.animals.filter(a => !a.dead).length;
    if (liveCount >= MAX_ANIMALS) return;
    if (!isDay) {
      const nocturnalCount = this.animals.filter(a => !a.dead && a.def.nocturnal).length;
      if (nocturnalCount >= MAX_NOCTURNAL_ANIMALS) return;
    }
    if (Math.random() > 0.15) return;

    const angle = Math.random() * Math.PI * 2;
    const dist  = SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    const tx = Math.floor(px + Math.cos(angle) * dist);
    const ty = Math.floor(py + Math.sin(angle) * dist);
    const biome = sampleBiome(tx, ty, this.elev, this.moist, this.river);
    if (!isLand(biome)) return;

    const valid = ANIMAL_DEFS.filter(d =>
      d.biomes.includes(biome) && (d.nocturnal ? !isDay : isDay)
    );
    if (valid.length === 0) return;
    this.addAnimal(pickWeighted(valid), tx + 0.5, ty + 0.5);
  }

  private addAnimal(def: AnimalDef, x: number, y: number) {
    const el = this.createAnimalEl(def);
    document.body.appendChild(el);
    this.animals.push({
      def, x, y, targetX: x, targetY: y, el,
      wanderTimer: Math.random() * WANDER_RETARGET,
      fleeing: false, gunFleeTimer: 0, chargingPlayer: false,
      hidden: false, currentHp: def.hp,
      blinkTimer: 0, dead: false, deadEl: null,
      predatorState: 'idle', retreatTimer: 0, attackCooldown: 0, ignoreTimer: 0,
      isManEater: false, manEaterQuestId: null, manEaterName: null, nameplateEl: null,
    });
  }

  // Returns attack events for this frame.
  private moveAnimals(delta: number, px: number, py: number, isDay: boolean, playerMoving: boolean): { damage: number }[] {
    const attacks: { damage: number }[] = [];

    for (const a of this.animals) {
      if (a.blinkTimer > 0) a.blinkTimer = Math.max(0, a.blinkTimer - delta);
      if (a.attackCooldown > 0) a.attackCooldown = Math.max(0, a.attackCooldown - delta);
      if (a.ignoreTimer   > 0) a.ignoreTimer   = Math.max(0, a.ignoreTimer   - delta);
      if (a.dead) continue;

      // Day/night visibility
      const visible = a.def.nocturnal ? !isDay : isDay;
      a.hidden = !visible;
      if (!visible) continue;

      const dx = px - a.x, dy = py - a.y;
      const distToPlayer = Math.sqrt(dx*dx + dy*dy);

      // ── Predator AI ────────────────────────────────────────────────────────
      if (usesPredatorAI(a)) {
        const detR = (a.def.detectionRadius ?? 8) + (a.isManEater ? 2 : 0);
        const speedBase = a.isManEater ? a.def.wanderSpeed * 1.15 : a.def.wanderSpeed;

        switch (a.predatorState) {
          case 'idle':
            if (distToPlayer < detR) {
              if (a.ignoreTimer <= 0) {
                const agg = a.isManEater ? 1.0 : (a.def.aggression ?? 1.0);
                if (Math.random() < agg) {
                  a.predatorState = 'stalking';
                } else {
                  a.ignoreTimer = 20 + Math.random() * 15; // back off for 20–35 real seconds
                }
              }
            } else {
              a.ignoreTimer = 0; // player left range — reset so next encounter rolls fresh
              this.wander(a, delta);
            }
            break;

          case 'stalking':
            if (distToPlayer > detR * 1.5) {
              a.predatorState = 'idle';
            } else if (distToPlayer < RUSH_DISTANCE) {
              a.predatorState = 'rushing';
              a.targetX = px;
              a.targetY = py;
            } else {
              // Move toward player at normal speed
              a.targetX = px;
              a.targetY = py;
            }
            break;

          case 'rushing': {
            a.targetX = px;
            a.targetY = py;
            if (distToPlayer < ATTACK_DISTANCE && a.attackCooldown <= 0) {
              // Attack!
              const baseDmg = a.def.attackDamage ?? 10;
              const damage = a.isManEater ? Math.ceil(baseDmg * 1.5) : baseDmg;
              attacks.push({ damage });
              a.attackCooldown = 2.5;
              // Retreat
              const angle = Math.atan2(a.y - py, a.x - px);
              a.targetX = a.x + Math.cos(angle) * RETREAT_TILES;
              a.targetY = a.y + Math.sin(angle) * RETREAT_TILES;
              a.retreatTimer = RETREAT_PAUSE + Math.random() * 2;
              a.predatorState = 'retreating';
            }
            break;
          }

          case 'retreating':
            a.retreatTimer -= delta;
            if (a.retreatTimer <= 0) {
              a.predatorState = distToPlayer > detR * 1.5 ? 'idle' : 'stalking';
            }
            break;
        }

        // Move toward target
        const tdx = a.targetX - a.x, tdy = a.targetY - a.y;
        const tdist = Math.sqrt(tdx*tdx + tdy*tdy);
        if (tdist > 0.05) {
          const mult = a.predatorState === 'rushing' ? RUSH_SPEED_MULT
                     : a.predatorState === 'retreating' ? 1.5
                     : 1.0;
          const step = Math.min(speedBase * mult * delta, tdist);
          a.x += (tdx / tdist) * step;
          a.y += (tdy / tdist) * step;
        }
        continue;
      }

      // ── Normal prey / passive predator movement ────────────────────────────
      if (a.gunFleeTimer > 0) {
        a.gunFleeTimer = Math.max(0, a.gunFleeTimer - delta);
        a.fleeing = true;
        if (a.chargingPlayer) {
          a.targetX = px;
          a.targetY = py;
        }
      } else {
        const effectiveFleeRadius = Math.max(0, a.def.fleeRadius - (playerMoving ? 0 : 2));
        const shouldFlee = effectiveFleeRadius > 0 && distToPlayer < effectiveFleeRadius;
        if (shouldFlee) {
          a.fleeing = true;
          const len = distToPlayer || 1;
          a.targetX = a.x - (dx / len) * 8;
          a.targetY = a.y - (dy / len) * 8;
          a.wanderTimer = WANDER_RETARGET;
        } else {
          a.fleeing = false;
          this.wander(a, delta);
        }
      }

      const speed = a.fleeing ? (a.def.fleeSpeed || a.def.wanderSpeed) : a.def.wanderSpeed;
      const tdx = a.targetX - a.x;
      const tdy = a.targetY - a.y;
      const tdist = Math.sqrt(tdx*tdx + tdy*tdy);
      if (tdist > 0.05) {
        const step = Math.min(speed * delta, tdist);
        a.x += (tdx / tdist) * step;
        a.y += (tdy / tdist) * step;
      }
    }

    return attacks;
  }

  // Pick a new wander target when the timer fires.
  private wander(a: AnimalInstance, delta: number) {
    a.wanderTimer -= delta;
    if (a.wanderTimer > 0) return;
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

  private reposition() {
    const cr = getContentRect(this.canvas);
    const px = this.lastPlayerX, py = this.lastPlayerY;

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

      if (a.hidden) {
        a.el.style.display = 'none';
        if (a.nameplateEl) a.nameplateEl.style.display = 'none';
        continue;
      }
      a.el.style.filter = a.blinkTimer > 0 ? 'sepia(1) saturate(20) hue-rotate(-20deg)' : '';
      a.el.style.display = onScreen ? 'block' : 'none';
      a.el.style.left = `${sx}px`;
      a.el.style.top  = `${sy}px`;

      // Nameplate for man-eaters
      if (a.nameplateEl) {
        const dx = a.x - px, dy = a.y - py;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const showNameplate = onScreen && dist < NAMEPLATE_RANGE;
        a.nameplateEl.style.display = showNameplate ? 'block' : 'none';
        if (showNameplate) {
          a.nameplateEl.style.left = `${sx}px`;
          a.nameplateEl.style.top  = `${sy - a.def.size * 0.8}px`;
        }
      }
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
