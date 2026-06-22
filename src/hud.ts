import type { PlayerStats } from './playerStats';
import { FOOD_CAPACITY_LBS, WATER_CAPACITY_LBS, getMoraleLabel } from './playerStats';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

function formatTime(daysFractional: number): string {
  const day  = Math.floor(daysFractional) + 1;
  const hour = Math.floor((daysFractional % 1) * 24);
  const h12  = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `Day ${day}, ${h12}${ampm}`;
}

const STAT_BARS = [
  { key: 'health'  as const, label: 'Health',  color: '#c94040', max: 100, bar: true  },
  { key: 'food'    as const, label: 'Food',     color: '#b87428', max: FOOD_CAPACITY_LBS,  bar: false },
  { key: 'water'   as const, label: 'Water',    color: '#3a8fc4', max: WATER_CAPACITY_LBS, bar: false },
  { key: 'morale'  as const, label: 'Morale',   color: '#5a7fb8', max: 100, bar: false },
  { key: 'energy'  as const, label: 'Energy',   color: '#8a6fbf', max: 100, bar: true  },
];

// Returns the height of the top/bottom letterbox bands in CSS pixels.
// Falls back to a small overlay height if the screen is pillarboxed instead.
function getBandHeight(): number {
  const screenAspect = window.innerWidth / window.innerHeight;
  const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
  if (screenAspect <= canvasAspect) {
    return Math.max(0, (window.innerHeight - window.innerWidth / canvasAspect) / 2);
  }
  return 44; // pillarboxed fallback: thin overlay on the game edges
}

export function createHud(seed?: string): (stats: PlayerStats, timeTicking: boolean) => void {
  // ── Top bar ────────────────────────────────────────────────────────────
  const topBar = document.createElement('div');
  topBar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0;
    display: flex; align-items: center; gap: 18px;
    padding: 0 24px;
    color: #bbb; font: 13px/1 monospace;
    pointer-events: none; z-index: 1000; box-sizing: border-box;
  `;
  document.body.appendChild(topBar);

  const clockEl      = document.createElement('span');
  const dayEl        = document.createElement('span');
  const milesEl      = document.createElement('span');
  const actionEl     = document.createElement('span');
  const conditionsEl = document.createElement('span');

  clockEl.textContent      = '⏱';
  clockEl.style.cssText    = 'opacity: 0; transition: opacity 0.4s ease; font-size: 15px;';
  actionEl.style.color     = '#90b8d0';
  conditionsEl.style.color = '#d08050';

  topBar.append(clockEl, dayEl, milesEl, actionEl, conditionsEl);

  // ── Seed display (top-right) ───────────────────────────────────────────
  if (seed !== undefined) {
    const seedWrap = document.createElement('div');
    seedWrap.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: 10px; flex-shrink: 0;';

    const seedLabel = document.createElement('span');
    seedLabel.textContent = seed;
    seedLabel.style.cssText = 'color: #555; font: 11px monospace; letter-spacing: 0.03em;';

    const newWorldBtn = document.createElement('button');
    newWorldBtn.textContent = '↺';
    newWorldBtn.title = 'New world';
    newWorldBtn.style.cssText = `
      background: none;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px;
      color: #666;
      font: 13px monospace;
      line-height: 1;
      padding: 2px 6px;
      cursor: pointer;
      pointer-events: auto;
    `;
    newWorldBtn.addEventListener('mouseenter', () => { newWorldBtn.style.color = '#bbb'; newWorldBtn.style.borderColor = 'rgba(255,255,255,0.3)'; });
    newWorldBtn.addEventListener('mouseleave', () => { newWorldBtn.style.color = '#666'; newWorldBtn.style.borderColor = 'rgba(255,255,255,0.12)'; });
    newWorldBtn.addEventListener('click', () => {
      const newSeed = Math.random().toString(36).substring(2, 10);
      const url = new URL(window.location.href);
      url.searchParams.set('seed', newSeed);
      window.location.href = url.toString();
    });

    seedWrap.append(seedLabel, newWorldBtn);
    topBar.appendChild(seedWrap);
  }

  // ── Bottom bar ─────────────────────────────────────────────────────────
  const bottomBar = document.createElement('div');
  bottomBar.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0;
    display: flex; align-items: center; justify-content: center; gap: 28px;
    padding: 0 32px;
    pointer-events: none; z-index: 1000; box-sizing: border-box;
  `;
  document.body.appendChild(bottomBar);

  const statWidgets = STAT_BARS.map(cfg => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; align-items: center; gap: 8px; flex: 1; max-width: 260px;';

    const label = document.createElement('span');
    label.textContent   = cfg.label;
    label.style.cssText = 'color: #888; font: 12px monospace; width: 44px; text-align: right; flex-shrink: 0;';

    let fill: HTMLDivElement | null = null;

    if (cfg.bar) {
      const track = document.createElement('div');
      track.style.cssText = 'flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;';
      fill = document.createElement('div');
      fill.style.cssText = `height: 100%; width: 100%; background: ${cfg.color}; border-radius: 3px; transition: width 0.25s ease;`;
      track.appendChild(fill);
      wrap.appendChild(track);
    }

    const val = document.createElement('span');
    val.style.cssText = cfg.bar
      ? 'color: #aaa; font: 12px monospace; width: 36px; flex-shrink: 0;'
      : 'color: #aaa; font: 12px monospace; flex-shrink: 0;';

    wrap.prepend(label);
    wrap.append(val);
    bottomBar.appendChild(wrap);
    return { fill, val, key: cfg.key, max: cfg.max, bar: cfg.bar };
  });

  // ── Layout: set bar heights to match letterbox bands ───────────────────
  function layout() {
    const h = `${getBandHeight()}px`;
    topBar.style.height    = h;
    bottomBar.style.height = h;
  }
  layout();
  window.addEventListener('resize', layout);

  // ── Update (called every frame) ────────────────────────────────────────
  return function updateHud(stats: PlayerStats, timeTicking: boolean) {
    clockEl.style.opacity = timeTicking ? '1' : '0';
    dayEl.textContent     = formatTime(stats.daysTraveled);
    milesEl.textContent   = `· ${stats.milesTraveled.toFixed(1)} mi`;

    if (stats.activeAction) {
      const pct = Math.min(stats.activeAction.progressDays / stats.activeAction.durationDays, 1);
      actionEl.textContent = `· ${stats.activeAction.label} ${Math.round(pct * 100)}%`;
    } else {
      actionEl.textContent = '';
    }

    conditionsEl.textContent = stats.statusConditions.map(c => `! ${c.label}`).join('  ');

    for (const w of statWidgets) {
      const v = Math.max(0, stats[w.key] as number);
      if (w.fill) w.fill.style.width = `${(v / w.max) * 100}%`;
      if (w.key === 'morale') {
        w.val.textContent = `${getMoraleLabel(v)} (${Math.round(v)})`;
      } else if (w.bar) {
        w.val.textContent = String(Math.round(v));
      } else {
        w.val.textContent = `${v.toFixed(1)} lbs`;
      }
    }
  };
}
