import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import type { RivalParty } from './rivalParties';
import { getCapitalEncounterLine } from './rivalParties';

function getContentRect(canvas: HTMLCanvasElement) {
  const r  = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else          { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StandeeEntry {
  partyId: string;
  tileX:   number;
  tileY:   number;
  el:      HTMLImageElement;
  party:   RivalParty;
}

const HOVER_RADIUS_PX = 18;
const BUBBLE_DURATION_MS = 6000;

interface BubbleState {
  el: HTMLDivElement;
  partyId: string;
  dismissTimer: ReturnType<typeof setTimeout>;
}

// Renders rival parties that have reached the capital as palette-shifted
// player sprites, standing around near the capital tile.
export class RivalSpriteManager {
  private standees: StandeeEntry[] = [];
  private tooltipEl: HTMLDivElement;
  private bubble: BubbleState | null = null;

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera:   THREE.OrthographicCamera,
    private getRivalWonRace: () => boolean = () => true,
  ) {
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.style.cssText = `
      position: fixed;
      background: rgba(14,14,14,0.94);
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 5px;
      color: #d0c080; font: 12px/1.6 monospace;
      padding: 8px 12px;
      pointer-events: none;
      z-index: 2500;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.15s ease;
    `;
    document.body.appendChild(this.tooltipEl);

    window.addEventListener('mousemove', (e) => {
      const hovered = this.standeeAt(e.clientX, e.clientY);
      if (!hovered) {
        this.tooltipEl.style.opacity = '0';
        return;
      }
      const p = hovered.party;
      const dayLabel = typeof p.dayArrived === 'number' ? `Day ${p.dayArrived + 1}` : 'unknown day';
      this.tooltipEl.innerHTML = `
        <div style="color:#e8d8a0;font-weight:bold;margin-bottom:4px">${p.name}</div>
        <div>${p.milesTraveled.toFixed(0)} mi traveled</div>
        <div>Arrived: ${dayLabel}</div>
      `;
      this.tooltipEl.style.left = `${e.clientX + 16}px`;
      this.tooltipEl.style.top  = `${e.clientY + 16}px`;
      this.tooltipEl.style.opacity = '1';
    });

    // Capture phase, like robotCompanion's click handler: runs before
    // tileInspector's/hunting's bubble-phase canvas listeners so it can
    // suppress them when the click actually lands on a standee.
    window.addEventListener('click', (e) => {
      if (e.target !== canvasEl) return;
      const clicked = this.standeeAt(e.clientX, e.clientY);
      if (!clicked) return;
      e.stopPropagation();
      this.showEncounterMessage(clicked);
    }, true);
  }

  // Used to block the tile inspector's hover/click on whatever tile happens
  // to be under the cursor near a standee — same pattern as robotCompanion's
  // isNear, wired into tileInspector's isBlockedAt param in main.ts. Relying
  // on stopPropagation() alone doesn't work here since tileInspector's own
  // click listener lives on a different node (the canvas) and independently
  // checks this rather than the event actually being suppressed.
  isNear(clientX: number, clientY: number): boolean {
    return this.standeeAt(clientX, clientY) !== null;
  }

  private standeeAt(clientX: number, clientY: number): StandeeEntry | null {
    for (const s of this.standees) {
      if (s.el.style.display === 'none') continue;
      const ex = parseFloat(s.el.style.left), ey = parseFloat(s.el.style.top);
      if (Number.isNaN(ex) || Number.isNaN(ey)) continue;
      if (Math.hypot(clientX - ex, clientY - ey) <= HOVER_RADIUS_PX) return s;
    }
    return null;
  }

  private dismissBubble(): void {
    if (!this.bubble) return;
    clearTimeout(this.bubble.dismissTimer);
    this.bubble.el.remove();
    this.bubble = null;
  }

  // Speech bubble anchored above the standee's head, repositioned each frame
  // in update() alongside it, rather than a full-screen modal — dismisses
  // itself after BUBBLE_DURATION_MS or immediately if re-triggered/clicked.
  private showEncounterMessage(entry: StandeeEntry): void {
    this.dismissBubble();
    const line = getCapitalEncounterLine(this.getRivalWonRace());

    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      max-width: 210px;
      background: rgba(20,16,10,0.96);
      border: 1px solid rgba(200,168,80,0.4);
      border-radius: 8px;
      padding: 8px 12px;
      font: 12px/1.5 Georgia, 'Book Antiqua', serif;
      color: #d8c8a0;
      text-align: center;
      pointer-events: auto;
      cursor: pointer;
      z-index: 610;
      transform: translate(-50%, -100%);
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    `;
    const nameEl = document.createElement('div');
    nameEl.textContent = entry.party.name;
    nameEl.style.cssText = 'color:#c8a84a; font-weight:bold; font-size:10px; margin-bottom:4px; letter-spacing:0.02em;';
    const lineEl = document.createElement('div');
    lineEl.textContent = line;
    lineEl.style.fontStyle = 'italic';
    const tailOuter = document.createElement('div');
    tailOuter.style.cssText = `
      position: absolute; left: 50%; bottom: -8px;
      width: 0; height: 0; transform: translateX(-50%);
      border-left: 8px solid transparent; border-right: 8px solid transparent;
      border-top: 8px solid rgba(200,168,80,0.4);
    `;
    const tailInner = document.createElement('div');
    tailInner.style.cssText = `
      position: absolute; left: 50%; bottom: -6px;
      width: 0; height: 0; transform: translateX(-50%);
      border-left: 7px solid transparent; border-right: 7px solid transparent;
      border-top: 7px solid rgba(20,16,10,0.96);
    `;
    el.append(nameEl, lineEl, tailOuter, tailInner);
    el.addEventListener('click', (e) => { e.stopPropagation(); this.dismissBubble(); });
    document.body.appendChild(el);

    this.bubble = {
      el,
      partyId: entry.partyId,
      dismissTimer: setTimeout(() => this.dismissBubble(), BUBBLE_DURATION_MS),
    };
    this.positionBubble(entry);
  }

  private positionBubble(entry: StandeeEntry): void {
    if (!this.bubble) return;
    const ex = parseFloat(entry.el.style.left), ey = parseFloat(entry.el.style.top);
    if (Number.isNaN(ex) || Number.isNaN(ey)) return;
    this.bubble.el.style.left = `${ex}px`;
    this.bubble.el.style.top  = `${ey - 18}px`;
  }

  // Adds a standee for any arrived party not already placed. Idempotent and
  // reload-safe: position + tint are derived deterministically from party.id,
  // not stored, so calling this again (e.g. after a save load) just re-adds
  // any missing standees without disturbing existing ones.
  sync(parties: RivalParty[], capitalTileX: number, capitalTileY: number, spriteUrl: string): void {
    parties.forEach((party, i) => {
      if (!party.reachedCapital) return;
      const existing = this.standees.find(s => s.partyId === party.id);
      if (existing) { existing.party = party; return; }

      const rng = mulberry32(hashStr(party.id));
      const angle = rng() * Math.PI * 2;
      // Placed a further 3-4 tiles out than a bare "near the capital" radius
      // would put them, so they don't end up hidden behind the capital's own
      // map-pin label.
      const radius = 4.5 + rng() * 2.5;
      const tileX = Math.round(capitalTileX + Math.cos(angle) * radius);
      const tileY = Math.round(capitalTileY + Math.sin(angle) * radius);
      const hue = (i + 1) * 65 % 360;

      const el = document.createElement('img');
      el.src = spriteUrl;
      el.style.cssText = `
        position: fixed;
        width: 24px;
        height: 24px;
        image-rendering: pixelated;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 599;
        filter: hue-rotate(${hue}deg) saturate(1.4);
        display: none;
      `;
      document.body.appendChild(el);
      this.standees.push({ partyId: party.id, tileX, tileY, el, party });
    });
  }

  update(): void {
    const cr    = getContentRect(this.canvasEl);
    const scale = cr.w / CANVAS_WIDTH;
    const px    = Math.round(24 * scale);

    for (const s of this.standees) {
      const worldX = (s.tileX + 0.5) * TILE_SIZE;
      const worldY = -(s.tileY + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH) * cr.w;
      const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;

      const onScreen = sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h;
      s.el.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        s.el.style.left   = `${sx}px`;
        s.el.style.top    = `${sy}px`;
        s.el.style.width  = `${px}px`;
        s.el.style.height = `${px}px`;
      }

      if (this.bubble?.partyId === s.partyId) {
        if (onScreen) this.positionBubble(s);
        else this.dismissBubble();
      }
    }
  }
}
