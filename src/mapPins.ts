import * as THREE from 'three';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

export interface MapPin {
  id: string;
  tileX: number;
  tileY: number;
  name: string;
  color: string;
  fixed?: boolean;        // auto-placed, non-editable (settlements, villages)
  suggestName?: () => string; // if set, shows a "random name" button in the edit UI
  dayPlaced: number;      // game-days elapsed when the pin was created
  elevationFt: number;    // approximate feet above sea level
  biome: string;          // biome name at the tile
  distanceMiles: number;  // straight-line miles from the start tile
  bearing: string;        // 16-point compass from start, or 'at start'
  notes: string;          // user-editable freeform text
}

const STEM_H   = 44; // px, height of the line below the bubble
const SHADOW_W = 72; // px, width of the ground-shadow ellipse
const SHADOW_H =  8; // px, height of the ground-shadow ellipse

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

export class MapPinManager {
  private pins:         MapPin[]          = [];
  private wrappers:     HTMLDivElement[]  = [];
  private bubbleEls:    HTMLElement[]     = [];
  private stemEls:      HTMLElement[]     = [];
  private nameEls:      HTMLSpanElement[] = [];
  private editTriggers: (() => void)[]   = [];

  onRename: ((pinId: string, newName: string) => void) | undefined;

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera:   THREE.OrthographicCamera,
  ) {}

  add(pin: MapPin): number {
    const index = this.pins.length;
    this.pins.push(pin);

    // ── Outer wrapper — bottom-center anchors to the tile screen position ──
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: fixed;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      z-index: 650;
      transform: translate(-50%, -100%);
    `;

    // ── Bubble ─────────────────────────────────────────────────────────────
    const bubble = document.createElement('div');
    bubble.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: ${pin.color};
      padding: 7px 12px;
      white-space: nowrap;
      pointer-events: auto;
      cursor: text;
      user-select: none;
    `;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = pin.name;
    nameSpan.style.cssText = 'color:#fff; font:normal 12px/1 monospace; letter-spacing:0.03em;';

    const editIcon = document.createElement('span');
    editIcon.textContent = '✏️';
    editIcon.title = 'Edit name';
    editIcon.style.cssText = `
      color: rgba(255,255,255,0.55);
      font: 14px/1 monospace;
      cursor: pointer;
      pointer-events: auto;
      flex-shrink: 0;
    `;
    editIcon.addEventListener('mouseenter', () => { editIcon.style.color = 'rgba(255,255,255,0.9)'; });
    editIcon.addEventListener('mouseleave', () => { editIcon.style.color = 'rgba(255,255,255,0.55)'; });

    if (pin.fixed) {
      // Non-editable: no edit icon, default cursor
      bubble.style.cursor = 'default';
      bubble.append(nameSpan);
    } else {
      bubble.append(nameSpan, editIcon);
    }

    // ── Stem ───────────────────────────────────────────────────────────────
    const stem = document.createElement('div');
    stem.style.cssText = `
      width: 2px;
      height: ${STEM_H}px;
      background: ${pin.color};
      flex-shrink: 0;
    `;

    // ── Ground shadow (radial gradient ellipse) ────────────────────────────
    const shadow = document.createElement('div');
    shadow.style.cssText = `
      width: ${SHADOW_W}px;
      height: ${SHADOW_H}px;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, transparent 70%);
      flex-shrink: 0;
      margin-top: -${SHADOW_H / 2}px;
    `;

    wrapper.append(bubble, stem, shadow);
    document.body.appendChild(wrapper);
    this.wrappers.push(wrapper);
    this.bubbleEls.push(bubble);
    this.stemEls.push(stem);
    this.nameEls.push(nameSpan);

    // ── Inline editing ─────────────────────────────────────────────────────
    const startEdit = () => {
      // Prevent duplicate inputs
      if (bubble.querySelector('input')) return;

      const input = document.createElement('input');
      input.type  = 'text';
      input.value = pin.name;
      input.style.cssText = `
        background: transparent;
        border: none;
        color: #fff;
        font: bold 12px/1 monospace;
        letter-spacing: 0.03em;
        outline: none;
        width: ${Math.max(pin.name.length * 8, 90)}px;
        padding: 0;
      `;

      const commit = () => {
        const newName = input.value.trim() || pin.name;
        const changed = newName !== pin.name;
        pin.name = newName;
        nameSpan.textContent = newName;
        editRow.replaceWith(nameSpan);
        if (changed) this.onRename?.(pin.id, newName);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // prevent game hotkeys while typing
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = pin.name; input.blur(); }
      });

      const editRow = document.createElement('span');
      editRow.style.cssText = 'display:inline-flex; align-items:center; gap:6px;';
      editRow.append(input);

      if (pin.suggestName) {
        const randBtn = document.createElement('button');
        randBtn.textContent = '🎲';
        randBtn.title = 'Suggest a random name';
        randBtn.style.cssText = `
          background: rgba(255,255,255,0.15);
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 3px;
          color: #fff;
          font: 13px/1 monospace;
          cursor: pointer;
          padding: 1px 5px;
          flex-shrink: 0;
        `;
        randBtn.addEventListener('mousedown', (e) => {
          e.preventDefault(); // don't blur the input
          input.value = pin.suggestName!();
          input.style.width = `${Math.max(input.value.length * 8, 90)}px`;
          input.focus();
        });
        editRow.append(randBtn);
      }

      nameSpan.replaceWith(editRow);
      input.addEventListener('blur', commit);
      input.focus();
      input.select();
    };

    if (!pin.fixed) {
      bubble.addEventListener('click',   (e) => { e.stopPropagation(); startEdit(); });
      editIcon.addEventListener('click', (e) => { e.stopPropagation(); startEdit(); });
    }

    this.editTriggers.push(startEdit);
    return index;
  }

  findAt(tileX: number, tileY: number): number {
    return this.pins.findIndex(p => p.tileX === tileX && p.tileY === tileY);
  }

  findById(id: string): MapPin | undefined {
    return this.pins.find(p => p.id === id);
  }

  updateColor(id: string, color: string): void {
    const idx = this.pins.findIndex(p => p.id === id);
    if (idx < 0) return;
    this.pins[idx].color = color;
    this.bubbleEls[idx].style.background = color;
    this.stemEls[idx].style.background   = color;
  }

  triggerEdit(index: number): void {
    this.editTriggers[index]?.();
  }

  update(): void {
    const cr = getContentRect(this.canvasEl);
    for (let i = 0; i < this.pins.length; i++) {
      const { tileX, tileY } = this.pins[i];
      const worldX = (tileX + 0.5) * TILE_SIZE;
      const worldY = -(tileY + 0.5) * TILE_SIZE;
      const sx = cr.x + (0.5 + (worldX - this.camera.position.x) / CANVAS_WIDTH)  * cr.w;
      const sy = cr.y + (0.5 - (worldY - this.camera.position.y) / CANVAS_HEIGHT) * cr.h;

      // Hide when off-screen (same pattern as structures)
      const onScreen = sx >= cr.x && sx <= cr.x + cr.w && sy >= cr.y && sy <= cr.y + cr.h;
      this.wrappers[i].style.display = onScreen ? 'flex' : 'none';

      // Shadow center lands on the tile; shift top down by SHADOW_H/2 to compensate.
      this.wrappers[i].style.left = `${sx}px`;
      this.wrappers[i].style.top  = `${sy + SHADOW_H / 2}px`;
    }
  }

  getAll(): MapPin[] {
    return this.pins;
  }

  getSaveData(): MapPin[] {
    return this.pins.map(p => ({ ...p }));
  }

  restore(pins: MapPin[]): void {
    for (const pin of pins) this.add(pin);
  }
}
