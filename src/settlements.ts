import * as THREE from "three";
import type { NoiseFunction2D } from "simplex-noise";
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from "./constants";
import {
  sampleElevation,
  sampleMoisture,
  sampleRiver,
  sampleLake,
} from "./noise";
import { getBiome } from "./biomes";
import type { MapPinManager, MapPin } from "./mapPins";
import { MILES_PER_TILE } from "./playerStats";
import type { Trophy } from "./playerStats";
import {
  type ManEaterQuest,
  generateManEaterQuests,
  questDescription,
  MANEATER_QUEST_EXPIRE_DAYS,
} from "./manEaterQuests";

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
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function makeRng(seed: string) {
  return mulberry32(hashStr(seed));
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Name generation ───────────────────────────────────────────────────────────

const SETTLEMENT_PREFIXES = [
  "Mill",
  "East",
  "West",
  "Ash",
  "Cold",
  "Iron",
  "Green",
  "Oak",
  "Pine",
  "Clear",
  "Stone",
  "Black",
  "Salt",
  "High",
  "Old",
  "New",
  "Silver",
  "Crow",
  "Hawke",
  "Elm",
  "Moor",
  "White",
  "Brack",
  "Fen",
  "Amber",
  "Gold",
  "Red",
  "Swift",
  "Broad",
  "Burnt",
  "Long",
  "Fair",
  "Deep",
  "Sand",
];
const SETTLEMENT_SUFFIXES = [
  "haven",
  "brook",
  "ford",
  "field",
  "gate",
  "mere",
  "vale",
  "ridge",
  "hurst",
  "water",
  "bridge",
  "wick",
  "ton",
  "bury",
  "wood",
  "cliff",
  "port",
  "holm",
  "stead",
  "way",
  "cross",
  "mead",
  "moor",
  "heath",
  "croft",
];
const FORT_SURNAMES = [
  "Aldridge",
  "Pemberton",
  "Cassidy",
  "Wren",
  "Halcomb",
  "Vance",
  "Morley",
  "Dunbar",
  "Ashby",
  "Elford",
  "Carver",
  "Bramwell",
  "Holt",
  "Stirling",
  "Colby",
  "Rayne",
  "Mercer",
  "Thorne",
  "Whitby",
  "Foxley",
];

const VILLAGE_ROOTS = [
  "karu",
  "ota",
  "mira",
  "dela",
  "sanu",
  "elu",
  "noka",
  "wari",
  "venu",
  "toka",
  "ranu",
  "sela",
  "moka",
  "ashu",
  "kovi",
];
const VILLAGE_SUFFIXES = ["wen", "thar", "vok", "ela", "kesh"];

function settlementName(rng: () => number): string {
  if (rng() < 0.2) return `Fort ${pick(FORT_SURNAMES, rng)}`;
  return pick(SETTLEMENT_PREFIXES, rng) + pick(SETTLEMENT_SUFFIXES, rng);
}

function villageName(rng: () => number): string {
  const root = pick(VILLAGE_ROOTS, rng);
  const suffix = pick(VILLAGE_SUFFIXES, rng);
  const raw =
    rng() < 0.2 ? root + pick(VILLAGE_ROOTS, rng) + suffix : root + suffix;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ── World placement constants ─────────────────────────────────────────────────

const SETTLEMENT_REGION = 150; // tile side length per region cell (~7.5 mi)
const SETTLEMENT_BASE_PROB = 0.45; // probability per region cell
const SETTLEMENT_SCALE_MILES = 500; // effectively flat decay within any normal exploration range

const VILLAGE_REGION = 256; // tile side (~12.8 mi); 62% → avg ~one per 20 mi of travel
const VILLAGE_PROB = 0.62;

const SETTLEMENT_BIOMES = new Set(["plains", "hills", "forest", "beach"]);
const VILLAGE_BIOMES = new Set([
  "plains",
  "hills",
  "forest",
  "swamp",
  "snow",
  "beach",
]);

// Weighted building pool for settlements (repetition = weight)
const SETTLEMENT_EMOJIS = [
  "🏡",
  "🏡",
  "🏡",
  "🏡",
  "🏠",
  "🏠",
  "🏠",
  "🏘️",
  "🏘️",
  "🏬",
  "🏬",
  "⛪",
  "🏰",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height,
    ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) {
    h = r.height;
    w = h * ca;
    x = r.left + (r.width - w) / 2;
    y = r.top;
  } else {
    w = r.width;
    h = w / ca;
    x = r.left;
    y = r.top + (r.height - h) / 2;
  }
  return { x, y, w, h };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Building {
  tileX: number;
  tileY: number;
  el: HTMLElement;
}

interface Resident {
  x: number;       // tile space (continuous)
  y: number;
  homeX: number;
  homeY: number;
  wanderRadius: number;
  angle: number;
  speed: number;
  dirTimer: number;
  emoji: string;
  el: HTMLElement;
}

const SETTLEMENT_RESIDENTS = [
  '🧑','👨','👩','🧓','👨','👩','🧑', // people weighted higher
  '🐕','🐕',
  '🐄','🐖','🐑','🐑','🐓','🐓',
];
const VILLAGE_RESIDENTS = [
  '🧑','👨','👩','🧑','👨',
  '🐕',
  '🐖','🐑','🐓','🐓',
];

export interface SettlementSite {
  id: string;
  type: "settlement" | "village";
  name: string;
  centerTileX: number;
  centerTileY: number;
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class SettlementManager {
  private sites: SettlementSite[] = [];
  private buildings: Map<string, Building[]> = new Map();
  private residents: Map<string, Resident[]> = new Map();
  private popups: Map<string, HTMLElement> = new Map();
  private questsBtns: Map<string, HTMLElement> = new Map(); // siteId → quests button
  private discovered: Set<string> = new Set();
  private quests: Map<string, ManEaterQuest[]> = new Map(); // siteId → quests
  private questOverlay: HTMLElement;
  private questOverlayOpen = false;

  // Callbacks set each update() call.
  private _onTrade: ((site: SettlementSite) => void) | null = null;
  private _onRest: ((site: SettlementSite) => void) | null = null;
  private _onNews: (() => void) | null = null;
  private _onAcceptQuest: ((quest: ManEaterQuest) => void) | null = null;
  private _onClaimReward: ((questId: string, pelts: number) => void) | null = null;
  private _trophies: Trophy[] = [];

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera: THREE.OrthographicCamera,
    private elevNoise: NoiseFunction2D,
    private moistNoise: NoiseFunction2D,
    private riverNoise: NoiseFunction2D,
    private worldSeed: string,
    private mapPins: MapPinManager,
  ) {
    this.questOverlay = document.createElement('div');
    this.questOverlay.style.cssText = `
      position: fixed; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      z-index: 680;
      background: rgba(14,14,14,0.96);
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 8px;
      padding: 16px;
      font: 13px/1.5 monospace;
      color: #d0c080;
      max-width: 380px;
      min-width: 300px;
      max-height: 60vh;
      overflow-y: auto;
      display: none;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(this.questOverlay);
  }

  discover(
    playerTX: number,
    playerTY: number,
    startTX: number,
    startTY: number,
  ): void {
    this._discoverType("settlement", playerTX, playerTY, startTX, startTY);
    this._discoverType("village", playerTX, playerTY, startTX, startTY);
  }

  private _discoverType(
    type: "settlement" | "village",
    playerTX: number,
    playerTY: number,
    startTX: number,
    startTY: number,
  ): void {
    const regionSize =
      type === "settlement" ? SETTLEMENT_REGION : VILLAGE_REGION;
    const prX = Math.floor(playerTX / regionSize);
    const prY = Math.floor(playerTY / regionSize);

    for (let drx = -3; drx <= 3; drx++) {
      for (let dry = -3; dry <= 3; dry++) {
        const rx = prX + drx,
          ry = prY + dry;
        const key = `${type[0]}:${rx}:${ry}`;
        if (this.discovered.has(key)) continue;
        this.discovered.add(key);
        this._tryPlace(type, rx, ry, regionSize, startTX, startTY);
      }
    }
  }

  private _tryPlace(
    type: "settlement" | "village",
    rx: number,
    ry: number,
    regionSize: number,
    startTX: number,
    startTY: number,
  ): void {
    const rng = makeRng(`${this.worldSeed}_${type}_${rx}_${ry}`);

    // Distance-based probability roll
    const cx = rx * regionSize + regionSize / 2;
    const cy = ry * regionSize + regionSize / 2;
    let prob: number;
    if (type === "settlement") {
      const distMiles =
        Math.sqrt((cx - startTX) ** 2 + (cy - startTY) ** 2) * MILES_PER_TILE;
      prob =
        SETTLEMENT_BASE_PROB * Math.exp(-distMiles / SETTLEMENT_SCALE_MILES);
    } else {
      prob = VILLAGE_PROB;
    }
    if (rng() > prob) return;

    // Find a valid tile within the region
    const validBiomes =
      type === "settlement" ? SETTLEMENT_BIOMES : VILLAGE_BIOMES;
    let tileX: number | null = null,
      tileY: number | null = null;
    let tileBiome = 'forest';
    for (let attempt = 0; attempt < 25 && tileX === null; attempt++) {
      const tx = Math.round(cx + (rng() * 2 - 1) * regionSize * 0.35);
      const ty = Math.round(cy + (rng() * 2 - 1) * regionSize * 0.35);
      const elev = sampleElevation(tx, ty, this.elevNoise);
      const moist = sampleMoisture(tx, ty, this.moistNoise);
      const riv = sampleRiver(tx, ty, this.riverNoise);
      const lake = sampleLake(tx, ty, this.riverNoise);
      const b = getBiome(elev, moist, riv, lake);
      if (validBiomes.has(b)) {
        tileX = tx;
        tileY = ty;
        tileBiome = b;
      }
    }
    if (tileX === null || tileY === null) return;

    const id = `${type}_${rx}_${ry}`;
    const name = type === "settlement" ? settlementName(rng) : villageName(rng);

    // Build DOM overlay cluster
    const count =
      type === "settlement"
        ? 3 + Math.floor(rng() * 4)
        : 3 + Math.floor(rng() * 5);
    const radius = type === "settlement" ? 3 : 2;
    const bldgs: Building[] = [];
    const placed = new Set<string>([`${tileX},${tileY}`]);

    for (let attempt = 0; attempt < 200 && bldgs.length < count; attempt++) {
      const bx = Math.round(tileX + (rng() * 2 - 1) * radius);
      const by = Math.round(tileY + (rng() * 2 - 1) * radius);
      const bKey = `${bx},${by}`;
      if (placed.has(bKey)) continue;
      placed.add(bKey);

      const emoji =
        type === "settlement"
          ? SETTLEMENT_EMOJIS[Math.floor(rng() * SETTLEMENT_EMOJIS.length)]
          : "🛖";

      const el = document.createElement("div");
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

    const site: SettlementSite = {
      id,
      type,
      name,
      centerTileX: tileX,
      centerTileY: tileY,
    };
    this.sites.push(site);
    this.buildings.set(id, bldgs);

    // Residents — decorative wandering NPCs
    const residentPool = type === 'settlement' ? SETTLEMENT_RESIDENTS : VILLAGE_RESIDENTS;
    const residentCount = type === 'settlement'
      ? 4 + Math.floor(rng() * 5)   // 4–8
      : 2 + Math.floor(rng() * 4);  // 2–5
    const wanderRadius = type === 'settlement' ? 4 : 2.5;
    const resList: Resident[] = [];
    for (let i = 0; i < residentCount; i++) {
      const emoji = residentPool[Math.floor(rng() * residentPool.length)];
      const rx = tileX + (rng() * 2 - 1) * wanderRadius;
      const ry = tileY + (rng() * 2 - 1) * wanderRadius;
      const el = document.createElement('div');
      el.textContent = emoji;
      el.style.cssText = `
        position: fixed; font-size: 14px; line-height: 1;
        pointer-events: none; z-index: 614;
        transform: translate(-50%, -50%); display: none;
      `;
      document.body.appendChild(el);
      resList.push({
        x: rx, y: ry,
        homeX: tileX, homeY: tileY,
        wanderRadius,
        angle: rng() * Math.PI * 2,
        speed: 0.2 + rng() * 0.3,
        dirTimer: rng() * 4,
        emoji,
        el,
      });
    }
    this.residents.set(id, resList);

    // Village/settlement action popup
    const btnCss = `
      background: rgba(160,140,80,0.10); border: 1px solid rgba(255,255,255,0.18);
      border-radius: 4px; color: #d0c080; font: 12px/1 monospace;
      padding: 7px 14px; cursor: pointer; text-align: left; width: 100%;
    `;
    const popup = document.createElement("div");
    popup.style.cssText = `
      position: fixed; z-index: 660;
      background: rgba(14,14,14,0.92);
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 6px; padding: 10px 12px;
      font: 13px/1 monospace; color: #d0c080;
      transform: translate(-50%, -100%);
      opacity: 0; transition: opacity 0.2s ease;
      pointer-events: none;
      white-space: nowrap;
      display: flex; flex-direction: column; gap: 6px;
    `;
    const nameLabel = document.createElement("div");
    nameLabel.textContent = name;
    nameLabel.style.cssText =
      "font-size: 11px; color: #8ab890; text-align: center; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 2px;";
    const tradeBtn = document.createElement("button");
    tradeBtn.textContent = "Trade with Village";
    tradeBtn.style.cssText = btnCss;
    const restBtn = document.createElement("button");
    restBtn.textContent = "Rest in village";
    restBtn.style.cssText = btnCss;
    const newsBtn = document.createElement("button");
    newsBtn.textContent = "Expedition news";
    newsBtn.style.cssText = btnCss;
    popup.append(nameLabel, tradeBtn, restBtn, newsBtn);
    document.body.appendChild(popup);
    this.popups.set(id, popup);

    // Generate man-eater quests for villages (skip if already restored from save)
    if (type === 'village') {
      if (!this.quests.has(id)) {
        const questRng = makeRng(`${this.worldSeed}_quests_${id}`);
        const siteQuests = generateManEaterQuests(id, name, tileX, tileY, tileBiome, questRng);
        this.quests.set(id, siteQuests);
      }
      const siteQuests = this.quests.get(id)!;
      if (siteQuests.length > 0) {
        const questsBtn = document.createElement('button');
        questsBtn.textContent = `Quests (${siteQuests.length})`;
        questsBtn.style.cssText = btnCss;
        popup.append(questsBtn);
        this.questsBtns.set(id, questsBtn);
        questsBtn.addEventListener('click', () => {
          this._openQuestOverlay(site);
        });
      }
    }

    // Wire up buttons once; use instance-level callbacks so they reflect the latest call.
    tradeBtn.addEventListener("click", () => { this._onTrade?.(site); });
    restBtn.addEventListener("click",  () => { this._onRest?.(site); });
    newsBtn.addEventListener("click",  () => { this._onNews?.(); });

    // Add non-editable map pin (skip if pin already exists from a prior session's save)
    const pinColor = type === "settlement" ? "#7a6040" : "#8b2020";
    const existingPin = this.mapPins.findById(id);
    if (existingPin && existingPin.color !== pinColor) {
      this.mapPins.updateColor(id, pinColor);
    }
    if (!existingPin) {
      const elev = sampleElevation(tileX, tileY, this.elevNoise);
      const moist = sampleMoisture(tileX, tileY, this.moistNoise);
      const riv = sampleRiver(tileX, tileY, this.riverNoise);
      const lake = sampleLake(tileX, tileY, this.riverNoise);
      const elevFt = Math.round(
        (Math.max(0, elev - 0.42) / (1.0 - 0.42)) * 14400,
      );
      const pin: MapPin = {
        id,
        tileX,
        tileY,
        name,
        color: pinColor,
        fixed: true,
        dayPlaced: 0,
        elevationFt: elevFt,
        biome: getBiome(elev, moist, riv, lake),
        distanceMiles: 0,
        bearing: "",
        notes: "",
      };
      this.mapPins.add(pin);
    }
  }

  update(
    delta = 0,
    playerTX = 0,
    playerTY = 0,
    onTrade: ((site: SettlementSite) => void) | null = null,
    onRest: ((site: SettlementSite) => void) | null = null,
    menuOpen = false,
    onAcceptQuest: ((quest: ManEaterQuest) => void) | null = null,
    onClaimReward: ((questId: string, pelts: number) => void) | null = null,
    trophies: Trophy[] = [],
    daysTraveled = 0,
    onNews: (() => void) | null = null,
  ): void {
    this._onTrade = onTrade;
    this._onRest = onRest;
    this._onNews = onNews;
    this._onAcceptQuest = onAcceptQuest;
    this._onClaimReward = onClaimReward;
    this._trophies = trophies;

    // Expire old accepted quests
    if (daysTraveled > 0) this._expireQuests(daysTraveled);

    const cr = getContentRect(this.canvasEl);
    const scale = cr.w / CANVAS_WIDTH;
    const fs = Math.round(28 * scale);

    for (const site of this.sites) {
      const bldgs = this.buildings.get(site.id) ?? [];
      for (const b of bldgs) {
        const wx = (b.tileX + 0.5) * TILE_SIZE;
        const wy = -(b.tileY + 0.5) * TILE_SIZE;
        const sx =
          cr.x + (0.5 + (wx - this.camera.position.x) / CANVAS_WIDTH) * cr.w;
        const sy =
          cr.y + (0.5 - (wy - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
        const pad = 80;
        const on =
          sx >= cr.x - pad &&
          sx <= cr.x + cr.w + pad &&
          sy >= cr.y - pad &&
          sy <= cr.y + cr.h + pad;
        b.el.style.display = on ? "block" : "none";
        if (on) {
          b.el.style.left = `${sx}px`;
          b.el.style.top = `${sy}px`;
          b.el.style.fontSize = `${fs}px`;
        }
      }

      // Proximity popup
      const popup = this.popups.get(site.id);
      if (!popup) continue;
      const dx = Math.abs(playerTX - site.centerTileX);
      const dy = Math.abs(playerTY - site.centerTileY);
      const near = dx <= 4 && dy <= 4;
      const showPopup = near && !menuOpen;

      // Position above the village center tile
      const cwx = (site.centerTileX + 0.5) * TILE_SIZE;
      const cwy = -(site.centerTileY + 0.5) * TILE_SIZE;
      const csx =
        cr.x + (0.5 + (cwx - this.camera.position.x) / CANVAS_WIDTH) * cr.w;
      const csy =
        cr.y + (0.5 - (cwy - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;

      popup.style.left = `${csx}px`;
      popup.style.top = `${csy - 44}px`;
      popup.style.opacity = showPopup ? "1" : "0";
      popup.style.pointerEvents = showPopup ? "auto" : "none";

      // Move and reposition residents
      const resList = this.residents.get(site.id) ?? [];
      const rfs = Math.round(14 * scale);
      for (const r of resList) {
        // Wander: pick new direction when timer expires
        r.dirTimer -= delta;
        if (r.dirTimer <= 0) {
          // Bias angle back toward home if drifting too far
          const hx = r.homeX - r.x, hy = r.homeY - r.y;
          const distHome = Math.sqrt(hx * hx + hy * hy);
          const homeAngle = Math.atan2(hy, hx);
          const bias = Math.min(1, distHome / r.wanderRadius);
          const spread = Math.PI * (1 - bias * 0.7);
          r.angle = homeAngle + (Math.random() * 2 - 1) * spread;
          r.dirTimer = 1.5 + Math.random() * 3.5;
        }
        r.x += Math.cos(r.angle) * r.speed * delta;
        r.y += Math.sin(r.angle) * r.speed * delta;
        // Hard clamp to wander radius
        const cx2 = r.x - r.homeX, cy2 = r.y - r.homeY;
        const d = Math.sqrt(cx2 * cx2 + cy2 * cy2);
        if (d > r.wanderRadius) {
          r.x = r.homeX + (cx2 / d) * r.wanderRadius;
          r.y = r.homeY + (cy2 / d) * r.wanderRadius;
        }

        const rwx = (r.x + 0.5) * TILE_SIZE;
        const rwy = -(r.y + 0.5) * TILE_SIZE;
        const rsx = cr.x + (0.5 + (rwx - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
        const rsy = cr.y + (0.5 - (rwy - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
        const pad2 = 80;
        const onScreen = rsx >= cr.x - pad2 && rsx <= cr.x + cr.w + pad2
                      && rsy >= cr.y - pad2 && rsy <= cr.y + cr.h + pad2;
        r.el.style.display = onScreen ? 'block' : 'none';
        if (onScreen) {
          r.el.style.left     = `${rsx}px`;
          r.el.style.top      = `${rsy}px`;
          r.el.style.fontSize = `${rfs}px`;
        }
      }
    }
  }

  getSites(): SettlementSite[] {
    return [...this.sites];
  }

  getResidentDescriptionAt(tileX: number, tileY: number): string | null {
    const cx = tileX + 0.5, cy = tileY + 0.5;
    for (const resList of this.residents.values()) {
      for (const r of resList) {
        if (Math.abs(r.x - cx) < 0.75 && Math.abs(r.y - cy) < 0.75) {
          const LABELS: Record<string, string> = {
            '🧑': 'Settler', '👨': 'Settler', '👩': 'Settler', '🧓': 'Elder',
            '🐕': 'Dog', '🐄': 'Cattle', '🐖': 'Pig', '🐑': 'Sheep',
            '🐓': 'Chicken',
          };
          const label = LABELS[r.emoji] ?? 'Resident';
          return `${r.emoji} ${label}`;
        }
      }
    }
    return null;
  }

  getProximitySite(
    playerTX: number,
    playerTY: number,
    radius = 3,
  ): SettlementSite | null {
    for (const site of this.sites) {
      const dx = Math.abs(playerTX - site.centerTileX);
      const dy = Math.abs(playerTY - site.centerTileY);
      if (dx <= radius && dy <= radius) return site;
    }
    return null;
  }

  // ── Quest system ─────────────────────────────────────────────────────────

  // All accepted (but not yet expired/completed) man-eater quests across all villages.
  getAcceptedManEaterQuests(): ManEaterQuest[] {
    const result: ManEaterQuest[] = [];
    for (const quests of this.quests.values()) {
      for (const q of quests) {
        if (q.acceptedDay !== null) result.push(q);
      }
    }
    return result;
  }

  // Mark a quest as accepted and set spawned=true.
  acceptQuest(questId: string): ManEaterQuest | null {
    for (const quests of this.quests.values()) {
      const q = quests.find(q => q.id === questId);
      if (q) { q.acceptedDay = -1; return q; } // acceptedDay set by caller via returned object
    }
    return null;
  }

  // Check if visiting site has any claimable rewards (trophy in hand).
  // Returns the first matching quest if found.
  getClaimableReward(siteId: string, trophies: Trophy[]): ManEaterQuest | null {
    const quests = this.quests.get(siteId) ?? [];
    for (const q of quests) {
      if (q.completed) continue;
      if (q.acceptedDay === null) continue;
      if (trophies.some(t => t.questId === q.id)) return q;
    }
    return null;
  }

  markQuestCompleted(questId: string): void {
    for (const [siteId, quests] of this.quests.entries()) {
      const q = quests.find(q => q.id === questId);
      if (q) {
        q.completed = true;
        this._refreshQuestBtn(siteId);
        return;
      }
    }
  }

  private _refreshQuestBtn(siteId: string): void {
    const btn = this.questsBtns.get(siteId);
    if (!btn) return;
    const remaining = (this.quests.get(siteId) ?? []).filter(q => !q.completed).length;
    if (remaining === 0) {
      btn.style.display = 'none';
    } else {
      btn.textContent = `Quests (${remaining})`;
    }
  }

  // Serialise quest state for saving.
  getManEaterQuestSaveData(): { siteId: string; quests: ManEaterQuest[] }[] {
    const result: { siteId: string; quests: ManEaterQuest[] }[] = [];
    for (const [siteId, quests] of this.quests.entries()) {
      // Only save sites that have accepted or completed quests (saves space)
      if (quests.some(q => q.acceptedDay !== null || q.completed)) {
        result.push({ siteId, quests: quests.map(q => ({ ...q })) });
      }
    }
    return result;
  }

  // Restore quest state from save.
  restoreManEaterQuests(saved: { siteId: string; quests: ManEaterQuest[] }[]): void {
    for (const { siteId, quests: savedQuests } of saved) {
      const existing = this.quests.get(siteId);
      if (!existing) {
        // Village not yet generated — store for later
        this.quests.set(siteId, savedQuests);
        continue;
      }
      // Merge acceptance state onto generated quests
      for (const sq of savedQuests) {
        const eq = existing.find(q => q.id === sq.id);
        if (eq) {
          eq.acceptedDay = sq.acceptedDay;
          eq.spawned     = sq.spawned;
          eq.completed   = sq.completed;
        }
      }
    }
  }

  // ── Private quest helpers ─────────────────────────────────────────────────

  private _expireQuests(daysTraveled: number): void {
    for (const quests of this.quests.values()) {
      for (const q of quests) {
        if (q.acceptedDay === null || q.completed) continue;
        if (daysTraveled - q.acceptedDay > MANEATER_QUEST_EXPIRE_DAYS) {
          q.completed = true; // expired — treat as done (no reward claimable)
        }
      }
    }
  }

  private _openQuestOverlay(site: SettlementSite): void {
    const quests = this.quests.get(site.id) ?? [];
    const el = this.questOverlay;
    el.innerHTML = '';
    el.style.display = 'flex';
    this.questOverlayOpen = true;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:8px; margin-bottom:4px;';
    const title = document.createElement('span');
    title.textContent = `${site.name} — Quests`;
    title.style.cssText = 'font-size:12px; color:#8ab890;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none; border:none; color:#d0c080; cursor:pointer; font:14px monospace; padding:0 4px;';
    closeBtn.addEventListener('click', () => {
      el.style.display = 'none';
      this.questOverlayOpen = false;
    });
    header.append(title, closeBtn);
    el.appendChild(header);

    const btnCss = `
      background: rgba(160,140,80,0.10); border: 1px solid rgba(255,255,255,0.18);
      border-radius: 4px; color: #d0c080; font: 12px/1 monospace;
      padding: 6px 12px; cursor: pointer; margin-top: 6px;
    `;

    const visibleQuests = quests.filter(q => !q.completed);
    if (visibleQuests.length === 0) {
      const none = document.createElement('div');
      none.textContent = 'No quests available.';
      none.style.color = '#888';
      el.appendChild(none);
    }

    for (const q of visibleQuests) {
      const row = document.createElement('div');
      row.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:10px; margin-bottom:2px;';

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;';
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'font-weight:bold;';

      const hasTrophy = this._trophies.some(t => t.questId === q.id);

      nameSpan.textContent = `${q.animalEmoji} ${q.manEaterName}`;
      if (hasTrophy) nameSpan.style.color = '#7cc87c';

      const rewardSpan = document.createElement('span');
      rewardSpan.textContent = `${q.reward} pelts`;
      rewardSpan.style.cssText = 'font-size:11px; color:#a09050;';

      nameRow.append(nameSpan, rewardSpan);
      row.appendChild(nameRow);

      if (hasTrophy) {
        const msg = document.createElement('div');
        msg.textContent = `You have defeated ${q.manEaterName}!`;
        msg.style.color = '#7cc87c';
        row.appendChild(msg);
        const claimBtn = document.createElement('button');
        claimBtn.textContent = `Claim Reward: ${q.reward} pelts`;
        claimBtn.style.cssText = btnCss + 'color:#7cc87c;';
        claimBtn.addEventListener('click', () => {
          this._onClaimReward?.(q.id, q.reward);
          this.markQuestCompleted(q.id);
          this._openQuestOverlay(site); // refresh
        });
        row.appendChild(claimBtn);
      } else if (q.acceptedDay !== null) {
        const desc = document.createElement('div');
        desc.textContent = questDescription(q);
        desc.style.cssText = 'color:#a09050; font-size:11px; margin-bottom:4px;';
        row.appendChild(desc);
        const status = document.createElement('div');
        status.textContent = 'Status: hunting…';
        status.style.cssText = 'color:#888; font-size:11px;';
        row.appendChild(status);
      } else {
        // Available to accept
        const desc = document.createElement('div');
        desc.textContent = questDescription(q);
        desc.style.cssText = 'color:#c0a860; font-size:11px; margin-bottom:2px;';
        row.appendChild(desc);
        const acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept Quest';
        acceptBtn.style.cssText = btnCss;
        acceptBtn.addEventListener('click', () => {
          this._onAcceptQuest?.(q);
          this._openQuestOverlay(site); // refresh view
        });
        row.appendChild(acceptBtn);
      }

      el.appendChild(row);
    }

    // Close on outside click
    const outsideHandler = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) {
        el.style.display = 'none';
        this.questOverlayOpen = false;
        document.removeEventListener('mousedown', outsideHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', outsideHandler), 0);
  }
}
