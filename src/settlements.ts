import * as THREE from 'three';
import type { NoiseFunction2D } from 'simplex-noise';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome } from './biomes';
import type { MapPinManager, MapPin } from './mapPins';
import { MILES_PER_TILE } from './playerStats';

// ── RNG (mirrors noise.ts internals, not re-exported from there) ─────────────

function mulberry32(seed: number) {
  return (): number => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function makeRng(seed: string) { return mulberry32(hashStr(seed)); }

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Name generation ───────────────────────────────────────────────────────────

const SETTLEMENT_PREFIXES = [
  'Mill', 'East', 'West', 'Ash', 'Cold', 'Iron', 'Green', 'Oak', 'Pine', 'Clear',
  'Stone', 'Black', 'Salt', 'High', 'Old', 'New', 'Silver', 'Crow', 'Hawke', 'Elm',
  'Moor', 'White', 'Brack', 'Fen', 'Amber', 'Gold', 'Red', 'Swift', 'Broad', 'Burnt',
  'Long', 'Fair', 'Deep', 'Sand',
];
const SETTLEMENT_SUFFIXES = [
  'haven', 'brook', 'ford', 'field', 'gate', 'mere', 'vale', 'ridge', 'hurst', 'water',
  'bridge', 'wick', 'ton', 'bury', 'wood', 'cliff', 'port', 'holm', 'stead', 'way',
  'cross', 'mead', 'moor', 'heath', 'croft',
];
const FORT_SURNAMES = [
  'Aldridge', 'Pemberton', 'Cassidy', 'Wren', 'Halcomb', 'Vance', 'Morley', 'Dunbar',
  'Ashby', 'Elford', 'Carver', 'Bramwell', 'Holt', 'Stirling', 'Colby', 'Rayne',
  'Mercer', 'Thorne', 'Whitby', 'Foxley',
];

const VILLAGE_ROOTS = [
  'karu', 'ota', 'mira', 'dela', 'sanu', 'elu', 'noka', 'wari', 'venu', 'toka',
  'ranu', 'sela', 'moka', 'ashu', 'kovi',
];
const VILLAGE_SUFFIXES = ['wen', 'thar', 'vok', 'ela', 'kesh'];

function settlementName(rng: () => number): string {
  if (rng() < 0.2) return `Fort ${pick(FORT_SURNAMES, rng)}`;
  return pick(SETTLEMENT_PREFIXES, rng) + pick(SETTLEMENT_SUFFIXES, rng);
}

function villageName(rng: () => number): string {
  const root = pick(VILLAGE_ROOTS, rng);
  const suffix = pick(VILLAGE_SUFFIXES, rng);
  const raw = rng() < 0.2
    ? root + pick(VILLAGE_ROOTS, rng) + suffix
    : root + suffix;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ── World placement constants ─────────────────────────────────────────────────

const SETTLEMENT_REGION      = 200;  // tile side length per region cell (~10 mi)
const SETTLEMENT_BASE_PROB   = 0.45; // probability at origin
const SETTLEMENT_SCALE_MILES = 60;   // e-fold drop distance

const VILLAGE_REGION = 128;  // tile side (~6.4 mi); 62% → avg ~one per 10 mi of travel
const VILLAGE_PROB   = 0.62;

const SETTLEMENT_BIOMES = new Set(['plains', 'hills', 'forest', 'beach']);
const VILLAGE_BIOMES    = new Set(['plains', 'hills', 'forest', 'swamp', 'snow', 'beach']);

// Weighted building pool for settlements (repetition = weight)
const SETTLEMENT_EMOJIS = [
  '🏡', '🏡', '🏡', '🏡',
  '🏠', '🏠', '🏠',
  '🏘️', '🏘️',
  '🏬', '🏬',
  '⛪',
  '🏰',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Building {
  tileX: number;
  tileY: number;
  el: HTMLElement;
}

export interface SettlementSite {
  id: string;
  type: 'settlement' | 'village';
  name: string;
  centerTileX: number;
  centerTileY: number;
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class SettlementManager {
  private sites:      SettlementSite[] = [];
  private buildings:  Map<string, Building[]> = new Map(); // siteId → buildings
  private discovered: Set<string> = new Set();

  constructor(
    private canvasEl:   HTMLCanvasElement,
    private camera:     THREE.OrthographicCamera,
    private elevNoise:  NoiseFunction2D,
    private moistNoise: NoiseFunction2D,
    private riverNoise: NoiseFunction2D,
    private worldSeed:  string,
    private mapPins:    MapPinManager,
  ) {}

  discover(playerTX: number, playerTY: number, startTX: number, startTY: number): void {
    this._discoverType('settlement', playerTX, playerTY, startTX, startTY);
    this._discoverType('village',    playerTX, playerTY, startTX, startTY);
  }

  private _discoverType(
    type: 'settlement' | 'village',
    playerTX: number, playerTY: number,
    startTX: number, startTY: number,
  ): void {
    const regionSize = type === 'settlement' ? SETTLEMENT_REGION : VILLAGE_REGION;
    const prX = Math.floor(playerTX / regionSize);
    const prY = Math.floor(playerTY / regionSize);

    for (let drx = -3; drx <= 3; drx++) {
      for (let dry = -3; dry <= 3; dry++) {
        const rx = prX + drx, ry = prY + dry;
        const key = `${type[0]}:${rx}:${ry}`;
        if (this.discovered.has(key)) continue;
        this.discovered.add(key);
        this._tryPlace(type, rx, ry, regionSize, startTX, startTY);
      }
    }
  }

  private _tryPlace(
    type: 'settlement' | 'village',
    rx: number, ry: number,
    regionSize: number,
    startTX: number, startTY: number,
  ): void {
    const rng = makeRng(`${this.worldSeed}_${type}_${rx}_${ry}`);

    // Distance-based probability roll
    const cx = rx * regionSize + regionSize / 2;
    const cy = ry * regionSize + regionSize / 2;
    let prob: number;
    if (type === 'settlement') {
      const distMiles = Math.sqrt((cx - startTX) ** 2 + (cy - startTY) ** 2) * MILES_PER_TILE;
      prob = SETTLEMENT_BASE_PROB * Math.exp(-distMiles / SETTLEMENT_SCALE_MILES);
    } else {
      prob = VILLAGE_PROB;
    }
    if (rng() > prob) return;

    // Find a valid tile within the region
    const validBiomes = type === 'settlement' ? SETTLEMENT_BIOMES : VILLAGE_BIOMES;
    let tileX: number | null = null, tileY: number | null = null;
    for (let attempt = 0; attempt < 25 && tileX === null; attempt++) {
      const tx = Math.round(cx + (rng() * 2 - 1) * regionSize * 0.35);
      const ty = Math.round(cy + (rng() * 2 - 1) * regionSize * 0.35);
      const elev  = sampleElevation(tx, ty, this.elevNoise);
      const moist = sampleMoisture(tx, ty, this.moistNoise);
      const riv   = sampleRiver(tx, ty, this.riverNoise);
      const lake  = sampleLake(tx, ty, this.riverNoise);
      if (validBiomes.has(getBiome(elev, moist, riv, lake))) { tileX = tx; tileY = ty; }
    }
    if (tileX === null || tileY === null) return;

    const id   = `${type}_${rx}_${ry}`;
    const name = type === 'settlement' ? settlementName(rng) : villageName(rng);

    // Build DOM overlay cluster
    const count  = type === 'settlement' ? 3 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 5);
    const radius = type === 'settlement' ? 3 : 2;
    const bldgs: Building[] = [];
    const placed = new Set<string>([`${tileX},${tileY}`]);

    for (let attempt = 0; attempt < 200 && bldgs.length < count; attempt++) {
      const bx = Math.round(tileX + (rng() * 2 - 1) * radius);
      const by = Math.round(tileY + (rng() * 2 - 1) * radius);
      const bKey = `${bx},${by}`;
      if (placed.has(bKey)) continue;
      placed.add(bKey);

      const emoji = type === 'settlement'
        ? SETTLEMENT_EMOJIS[Math.floor(rng() * SETTLEMENT_EMOJIS.length)]
        : '🛖';

      const el = document.createElement('div');
      el.textContent = emoji;
      el.style.cssText = `
        position: fixed;
        font-size: 28px;
        line-height: 1;
        pointer-events: none;
        z-index: 615;
        transform: translate(-50%, -70%);
        display: none;
      `;
      document.body.appendChild(el);
      bldgs.push({ tileX: bx, tileY: by, el });
    }

    const site: SettlementSite = { id, type, name, centerTileX: tileX, centerTileY: tileY };
    this.sites.push(site);
    this.buildings.set(id, bldgs);

    // Add non-editable map pin (skip if pin already exists from a prior session's save)
    if (!this.mapPins.findById(id)) {
      const elev  = sampleElevation(tileX, tileY, this.elevNoise);
      const moist = sampleMoisture(tileX, tileY, this.moistNoise);
      const riv   = sampleRiver(tileX, tileY, this.riverNoise);
      const lake  = sampleLake(tileX, tileY, this.riverNoise);
      const elevFt = Math.round(Math.max(0, elev - 0.42) / (1.0 - 0.42) * 14400);
      const pin: MapPin = {
        id,
        tileX,
        tileY,
        name,
        color: type === 'settlement' ? '#7a6040' : '#3d6b4a',
        fixed: true,
        dayPlaced: 0,
        elevationFt: elevFt,
        biome: getBiome(elev, moist, riv, lake),
        distanceMiles: 0,
        bearing: '',
        notes: '',
      };
      this.mapPins.add(pin);
    }
  }

  update(): void {
    const cr    = getContentRect(this.canvasEl);
    const scale = cr.w / CANVAS_WIDTH;
    const fs    = Math.round(28 * scale);

    for (const [, bldgs] of this.buildings) {
      for (const b of bldgs) {
        const wx = (b.tileX + 0.5) * TILE_SIZE;
        const wy = -(b.tileY + 0.5) * TILE_SIZE;
        const sx = cr.x + (0.5 + (wx - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
        const sy = cr.y + (0.5 - (wy - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
        const pad = 80;
        const on  = sx >= cr.x - pad && sx <= cr.x + cr.w + pad
                 && sy >= cr.y - pad && sy <= cr.y + cr.h + pad;
        b.el.style.display = on ? 'block' : 'none';
        if (on) {
          b.el.style.left     = `${sx}px`;
          b.el.style.top      = `${sy}px`;
          b.el.style.fontSize = `${fs}px`;
        }
      }
    }
  }

  getProximitySite(playerTX: number, playerTY: number, radius = 3): SettlementSite | null {
    for (const site of this.sites) {
      const dx = Math.abs(playerTX - site.centerTileX);
      const dy = Math.abs(playerTY - site.centerTileY);
      if (dx <= radius && dy <= radius) return site;
    }
    return null;
  }
}
