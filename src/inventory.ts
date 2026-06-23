import type { PlayerStats } from './playerStats';
import { FOOD_CAPACITY_LBS, WATER_CAPACITY_GAL, TIMBER_CAPACITY, MINERALS_CAPACITY } from './playerStats';

interface Row {
  label: string;
  getValue: (s: PlayerStats) => string;
  cap: string;
}

const ROWS: Row[] = [
  { label: 'Food',     getValue: s => `${s.food.toFixed(1)} lbs`,    cap: `/ ${FOOD_CAPACITY_LBS} lbs` },
  { label: 'Water',    getValue: s => `${s.water.toFixed(1)} gal`,   cap: `/ ${WATER_CAPACITY_GAL} gal` },
  { label: 'Timber',   getValue: s => `${Math.floor(s.timber)}`,     cap: `/ ${TIMBER_CAPACITY}` },
  { label: 'Minerals', getValue: s => `${Math.floor(s.minerals)}`,   cap: `/ ${MINERALS_CAPACITY}` },
  { label: 'Canoes',   getValue: s => `${s.canoes}`,                 cap: '' },
];

export function createInventory(): { toggle: () => void; update: (stats: PlayerStats) => void; isOpen: () => boolean } {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0;
    display: none;
    align-items: center; justify-content: center;
    z-index: 800;
    pointer-events: none;
  `;
  document.body.appendChild(overlay);

  const panel = document.createElement('div');
  panel.style.cssText = `
    background: rgba(10, 10, 10, 0.94);
    border: 1px solid rgba(255,255,255,0.13);
    border-radius: 8px;
    padding: 22px 32px 18px;
    font: 13px/1 monospace;
    color: #ccc;
    min-width: 260px;
    pointer-events: auto;
    user-select: none;
  `;
  overlay.appendChild(panel);

  const title = document.createElement('div');
  title.textContent = 'INVENTORY';
  title.style.cssText = 'color: #888; font-size: 11px; letter-spacing: 0.1em; margin-bottom: 16px;';
  panel.appendChild(title);

  const table = document.createElement('div');
  table.style.cssText = 'display: grid; grid-template-columns: 72px 1fr 80px; row-gap: 10px; align-items: baseline;';
  panel.appendChild(table);

  const valEls: HTMLSpanElement[] = [];

  for (const row of ROWS) {
    const labelEl = document.createElement('span');
    labelEl.textContent = row.label;
    labelEl.style.cssText = 'color: #666; font-size: 12px;';

    const valEl = document.createElement('span');
    valEl.style.cssText = 'color: #ddd; text-align: right; padding-right: 10px;';
    valEls.push(valEl);

    const capEl = document.createElement('span');
    capEl.textContent = row.cap;
    capEl.style.cssText = 'color: #444; font-size: 11px;';

    table.append(labelEl, valEl, capEl);
  }

  const hint = document.createElement('div');
  hint.textContent = 'I — close';
  hint.style.cssText = 'color: #444; font-size: 11px; margin-top: 18px; text-align: right;';
  panel.appendChild(hint);

  let open = false;

  function show() {
    open = true;
    overlay.style.display = 'flex';
  }

  function hide() {
    open = false;
    overlay.style.display = 'none';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      open ? hide() : show();
    }
    if (e.key === 'Escape' && open) hide();
  });

  function update(stats: PlayerStats) {
    ROWS.forEach((row, i) => {
      valEls[i].textContent = row.getValue(stats);
    });
  }

  return { toggle: () => (open ? hide() : show()), update, isOpen: () => open };
}
