import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import type { WeatherEvent } from './weather';

function getContentRect(canvas: HTMLCanvasElement) {
  const r  = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else          { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

// How much slower clouds scroll than the ground as the camera moves — the
// core parallax illusion (they're "further away" than everything else). Every
// world-tile distance below is dampened by this factor once projected to
// screen space, so spawn/despawn radii must be sized in *raw* tiles large
// enough that their *apparent* (× PARALLAX) distance still lands off-screen —
// see the derivation below.
const PARALLAX = 0.35;

// Constant prevailing wind, in tiles/second of world-position drift — clouds
// creep across the sky even while the player stands still. Apparent (on
// screen) speed is this × PARALLAX; scaled down from the raw speed that felt
// right at PARALLAX 0.25 so raising PARALLAX (to make walking matter more)
// doesn't also speed up the ambient drift.
const WIND_TILES_PER_SEC_X = 6.4;
const WIND_TILES_PER_SEC_Y = 1.15;
const WIND_ANGLE = Math.atan2(WIND_TILES_PER_SEC_Y, WIND_TILES_PER_SEC_X);

// Spawn/despawn ring, mirroring the animal spawn system, but sized in *raw*
// tiles so the apparent (parallax-dampened) distance is the one that matters:
// screen half-width is 24 tiles, so apparent spawn/despawn need to clear that.
// raw = apparent / PARALLAX.
const SPAWN_APPARENT_TILES_MIN = 24;
const SPAWN_APPARENT_TILES_MAX = 30;
const DESPAWN_APPARENT_TILES   = 42;
const SPAWN_RADIUS_MIN_TILES = SPAWN_APPARENT_TILES_MIN / PARALLAX;
const SPAWN_RADIUS_MAX_TILES = SPAWN_APPARENT_TILES_MAX / PARALLAX;
const DESPAWN_RADIUS_TILES   = DESPAWN_APPARENT_TILES / PARALLAX;

function targetCloudCount(weather: WeatherEvent): number {
  switch (weather.type) {
    case 'clear':        return 2;
    case 'overcast':     return 4 + weather.intensity;
    case 'rain':         return 5 + weather.intensity;
    case 'thunderstorm': return 6 + weather.intensity;
    case 'blizzard':     return 0; // already whited out by the blizzard overlay
    case 'fog':          return 0; // already washed out by the fog overlay
    default:              return 3;
  }
}

interface CloudEntry {
  tileX: number;
  tileY: number;
  wTiles: number;
  hTiles: number;
  opacity: number;
  el: HTMLDivElement;
}

// Placeholder cloud layer: soft, semi-transparent rectangles that scroll
// slower than the ground (parallax) and drift on their own (wind), purely
// cosmetic — no gameplay effect. Swap the rectangle styling for real sprites
// later without touching the positioning/spawn logic.
export class CloudManager {
  private clouds: CloudEntry[] = [];

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera: THREE.OrthographicCamera,
  ) {}

  private spawnOne(playerTileX: number, playerTileY: number): void {
    // Bias spawn angle to the upwind side (± a spread) so wind actually
    // carries new clouds across the player's view instead of only ever
    // drifting further away before they'd have crossed it.
    const angle = WIND_ANGLE + Math.PI + (Math.random() - 0.5) * (Math.PI / 2);
    const radius = SPAWN_RADIUS_MIN_TILES + Math.random() * (SPAWN_RADIUS_MAX_TILES - SPAWN_RADIUS_MIN_TILES);
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 970;
      border-radius: 45%;
      filter: blur(6px);
      background: rgba(255,255,255,1);
      transform: translate(-50%, -50%);
      display: none;
    `;
    document.body.appendChild(el);
    this.clouds.push({
      tileX: playerTileX + Math.cos(angle) * radius,
      tileY: playerTileY + Math.sin(angle) * radius,
      wTiles: 2 + Math.random() * 3,
      hTiles: 1 + Math.random() * 1.5,
      opacity: 0.06 + Math.random() * 0.10,
      el,
    });
  }

  update(
    dtSec: number,
    playerTileX: number,
    playerTileY: number,
    weather: WeatherEvent,
  ): void {
    const target = targetCloudCount(weather);
    while (this.clouds.length < target) this.spawnOne(playerTileX, playerTileY);
    while (this.clouds.length > target) {
      const c = this.clouds.pop();
      c?.el.remove();
    }

    const cr = getContentRect(this.canvasEl);
    const scale = cr.w / CANVAS_WIDTH;

    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.tileX += WIND_TILES_PER_SEC_X * dtSec;
      c.tileY += WIND_TILES_PER_SEC_Y * dtSec;

      const dx = c.tileX - playerTileX, dy = c.tileY - playerTileY;
      if (Math.hypot(dx, dy) > DESPAWN_RADIUS_TILES) {
        c.el.remove();
        this.clouds.splice(i, 1);
        continue;
      }

      const worldX = c.tileX * TILE_SIZE;
      const worldY = -c.tileY * TILE_SIZE;
      const camDX = (worldX - this.camera.position.x) * PARALLAX;
      const camDY = (worldY - this.camera.position.y) * PARALLAX;
      const sx = cr.x + (0.5 + camDX / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - camDY / CANVAS_HEIGHT) * cr.h;
      const pw = c.wTiles * TILE_SIZE * scale;
      const ph = c.hTiles * TILE_SIZE * scale;

      const onScreen = sx + pw >= cr.x && sx - pw <= cr.x + cr.w
                    && sy + ph >= cr.y && sy - ph <= cr.y + cr.h;
      c.el.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        c.el.style.left    = `${sx}px`;
        c.el.style.top     = `${sy}px`;
        c.el.style.width   = `${pw}px`;
        c.el.style.height  = `${ph}px`;
        c.el.style.opacity = String(c.opacity);
      }
    }
  }
}
