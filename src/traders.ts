import * as THREE from 'three';
import type { NoiseFunction2D } from 'simplex-noise';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import type { PlayerStats } from './playerStats';
import { FOOD_CAPACITY_LBS, WATER_CAPACITY_GAL } from './playerStats';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome } from './biomes';

function isWaterTile(tx: number, ty: number, elev: NoiseFunction2D, moist: NoiseFunction2D, river: NoiseFunction2D): boolean {
  const b = getBiome(
    sampleElevation(tx, ty, elev),
    sampleMoisture(tx, ty, moist),
    sampleRiver(tx, ty, river),
    sampleLake(tx, ty, river),
  );
  return b === 'deep_water' || b === 'shallow_water';
}

const MAX_TRADERS    = 2;
const SPAWN_MIN      = 22;
const SPAWN_MAX      = 36;
const DESPAWN_DIST   = 48;
const SPEED          = 1.1;
const DIR_HOLD_MIN   = 22;
const DIR_HOLD_MAX   = 55;
const PACK_OFFSET    = 1.6;
const SPAWN_INTERVAL = 50;
const STOP_RADIUS    = 5;   // tiles — halt and show talk bubble within this distance

interface TraderStock {
  food:           number;
  water:          number;
  ammo:           number;
  heavyCoat:      number;
  hipWaders:      number;
  liquor:         number;
  medicine:       number;
  precisionRifle: number;
  lodestone:      number;
  tools:          number;
  crampons:       number;
}

function makeStock(): TraderStock {
  return { food: 3, water: 3, ammo: 2, heavyCoat: 1, hipWaders: 1, liquor: 2, medicine: 2, precisionRifle: 1, lodestone: 1, tools: 1, crampons: 1 };
}

interface TradeItemDef {
  key:    keyof TraderStock;
  emoji:  string;
  label:  string;
  detail: string;
  cost:   number;
  apply:  (stats: PlayerStats) => void;
}

const TRADE_ITEMS: TradeItemDef[] = [
  { key: 'food',      emoji: '🍖', label: 'Food',         detail: '20 lbs',                    cost: 1, apply: s => { s.food      = Math.min(FOOD_CAPACITY_LBS,  s.food  + 20); } },
  { key: 'water',     emoji: '💧', label: 'Water',        detail: '10 gal',                    cost: 1, apply: s => { s.water     = Math.min(WATER_CAPACITY_GAL, s.water + 10); } },
  { key: 'ammo',      emoji: '🔫', label: 'Ammunition',   detail: '10 rounds',                 cost: 1, apply: s => { s.rifleAmmo += 10; } },
  { key: 'heavyCoat', emoji: '🧥', label: 'Heavy Coat',   detail: 'Feels 10°F warmer',         cost: 10, apply: s => { s.heavyCoat++; } },
  { key: 'hipWaders', emoji: '👖', label: 'Hip Waders',   detail: 'Wade 3 tiles from shore',   cost: 4, apply: s => { s.hipWaders++; } },
  { key: 'liquor',    emoji: '🍶', label: 'Liquor',       detail: 'Restores morale & warmth',  cost: 2, apply: s => { s.liquor++; } },
  { key: 'medicine',       emoji: '💊', label: 'Medicine',        detail: 'Restores health',                           cost: 2, apply: s => { s.medicine++; } },
  { key: 'precisionRifle', emoji: '🎯', label: 'Precision Musket', detail: '+2 range · less wobble · less inaccuracy',   cost: 15, apply: s => { s.precisionRifle = 1; } },
  { key: 'lodestone',      emoji: '🧲', label: 'Lodestone',       detail: 'Points toward nearest nameless ruin',        cost: 10, apply: s => { s.lodestone = 1; } },
  { key: 'tools',          emoji: '🧰', label: 'Tools',           detail: 'Halves canoe and shelter build time',        cost:  6, apply: s => { s.tools = 1; } },
  { key: 'crampons',       emoji: '🥾', label: 'Crampons',        detail: '+50% speed in mountains and hills',          cost:  8, apply: s => { s.crampons = 1; } },
];

interface TraderInstance {
  x:       number;
  y:       number;
  angle:   number;
  dirTimer: number;
  mainEl:  HTMLElement;
  packEl:  HTMLElement;
  talkEl:  HTMLElement;
  stock:   TraderStock;
}

function getContentRect(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left; y = r.top + (r.height - h) / 2; }
  return { x, y, w, h };
}

export class TraderManager {
  private traders:        TraderInstance[] = [];
  private spawnTimer:     number           = 5;
  private tradingPaused:  boolean          = false;
  private tradeOverlayEl: HTMLElement | null = null;

  constructor(
    private canvasEl: HTMLCanvasElement,
    private camera:   THREE.OrthographicCamera,
    private elev:     NoiseFunction2D,
    private moist:    NoiseFunction2D,
    private river:    NoiseFunction2D,
  ) {}

  isTradingPaused(): boolean { return this.tradingPaused; }

  private spawn(playerX: number, playerY: number): void {
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist  = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x = playerX + Math.cos(spawnAngle) * spawnDist;
    const y = playerY + Math.sin(spawnAngle) * spawnDist;

    const mainEl = document.createElement('div');
    mainEl.textContent = '🚶‍➡️';
    mainEl.style.cssText = `
      position: fixed; font-size: 28px; line-height: 1;
      pointer-events: none; z-index: 618;
      transform: translate(-50%, -50%); display: none;
    `;
    document.body.appendChild(mainEl);

    const packEl = document.createElement('div');
    packEl.textContent = '🫏';
    packEl.style.cssText = `
      position: fixed; font-size: 20px; line-height: 1;
      pointer-events: none; z-index: 617;
      transform: translate(-50%, -50%); display: none;
    `;
    document.body.appendChild(packEl);

    const talkEl = document.createElement('div');
    talkEl.textContent = 'Talk to Trader';
    talkEl.style.cssText = `
      position: fixed;
      background: rgba(14,14,14,0.92);
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 5px;
      color: #d0c080; font: 13px/1 monospace;
      padding: 7px 16px;
      cursor: pointer;
      pointer-events: none;
      z-index: 621;
      transform: translateX(-50%);
      opacity: 0; transition: opacity 0.3s ease;
      white-space: nowrap; user-select: none;
    `;
    document.body.appendChild(talkEl);

    this.traders.push({
      x, y,
      angle:    Math.random() * Math.PI * 2,
      dirTimer: DIR_HOLD_MIN + Math.random() * (DIR_HOLD_MAX - DIR_HOLD_MIN),
      mainEl, packEl, talkEl,
      stock: makeStock(),
    });
  }

  private openMenu(title: string, stock: TraderStock, stats: PlayerStats, surcharge: number): void {
    if (this.tradeOverlayEl) return;
    this.tradingPaused = true;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 2000;
      display: flex; align-items: center; justify-content: center;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: rgba(14,14,14,0.97);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 8px;
      padding: 22px 26px;
      min-width: 380px;
      font: 13px/1 monospace;
      color: #bbb;
      box-shadow: 0 8px 40px rgba(0,0,0,0.8);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px;';
    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    titleEl.style.cssText = 'color: #d0c080; font-size: 14px;';
    const subtitle = document.createElement('span');
    subtitle.textContent = 'What do you need?';
    subtitle.style.cssText = 'color: #555; font-size: 11px;';
    header.append(titleEl, subtitle);
    panel.appendChild(header);

    const divider = document.createElement('div');
    divider.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.08); margin-bottom: 10px;';
    panel.appendChild(divider);

    // Item rows (rebuilt after each purchase to reflect updated pelts / stock)
    const rowsEl = document.createElement('div');
    panel.appendChild(rowsEl);

    const buildRows = () => {
      rowsEl.innerHTML = '';
      for (const item of TRADE_ITEMS) {
        const qty       = stock[item.key];
        const totalCost = item.cost + surcharge;
        const alreadyOwned = (item.key === 'heavyCoat'      && stats.heavyCoat > 0)
                          || (item.key === 'hipWaders'      && stats.hipWaders > 0)
                          || (item.key === 'precisionRifle' && stats.precisionRifle > 0)
                          || (item.key === 'lodestone'      && stats.lodestone > 0)
                          || (item.key === 'tools'          && stats.tools > 0)
                          || (item.key === 'crampons'       && stats.crampons > 0);
        const canAfford = stats.pelts >= totalCost;
        const inStock   = qty > 0;
        const canBuy    = canAfford && inStock;

        // Hide items the seller doesn't carry, and gear the player already owns.
        if (qty === 0 || alreadyOwned) continue;

        const row = document.createElement('div');
        row.style.cssText = `
          display: flex; align-items: center; gap: 10px;
          padding: 9px 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          opacity: ${inStock ? '1' : '0.35'};
        `;

        const icon = document.createElement('span');
        icon.textContent = item.emoji;
        icon.style.cssText = 'font-size: 18px; width: 24px; text-align: center; flex-shrink: 0;';

        const info = document.createElement('div');
        info.style.cssText = 'flex: 1; min-width: 0;';
        const name = document.createElement('div');
        name.textContent = item.label;
        name.style.cssText = `color: ${inStock ? '#c8c0a0' : '#555'}; font-size: 12px;`;
        const detail = document.createElement('div');
        detail.textContent = item.detail;
        detail.style.cssText = 'color: #555; font-size: 10px; margin-top: 3px;';
        info.append(name, detail);

        const cost = document.createElement('span');
        cost.textContent = `${totalCost} pelt${totalCost !== 1 ? 's' : ''}`;
        cost.style.cssText = `color: ${canAfford && inStock ? '#a8905a' : '#444'}; font-size: 11px; flex-shrink: 0;`;

        const stockLabel = document.createElement('span');
        stockLabel.textContent = inStock ? `×${qty}` : 'sold out';
        stockLabel.style.cssText = 'color: #555; font-size: 10px; width: 48px; text-align: right; flex-shrink: 0;';

        const buyBtn = document.createElement('button');
        buyBtn.textContent = 'Buy';
        buyBtn.disabled = !canBuy;
        buyBtn.style.cssText = `
          background: ${canBuy ? 'rgba(160,140,80,0.14)' : 'none'};
          border: 1px solid ${canBuy ? 'rgba(160,140,80,0.35)' : 'rgba(255,255,255,0.08)'};
          border-radius: 4px;
          color: ${canBuy ? '#c0a860' : '#444'};
          font: 11px monospace;
          padding: 3px 10px;
          cursor: ${canBuy ? 'pointer' : 'default'};
          flex-shrink: 0;
        `;
        if (canBuy) {
          buyBtn.addEventListener('mouseenter', () => { buyBtn.style.background = 'rgba(160,140,80,0.26)'; });
          buyBtn.addEventListener('mouseleave', () => { buyBtn.style.background = 'rgba(160,140,80,0.14)'; });
          buyBtn.addEventListener('click', () => {
            stats.pelts -= totalCost;
            stock[item.key]--;
            item.apply(stats);
            buildRows();
          });
        }

        row.append(icon, info, cost, stockLabel, buyBtn);
        rowsEl.appendChild(row);
      }
    };
    buildRows();

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top: 14px; text-align: center;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      background: none;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 4px;
      color: #777; font: 12px monospace;
      padding: 6px 28px; cursor: pointer;
    `;
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#ccc'; closeBtn.style.borderColor = 'rgba(255,255,255,0.28)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#777'; closeBtn.style.borderColor = 'rgba(255,255,255,0.14)'; });
    closeBtn.addEventListener('click', () => this.closeTradeMenu());
    footer.appendChild(closeBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.tradeOverlayEl = overlay;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeTradeMenu(); });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation(); // prevent outer handler from clearing active action
        this.closeTradeMenu();
        window.removeEventListener('keydown', onKey, true);
      }
    };
    window.addEventListener('keydown', onKey, true); // capture phase — runs before main.ts handler
  }

  private closeTradeMenu(): void {
    this.tradeOverlayEl?.remove();
    this.tradeOverlayEl = null;
    this.tradingPaused  = false;
  }

  openVillageMenu(villageName: string, villageId: string, stats: PlayerStats, distanceMiles = 0): void {
    if (this.tradingPaused) return;
    // Seed a simple RNG from the village id so each village has a consistent extra stock.
    let h = 0;
    for (let i = 0; i < villageId.length; i++) h = (Math.imul(h, 31) + villageId.charCodeAt(i)) >>> 0;
    const rng = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 0x100000000; };

    const extras = TRADE_ITEMS.filter(i => i.key !== 'food' && i.key !== 'water');
    const count = 1 + Math.floor(rng() * 2); // 1 or 2 extra items
    const picked = extras.slice().sort(() => rng() - 0.5).slice(0, count);

    const stock: TraderStock = { food: 3, water: 3, ammo: 0, heavyCoat: 0, hipWaders: 0, liquor: 0, medicine: 0, precisionRifle: 0, lodestone: 0, tools: 0, crampons: 0 };
    for (const item of picked) stock[item.key] = 1;

    this.openMenu(`🏘️  ${villageName}`, stock, stats, Math.min(3, Math.floor(distanceMiles / 150)));
  }

  update(dt: number, playerX: number, playerY: number, stats: PlayerStats, distanceMiles: number): void {
    if (this.traders.length < MAX_TRADERS) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn(playerX, playerY);
        this.spawnTimer = SPAWN_INTERVAL;
      }
    }

    const cr     = getContentRect(this.canvasEl);
    const scale  = cr.w / CANVAS_WIDTH;
    const mainFs = Math.round(28 * scale);
    const packFs = Math.round(20 * scale);

    for (let i = this.traders.length - 1; i >= 0; i--) {
      const t = this.traders[i];

      const ddx    = t.x - playerX, ddy = t.y - playerY;
      const distSq = ddx * ddx + ddy * ddy;
      const nearPlayer = distSq < STOP_RADIUS * STOP_RADIUS;

      // Halt only while the trade menu is open.
      if (!this.tradingPaused) {
        t.dirTimer -= dt;
        if (t.dirTimer <= 0) {
          const bigTurn = Math.random() < 0.15;
          t.angle += (Math.random() - 0.5) * Math.PI * (bigTurn ? 1.2 : 0.4);
          t.dirTimer = DIR_HOLD_MIN + Math.random() * (DIR_HOLD_MAX - DIR_HOLD_MIN);
        }
        t.x += Math.cos(t.angle) * SPEED * dt;
        t.y += Math.sin(t.angle) * SPEED * dt;
      }

      // Despawn if too far (use pre-move ddx/ddy — 1 frame stale, fine for 48-tile check)
      if (distSq > DESPAWN_DIST * DESPAWN_DIST) {
        t.mainEl.remove();
        t.packEl.remove();
        t.talkEl.remove();
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

      const onWater = isWaterTile(Math.floor(t.x), Math.floor(t.y), this.elev, this.moist, this.river);

      // On water: show a single canoe emoji; hide the pack animal.
      // On land: 🚶‍➡️ defaults to right-facing → flip when going left.
      //          🫏 defaults to left-facing → flip when going right.
      const goingLeft  = Math.cos(t.angle) < 0;
      const traderFlip = `scaleX(${goingLeft ? -1 : 1})`;
      const donkeyFlip = `scaleX(${goingLeft ? 1 : -1})`;

      t.mainEl.textContent = onWater ? '🛶' : '🚶‍➡️';
      t.mainEl.style.display = on ? 'block' : 'none';
      t.packEl.style.display = (on && !onWater) ? 'block' : 'none';
      if (on) {
        t.mainEl.style.left      = `${sx}px`;
        t.mainEl.style.top       = `${sy}px`;
        t.mainEl.style.fontSize  = `${onWater ? packFs : mainFs}px`;
        t.mainEl.style.transform = `translate(-50%, -50%) ${traderFlip}`;

        t.packEl.style.left      = `${psx}px`;
        t.packEl.style.top       = `${psy}px`;
        t.packEl.style.fontSize  = `${packFs}px`;
        t.packEl.style.transform = `translate(-50%, -50%) ${donkeyFlip}`;
      }

      // Talk bubble: visible when near player, on screen, and no menu already open.
      const showTalk = nearPlayer && on && !this.tradingPaused;
      t.talkEl.style.opacity      = showTalk ? '1' : '0';
      t.talkEl.style.pointerEvents = showTalk ? 'auto' : 'none';
      if (on) {
        t.talkEl.style.left = `${sx}px`;
        t.talkEl.style.top  = `${sy - Math.round(mainFs * 0.9)}px`;
      }

      // Wire up the click exactly once per trader (idempotent — listener stays for lifetime).
      if (!(t.talkEl as any).__listenerAdded) {
        (t.talkEl as any).__listenerAdded = true;
        t.talkEl.addEventListener('click', () => {
          if (!this.tradingPaused) this.openMenu('🚶‍➡️  Trader', t.stock, stats, Math.min(3, Math.floor(distanceMiles / 150)));
        });
      }
    }
  }
}
