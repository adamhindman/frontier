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

export class HuntingOverlay {
  private canvas: HTMLCanvasElement;
  private crosshair: HTMLDivElement;
  private active = false;

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
      this.crosshair.style.left = `${e.clientX}px`;
      this.crosshair.style.top  = `${e.clientY}px`;
    });
  }

  setActive(active: boolean) {
    this.active = active;
    this.canvas.style.cursor = active ? 'none' : '';
    this.crosshair.style.display = active ? 'block' : 'none';
  }

  isActive(): boolean { return this.active; }

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

  // Convert a mouse click event to tile coordinates. Returns null if outside canvas.
  getClickTile(e: MouseEvent, camera: THREE.OrthographicCamera): { tileX: number; tileY: number } | null {
    const cr = getContentRect(this.canvas);
    const lx = e.clientX - cr.x;
    const ly = e.clientY - cr.y;
    if (lx < 0 || lx > cr.w || ly < 0 || ly > cr.h) return null;
    return canvasCoordsToTile(
      (lx / cr.w) * CANVAS_WIDTH,
      (ly / cr.h) * CANVAS_HEIGHT,
      camera.position.x,
      camera.position.y,
    );
  }
}
