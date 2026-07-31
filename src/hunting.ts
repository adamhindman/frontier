import * as THREE from 'three';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { canvasCoordsToTile } from './coordinates';

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

// Holding the cursor steady simulates taking careful aim: the longer it's
// been still, the less the reticle jiggles and (see getAimSteadiness, used
// by the fire handler in main.ts) the less inaccuracy gets baked into the
// shot itself. Tracked off the raw (unwobbled) mouse position — using the
// wobbled position would create a feedback loop where the wobble's own
// motion keeps resetting the steadiness that's supposed to calm it down.
const STEADY_MOVEMENT_THRESHOLD_PX = 4; // ignore sub-pixel mouse/hand noise
const STEADY_SETTLE_TIME_SEC = 1.5;
const STEADY_MIN_WOBBLE_FACTOR = 0.15; // even fully settled, some residual jiggle remains

export class HuntingOverlay {
  private canvas: HTMLCanvasElement;
  private crosshair: HTMLDivElement;
  private active = false;

  // Raw mouse position (no wobble)
  private mouseX = 0;
  private mouseY = 0;

  // Current wobble offset applied to crosshair (pixels, screen space)
  private wobbleX = 0;
  private wobbleY = 0;
  private wobblePhase = 0;

  // How long (seconds) the raw cursor has been within STEADY_MOVEMENT_THRESHOLD_PX
  // of where it was last frame — see getAimSteadiness().
  private steadyTime = 0;
  private prevMouseX = 0;
  private prevMouseY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // DOM crosshair: two lines + a small circle, all CSS
    this.crosshair = document.createElement('div');
    this.crosshair.style.cssText = `
      position: fixed;
      width: 28px;
      height: 28px;
      pointer-events: none;
      z-index: 700;
      display: none;
      transform: translate(-50%, -50%);
    `;

    const hLine = document.createElement('div');
    hLine.style.cssText = `
      position: absolute;
      top: 50%; left: 0; right: 0;
      height: 1px;
      background: rgba(255,255,255,0.9);
      transform: translateY(-50%);
    `;

    const vLine = document.createElement('div');
    vLine.style.cssText = `
      position: absolute;
      left: 50%; top: 0; bottom: 0;
      width: 1px;
      background: rgba(255,255,255,0.9);
      transform: translateX(-50%);
    `;

    const circle = document.createElement('div');
    circle.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      width: 12px; height: 12px;
      border: 1px solid rgba(255,255,255,0.9);
      border-radius: 50%;
      transform: translate(-50%, -50%);
    `;

    this.crosshair.append(hLine, vLine, circle);
    document.body.appendChild(this.crosshair);

    canvas.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      // Crosshair position is updated in update() each frame, not here.
    });
  }

  setActive(active: boolean) {
    this.active = active;
    this.canvas.style.cursor = active ? 'none' : '';
    this.crosshair.style.display = active ? 'block' : 'none';
    if (!active) {
      this.wobbleX = 0;
      this.wobbleY = 0;
      this.wobblePhase = 0;
      this.steadyTime = 0;
    }
  }

  isActive(): boolean { return this.active; }

  getMouseScreenPos(): { x: number; y: number } {
    return { x: this.mouseX, y: this.mouseY };
  }

  // 0 (just started aiming, or still moving) to 1 (held steady for
  // STEADY_SETTLE_TIME_SEC) — how "settled" the current aim is. Used both to
  // damp the visual wobble below and, by the fire handler in main.ts, to
  // reduce the actual angular inaccuracy applied to the shot.
  getAimSteadiness(): number {
    return Math.min(1, this.steadyTime / STEADY_SETTLE_TIME_SEC);
  }

  // Recoil breaks the steady aim — the player has to resettle before the
  // next shot benefits from reduced wobble/jitter again. Call right after firing.
  resetSteadiness() {
    this.steadyTime = 0;
  }

  /**
   * Advance wobble and reposition crosshair. Call every frame while active.
   * amplitudePx: how many screen pixels the reticle can drift at most.
   */
  update(dtSec: number, amplitudePx: number) {
    if (!this.active) return;

    // Track how long the raw cursor has held still — resets the moment it
    // moves more than a few px, builds back up while it doesn't.
    const movedPx = Math.hypot(this.mouseX - this.prevMouseX, this.mouseY - this.prevMouseY);
    this.steadyTime = movedPx > STEADY_MOVEMENT_THRESHOLD_PX ? 0 : this.steadyTime + dtSec;
    this.prevMouseX = this.mouseX;
    this.prevMouseY = this.mouseY;

    const steadiness = this.getAimSteadiness();
    const wobbleFactor = 1 - steadiness * (1 - STEADY_MIN_WOBBLE_FACTOR);
    const effectiveAmp = amplitudePx * wobbleFactor;

    this.wobblePhase += dtSec;
    // Two layers per axis at incommensurate frequencies — fast and hard to track.
    this.wobbleX = effectiveAmp * (Math.sin(this.wobblePhase * 8.3 + 0.5) + 0.4 * Math.sin(this.wobblePhase * 13.7 + 1.9));
    this.wobbleY = effectiveAmp * (Math.cos(this.wobblePhase * 6.1)       + 0.4 * Math.cos(this.wobblePhase * 11.3 + 0.8));
    this.crosshair.style.left = `${this.mouseX + this.wobbleX}px`;
    this.crosshair.style.top  = `${this.mouseY + this.wobbleY}px`;
  }

  // Animate a bullet streak from screen point A to screen point B.
  fireBullet(fromX: number, fromY: number, toX: number, toY: number) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    const streak = document.createElement('div');
    streak.style.cssText = `
      position: fixed;
      left: ${fromX}px;
      top: ${fromY}px;
      width: ${dist}px;
      height: 2px;
      background: rgba(255, 245, 160, 0.9);
      transform-origin: 0 50%;
      transform: rotate(${angle}deg);
      pointer-events: none;
      z-index: 699;
      opacity: 1;
      transition: opacity 200ms ease-out;
    `;
    document.body.appendChild(streak);
    requestAnimationFrame(() => { streak.style.opacity = '0'; });
    setTimeout(() => streak.remove(), 250);
  }

  // Convert a mouse click to tile coordinates, applying current wobble offset.
  getClickTile(e: MouseEvent, camera: THREE.OrthographicCamera): { tileX: number; tileY: number } | null {
    const cr = getContentRect(this.canvas);
    const lx = (e.clientX + this.wobbleX) - cr.x;
    const ly = (e.clientY + this.wobbleY) - cr.y;
    if (lx < 0 || lx > cr.w || ly < 0 || ly > cr.h) return null;
    return canvasCoordsToTile(
      (lx / cr.w) * CANVAS_WIDTH,
      (ly / cr.h) * CANVAS_HEIGHT,
      camera.position.x,
      camera.position.y,
    );
  }
}
