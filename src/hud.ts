import type { PlayerStats } from './playerStats';
import { getMoraleLabel } from './playerStats';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

function formatTime(daysFractional: number): string {
  const day  = Math.floor(daysFractional) + 1;
  const hour = Math.floor((daysFractional % 1) * 24);
  const h12  = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `Day ${day}, ${h12}${ampm}`;
}

function makeBarRow(label: string, color: string) {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; gap: 8px;';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = 'color: #666; font: 11px monospace; width: 44px; text-align: left; flex-shrink: 0;';
  const track = document.createElement('div');
  track.style.cssText = 'width: 110px; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; flex-shrink: 0;';
  const fill = document.createElement('div');
  fill.style.cssText = `height: 100%; width: 100%; background: ${color}; border-radius: 3px; transition: width 0.25s ease;`;
  track.appendChild(fill);
  const val = document.createElement('span');
  val.style.cssText = 'color: #888; font: 11px monospace; width: 26px; flex-shrink: 0;';
  row.append(lbl, track, val);
  return { row, fill, val };
}

function makeTextRow(label: string) {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; gap: 8px;';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = 'color: #666; font: 11px monospace; width: 44px; text-align: left; flex-shrink: 0;';
  const val = document.createElement('span');
  val.style.cssText = 'color: #999; font: 11px monospace;';
  row.append(lbl, val);
  return { row, val };
}

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

export function createHud(seed?: string, onStopAction?: () => void): (stats: PlayerStats, timeTicking: boolean, portaging?: boolean) => void {
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

  const stopBtn = document.createElement('button');
  stopBtn.textContent = '■ Stop';
  stopBtn.style.cssText = `
    display: none;
    background: none;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    color: #c09060;
    font: 11px monospace;
    padding: 2px 7px;
    cursor: pointer;
    pointer-events: auto;
    flex-shrink: 0;
  `;
  stopBtn.addEventListener('mouseenter', () => { stopBtn.style.color = '#e0b080'; stopBtn.style.borderColor = 'rgba(255,255,255,0.3)'; });
  stopBtn.addEventListener('mouseleave', () => { stopBtn.style.color = '#c09060'; stopBtn.style.borderColor = 'rgba(255,255,255,0.15)'; });
  if (onStopAction) stopBtn.addEventListener('click', onStopAction);

  topBar.append(clockEl, dayEl, milesEl, actionEl, stopBtn, conditionsEl);

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
    display: flex; align-items: center;
    padding: 0 28px;
    pointer-events: none; z-index: 1000; box-sizing: border-box;
  `;
  document.body.appendChild(bottomBar);

  // Left group: Health / Energy bars + Morale text
  const vitalsGroup = document.createElement('div');
  vitalsGroup.style.cssText = 'display: flex; flex-direction: column; justify-content: center; gap: 5px;';
  const healthRow = makeBarRow('Health', '#c94040');
  const energyRow = makeBarRow('Energy', '#8a6fbf');
  const moraleRow = makeTextRow('Morale');
  vitalsGroup.append(healthRow.row, energyRow.row, moraleRow.row);

  // Middle group: Food + Water
  const provisionsGroup = document.createElement('div');
  provisionsGroup.style.cssText = 'display: flex; flex-direction: column; justify-content: center; gap: 5px; margin-left: 28px;';
  const foodRow  = makeTextRow('Food');
  const waterRow = makeTextRow('Water');
  provisionsGroup.append(foodRow.row, waterRow.row);

  // Right: canoe indicator
  const canoeIndicator = document.createElement('div');
  canoeIndicator.style.cssText = `
    display: none;
    align-items: center;
    gap: 5px;
    margin-left: auto;
    flex-shrink: 0;
    font-size: 30px;
    line-height: 1;
    color: #ccc;
  `;
  canoeIndicator.innerHTML = '🛶<span style="font: 13px monospace; color: #aaa;"></span>';
  const canoeCount = canoeIndicator.querySelector('span') as HTMLSpanElement;

  bottomBar.append(vitalsGroup, provisionsGroup, canoeIndicator);

  // ── Layout: set bar heights to match letterbox bands ───────────────────
  function layout() {
    const h = `${getBandHeight()}px`;
    topBar.style.height    = h;
    bottomBar.style.height = h;
  }
  layout();
  window.addEventListener('resize', layout);

  // ── Update (called every frame) ────────────────────────────────────────
  return function updateHud(stats: PlayerStats, timeTicking: boolean, portaging = false) {
    clockEl.style.opacity = timeTicking ? '1' : '0';
    dayEl.textContent     = formatTime(stats.daysTraveled);
    milesEl.textContent   = `· ${stats.milesTraveled.toFixed(1)} mi`;

    if (stats.activeAction) {
      if (isFinite(stats.activeAction.durationDays)) {
        const pct = Math.min(stats.activeAction.progressDays / stats.activeAction.durationDays, 1);
        actionEl.textContent = `· ${stats.activeAction.label} ${Math.round(pct * 100)}%`;
      } else {
        const hours = Math.floor(stats.activeAction.progressDays * 24);
        actionEl.textContent = `· ${stats.activeAction.label} ${hours}h`;
      }
      const showStop = !isFinite(stats.activeAction.durationDays) || stats.activeAction.id.startsWith('build_');
      stopBtn.style.display = showStop ? 'inline-block' : 'none';
    } else {
      actionEl.textContent  = portaging ? '· Portaging 🛶' : '';
      stopBtn.style.display = 'none';
    }

    conditionsEl.textContent = stats.statusConditions.map(c => `! ${c.label}`).join('  ');

    healthRow.fill.style.width = `${stats.health}%`;
    healthRow.val.textContent  = String(Math.round(stats.health));
    energyRow.fill.style.width = `${stats.energy}%`;
    energyRow.val.textContent  = String(Math.round(stats.energy));
    moraleRow.val.textContent  = getMoraleLabel(stats.morale);
    foodRow.val.textContent    = `${stats.food.toFixed(1)} lbs`;
    waterRow.val.textContent   = `${stats.water.toFixed(1)} gal`;

    if (stats.canoes > 0) {
      canoeIndicator.style.display = 'flex';
      canoeCount.textContent = stats.canoes > 1 ? ` ×${stats.canoes}` : '';
    } else {
      canoeIndicator.style.display = 'none';
    }
  };
}
