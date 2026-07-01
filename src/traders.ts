import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

const MAX_TRADERS     = 4;
const SPAWN_MIN       = 22;  // tiles from player
const SPAWN_MAX       = 36;
const DESPAWN_DIST    = 48;
const SPEED           = 1.1; // tiles/second
const DIR_HOLD_MIN    = 22;  // seconds between direction changes (high persistence)
const DIR_HOLD_MAX    = 55;
const PACK_OFFSET     = 1.6; // tiles behind trader where 🫏 walks
const SPAWN_INTERVAL  = 25;  // seconds between spawn attempts

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

interface TraderInstance {
  x: number; y: number;   // continuous tile-space position
  angle: number;           // radians; direction of travel
  dirTimer: number;        // seconds until next direction nudge
  mainEl: HTMLElement;     // 🚶‍➡️
  packEl: HTMLElement;     // 🫏
}

export class TraderManager {
  private traders:    TraderInstance[] = [];
  private spawnTimer: number = 5; // short delay before first spawn

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera:   THREE.OrthographicCamera,
  ) {}

  private spawn(playerX: number, playerY: number): void {
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist  = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x = playerX + Math.cos(spawnAngle) * spawnDist;
    const y = playerY + Math.sin(spawnAngle) * spawnDist;

    const mainEl = document.createElement('div');
    mainEl.textContent = '🚶‍➡️';
    mainEl.style.cssText = `
      position: fixed; font-size: 36px; line-height: 1;
      pointer-events: none; z-index: 618;
      transform: translate(-50%, -50%); display: none;
    `;
    document.body.appendChild(mainEl);

    const packEl = document.createElement('div');
    packEl.textContent = '🫏';
    packEl.style.cssText = `
      position: fixed; font-size: 26px; line-height: 1;
      pointer-events: none; z-index: 617;
      transform: translate(-50%, -50%); display: none;
    `;
    document.body.appendChild(packEl);

    this.traders.push({
      x, y,
      angle: Math.random() * Math.PI * 2,
      dirTimer: DIR_HOLD_MIN + Math.random() * (DIR_HOLD_MAX - DIR_HOLD_MIN),
      mainEl, packEl,
    });
  }

  update(dt: number, playerX: number, playerY: number): void {
    // Rate-limited spawning
    if (this.traders.length < MAX_TRADERS) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn(playerX, playerY);
        this.spawnTimer = SPAWN_INTERVAL;
      }
    }

    const cr        = getContentRect(this.canvasEl);
    const scale     = cr.w / CANVAS_WIDTH;
    const mainFs    = Math.round(36 * scale);
    const packFs    = Math.round(26 * scale);

    for (let i = this.traders.length - 1; i >= 0; i--) {
      const t = this.traders[i];

      // Direction persistence: small nudges most of the time, occasional larger turns
      t.dirTimer -= dt;
      if (t.dirTimer <= 0) {
        const bigTurn = Math.random() < 0.15;
        t.angle += (Math.random() - 0.5) * Math.PI * (bigTurn ? 1.2 : 0.4);
        t.dirTimer = DIR_HOLD_MIN + Math.random() * (DIR_HOLD_MAX - DIR_HOLD_MIN);
      }

      t.x += Math.cos(t.angle) * SPEED * dt;
      t.y += Math.sin(t.angle) * SPEED * dt;

      // Despawn if too far
      const ddx = t.x - playerX, ddy = t.y - playerY;
      if (ddx * ddx + ddy * ddy > DESPAWN_DIST * DESPAWN_DIST) {
        t.mainEl.remove();
        t.packEl.remove();
        this.traders.splice(i, 1);
        continue;
      }

      // Screen position for trader
      const wx = (t.x + 0.5) * TILE_SIZE;
      const wy = -(t.y + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (wx - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - (wy - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;

      // Screen position for pack animal (trails behind)
      const px  = t.x - Math.cos(t.angle) * PACK_OFFSET;
      const py  = t.y - Math.sin(t.angle) * PACK_OFFSET;
      const pwx = (px + 0.5) * TILE_SIZE;
      const pwy = -(py + 0.5) * TILE_SIZE;
      const psx = cr.x + (0.5 + (pwx - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const psy = cr.y + (0.5 - (pwy - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;

      const pad = 64;
      const on  = sx >= cr.x - pad && sx <= cr.x + cr.w + pad
               && sy >= cr.y - pad && sy <= cr.y + cr.h + pad;

      // Both trader and donkey face the direction of travel.
      // 🚶‍➡️ and 🫏 both default to right-facing, so flip when heading left.
      const goingLeft = Math.cos(t.angle) < 0;
      const flip = `scaleX(${goingLeft ? -1 : 1})`;

      t.mainEl.style.display = on ? 'block' : 'none';
      t.packEl.style.display = on ? 'block' : 'none';
      if (on) {
        t.mainEl.style.left      = `${sx}px`;
        t.mainEl.style.top       = `${sy}px`;
        t.mainEl.style.fontSize  = `${mainFs}px`;
        t.mainEl.style.transform = `translate(-50%, -50%) ${flip}`;

        t.packEl.style.left      = `${psx}px`;
        t.packEl.style.top       = `${psy}px`;
        t.packEl.style.fontSize  = `${packFs}px`;
        t.packEl.style.transform = `translate(-50%, -50%) ${flip}`;
      }
    }
  }
}
