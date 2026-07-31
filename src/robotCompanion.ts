import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT, PLAYER_SPEED } from './constants';
import type { BiomeProperties } from './biomes';

function getContentRect(canvas: HTMLCanvasElement) {
  const r  = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else          { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

const FOLLOW_DISTANCE_TILES = 4;   // robot stops once within this many tiles of the player
const ROBOT_SPEED_TILES_SEC = PLAYER_SPEED; // same base speed as the player
const CANOE_REAPPEAR_TILES  = 2;
// Clickable/hover-blocking radius around the robot, in tiles (scaled to
// screen pixels same as tile art). Deliberately larger than half a tile: the
// robot can visually sit near a tile corner, and a exactly-one-tile hit test
// makes it easy to miss-click one of the neighboring tiles instead.
const HIT_RADIUS_TILES = 0.9;
// How often (real seconds) the robot reminds you its inventory is full.
const FULL_INVENTORY_WHISTLE_INTERVAL_SEC = 60;
// Food gained per hourly forage tick — flat rather than biome-scaled so a
// full night's rest (~8 hours) nets roughly 1-2 lbs regardless of terrain.
const FOOD_LBS_PER_HOUR_MIN = 0.1;
const FOOD_LBS_PER_HOUR_MAX = 0.3;

export interface RobotCompanionSaveData {
  tileX: number;
  tileY: number;
  foodLbs: number;
  waterGal: number;
}

// Ruin-artifact companion: forages in place once per in-game hour while the
// player rests (no movement — it stays put), follows at a short distance
// otherwise, and rides invisibly along in the canoe on water. See README
// "Ruin artifacts" and artifacts.ts.
//
// Following is a plain continuous seek toward the player's live position,
// stopping once within FOLLOW_DISTANCE_TILES — no recorded path history, no
// tile-snapping when idle. Earlier attempts tried to have the robot retrace
// the player's exact path and settle precisely on a tile at rest; those two
// goals fight each other (an arc-length point along a path is essentially
// never tile-aligned) and every fix for one re-broke the other. This trades
// literal path-retracing for a much smaller, more robust implementation —
// the robot cuts corners slightly on sharp turns instead of tracing the
// exact route, and rests wherever it naturally stops rather than snapping to
// a tile center.
export class RobotCompanionManager {
  owned = false;
  private tileX = 0;
  private tileY = 0;
  private visualX = 0;
  private visualY = 0;
  private foodLbs = 0;
  private waterGal = 0;
  private hiddenForCanoe = false;
  private fullInventoryWhistleTimer = 0;
  private el: HTMLDivElement;

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera: THREE.OrthographicCamera,
    private foodCapacity: number,
    private waterCapacity: number,
    onTransfer: (food: number, water: number) => void,
    isClickBlocked: () => boolean,
  ) {
    this.el = document.createElement('div');
    this.el.textContent = '🤖';
    this.el.style.cssText = `
      position: fixed;
      font-size: 18px;
      line-height: 1;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 601;
      display: none;
    `;
    document.body.appendChild(this.el);

    // Capture phase on window, not a bubble listener on the canvas: this runs
    // before tileInspector's/hunting's own canvas click handlers regardless of
    // registration order, so stopPropagation() here can actually suppress them
    // (clicking the robot shouldn't also pop the tile-inspector tooltip).
    window.addEventListener('click', (e) => {
      if (e.target !== canvasEl) return;
      if (!this.owned || isClickBlocked()) return;
      if (!this.isNear(e.clientX, e.clientY)) return;
      e.stopPropagation();
      const transferred = this.tryTransfer();
      if (transferred) onTransfer(transferred.food, transferred.water);
      else this.spawnWhistleNotes();
    }, true);
  }

  // True if (clientX, clientY) falls within HIT_RADIUS_TILES of the robot's
  // current on-screen position. Used both for click-to-transfer and to block
  // the tile inspector's hover/click on whatever tile happens to be under the
  // cursor near the robot — see isNear usage in main.ts/tileInspector.ts.
  isNear(clientX: number, clientY: number): boolean {
    if (!this.owned || this.el.style.display === 'none') return false;
    const ex = parseFloat(this.el.style.left), ey = parseFloat(this.el.style.top);
    if (Number.isNaN(ex) || Number.isNaN(ey)) return false;
    const cr = getContentRect(this.canvasEl);
    const scale = cr.w / CANVAS_WIDTH;
    const radiusPx = TILE_SIZE * scale * HIT_RADIUS_TILES;
    return Math.hypot(clientX - ex, clientY - ey) <= radiusPx;
  }

  // A little personality touch: clicking the robot when it has nothing to
  // give (or, occasionally, just while it's out walking) plays a few bursts
  // of musical notes drifting up and fading out, as if it's whistling to
  // itself. Purely cosmetic, no gameplay effect.
  private spawnWhistleNotes(): void {
    const NOTES = ['🎵', '🎶'];
    const BURSTS = 3;
    const RISE_PX = 64;
    for (let b = 0; b < BURSTS; b++) {
      const burstDelay = b * 420;
      NOTES.forEach((note, i) => {
        const delay = burstDelay + i * 180;
        setTimeout(() => {
          const originX = this.el.style.left;
          const originY = this.el.style.top;
          if (!originX || !originY) return;
          const n = document.createElement('div');
          n.textContent = note;
          n.style.cssText = `
            position: fixed;
            left: ${originX};
            top: ${originY};
            font-size: 26px;
            pointer-events: none;
            z-index: 602;
            transform: translate(-50%, -50%);
            opacity: 1;
            transition: transform 1.1s ease-out, opacity 1.1s ease-out;
          `;
          document.body.appendChild(n);
          const drift = i === 0 ? -12 : 12;
          requestAnimationFrame(() => {
            n.style.transform = `translate(calc(-50% + ${drift}px), calc(-50% - ${RISE_PX}px))`;
            n.style.opacity = '0';
          });
          setTimeout(() => n.remove(), 1200);
        }, delay);
      });
    }
  }

  private settle(tileX: number, tileY: number): void {
    this.tileX = tileX;
    this.tileY = tileY;
    this.visualX = tileX + 0.5;
    this.visualY = tileY + 0.5;
  }

  grant(playerTileX: number, playerTileY: number): void {
    this.owned = true;
    this.settle(playerTileX, playerTileY);
    this.foodLbs = 0;
    this.waterGal = 0;
    this.hiddenForCanoe = false;
  }

  getSaveData(): RobotCompanionSaveData | null {
    if (!this.owned) return null;
    return { tileX: this.tileX, tileY: this.tileY, foodLbs: this.foodLbs, waterGal: this.waterGal };
  }

  restore(data: RobotCompanionSaveData | undefined): void {
    if (!data) return;
    this.owned = true;
    this.settle(data.tileX, data.tileY);
    this.foodLbs = data.foodLbs;
    this.waterGal = data.waterGal;
  }

  private tryTransfer(): { food: number; water: number } | null {
    if (this.foodLbs <= 0 && this.waterGal <= 0) return null;
    const result = { food: this.foodLbs, water: this.waterGal };
    this.foodLbs = 0;
    this.waterGal = 0;
    return result;
  }

  // dtSec: real (unscaled) seconds since last frame — keeps following at a
  // consistent pace regardless of how much game-time a fast-forwarded rest
  // advances per frame. playerX/playerY: the player's continuous visual
  // position (not the floored logical tile) — feeding a quantized, integer-
  // snapping position in here reintroduces jerk regardless of how smooth the
  // following logic itself is. forageHourTick: true on the one frame an
  // in-game hour crossed during rest (mirrors the "one deduction per crossed
  // hour" pattern used for build timber, main.ts).
  update(
    dtSec: number,
    playerX: number,
    playerY: number,
    isResting: boolean,
    forageHourTick: boolean,
    usingCanoe: boolean,
    getBiomeProps: (tx: number, ty: number) => BiomeProperties,
    rng: () => number = Math.random,
  ): void {
    if (!this.owned) { this.el.style.display = 'none'; return; }

    if (usingCanoe) {
      this.hiddenForCanoe = true;
      this.el.style.display = 'none';
      return;
    }
    if (this.hiddenForCanoe) {
      this.hiddenForCanoe = false;
      const angle = rng() * Math.PI * 2;
      this.settle(
        playerX + Math.cos(angle) * CANOE_REAPPEAR_TILES,
        playerY + Math.sin(angle) * CANOE_REAPPEAR_TILES,
      );
    }

    if (isResting) {
      // Stays put and forages in place — no wandering while the player rests.
      if (forageHourTick) {
        const biome = getBiomeProps(Math.round(this.tileX), Math.round(this.tileY));
        const foodGain = FOOD_LBS_PER_HOUR_MIN + rng() * (FOOD_LBS_PER_HOUR_MAX - FOOD_LBS_PER_HOUR_MIN);
        this.foodLbs  = Math.min(this.foodCapacity,  this.foodLbs  + foodGain);
        this.waterGal = Math.min(this.waterCapacity, this.waterGal + rng() * 2 * biome.forageWaterGalPerHour);
      }
    } else {
      const dx = playerX - this.tileX, dy = playerY - this.tileY;
      const dist = Math.hypot(dx, dy);
      const excess = dist - FOLLOW_DISTANCE_TILES;
      if (excess > 1e-4) {
        const step = Math.min(excess, ROBOT_SPEED_TILES_SEC * dtSec);
        this.tileX += (dx / dist) * step;
        this.tileY += (dy / dist) * step;
      }
    }

    // Informative whistle: reminds you every minute that its food/water
    // inventory is full and ready to be collected.
    const inventoryFull = this.foodLbs >= this.foodCapacity || this.waterGal >= this.waterCapacity;
    if (inventoryFull) {
      this.fullInventoryWhistleTimer += dtSec;
      if (this.fullInventoryWhistleTimer >= FULL_INVENTORY_WHISTLE_INTERVAL_SEC) {
        this.fullInventoryWhistleTimer = 0;
        this.spawnWhistleNotes();
      }
    } else {
      this.fullInventoryWhistleTimer = 0;
    }

    this.visualX = this.tileX + 0.5;
    this.visualY = this.tileY + 0.5;
    this.reposition();
  }

  private reposition(): void {
    const cr = getContentRect(this.canvasEl);
    const worldX = this.visualX * TILE_SIZE;
    const worldY = -this.visualY * TILE_SIZE;
    const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH) * cr.w;
    const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;
    const onScreen = sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h;
    this.el.style.display = onScreen ? 'block' : 'none';
    if (onScreen) {
      this.el.style.left = `${sx}px`;
      this.el.style.top  = `${sy}px`;
    }
  }
}
