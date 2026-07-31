export interface DebugState {
  // Position
  tileX: number;
  tileY: number;
  visualX: number;
  visualY: number;
  distMiles: number;
  // Tile
  biome: string;
  elevation: number;
  elevationFt: number;
  moisture: number;
  riverVal: number;
  lakeVal: number;
  inWater: boolean;
  stepGrade: number;   // elevation delta from origin tile to target tile (+ = uphill)
  // Velocity — individual factors
  speedBiome: number;       // biomeProps.speedMultiplier (or 1.5 while paddling)
  speedPortage: number;     // 0.45 portaging, 1.0 otherwise
  speedWeight: number;
  speedWeather: number;
  speedMorale: number;
  speedCrampons: number;
  speedNightBoots: number;
  speedSlope: number;
  speedNet: number;         // = effectiveSpeed (product of all above)
  tph: number;              // tiles per in-game hour
  // Mode flags
  usingCanoe: boolean;
  carryingCanoe: boolean;
  inShelter: boolean;
  bleeding: boolean;
  // Stats
  health: number;
  energy: number;
  morale: number;
  warmth: number;
  food: number;
  water: number;
  minerals: number;
  canoes: number;
  pelts: number;
  rifleAmmo: number;
  medicine: number;
  // Time & weather
  daysTraveled: number;
  isDay: boolean;
  ambientTempF: number;
  currentWeather: string;
  resolvedWeather: string;
  weatherMoveMult: number;
  // Active action
  activeActionId: string | null;
  actionProgressH: number | null;
  actionDurationH: number | null;
  // World
  seed: string;
  // Rival expeditions
  rivals: DebugRivalInfo[];
}

export interface DebugRivalInfo {
  name: string;
  status: 'active' | 'lost';
  reachedCapital: boolean;
  ruinsFound: number;
  milesTraveled: number;
  capitalDistanceMiles: number;
  milesAtRuinsComplete?: number;
  dayRuinsComplete?: number;
  restDaysRemaining: number;
}

function moistureLabel(m: number) {
  if (m < 0.2) return 'Arid';
  if (m < 0.4) return 'Dry';
  if (m < 0.6) return 'Moderate';
  if (m < 0.8) return 'Humid';
  return 'Saturated';
}

function f(n: number, dec = 2) { return n.toFixed(dec); }

function row(label: string, value: string, highlight = false) {
  const vc = highlight ? '#ffdd88' : '#c8d4e0';
  const fw = highlight ? 'bold' : 'normal';
  return `<tr>
    <td style="color:#5a7a8a;padding:0 10px 2px 0;white-space:nowrap">${label}</td>
    <td style="color:${vc};font-weight:${fw}">${value}</td>
  </tr>`;
}

function divider() {
  return `<tr><td colspan="2" style="padding:2px 0 3px"><div style="border-top:1px solid #2a3a4a"></div></td></tr>`;
}

// Like row(), but stacks the value on its own line below the label instead of
// beside it — used for the RIVALS section, where values run too long to sit
// comfortably next to the name in this panel's fixed width.
function stackedRow(label: string, value: string) {
  return `<tr><td colspan="2" style="padding:0 0 6px">
    <div style="color:#5a7a8a">${label}</div>
    <div style="color:#c8d4e0">${value}</div>
  </td></tr>`;
}

function section(title: string, rows: string) {
  return `<div style="margin-bottom:12px">
    <div style="color:#4a9a60;font-size:10px;letter-spacing:.09em;text-transform:uppercase;
                border-bottom:1px solid #2a3a4a;padding-bottom:3px;margin-bottom:5px">${title}</div>
    <table style="border-collapse:collapse;font-size:11px;width:100%">${rows}</table>
  </div>`;
}

export function createDebugPanel(onWarpToMilestone?: () => void) {
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed;
    top: 0; right: 0;
    width: 270px;
    height: 100vh;
    overflow-y: auto;
    background: rgba(8,12,18,0.94);
    border-left: 1px solid #1e2e3e;
    padding: 12px 14px 20px;
    font: 11px/1.6 'Courier New', monospace;
    color: #c8d4e0;
    z-index: 3000;
    display: none;
    pointer-events: auto;
    box-sizing: border-box;
  `;
  document.body.appendChild(panel);

  // Content is rewritten wholesale every update() call — kept in its own child
  // so the warp button below (added once) doesn't get wiped along with it.
  const contentEl = document.createElement('div');
  panel.appendChild(contentEl);

  const warpBtn = document.createElement('button');
  warpBtn.textContent = 'Warp near next milestone';
  warpBtn.style.cssText = `
    width: 100%;
    margin-top: 8px;
    padding: 8px;
    background: #1e2e3e;
    border: 1px solid #3a5a7a;
    border-radius: 4px;
    color: #c8d4e0;
    font: 11px/1.4 'Courier New', monospace;
    cursor: pointer;
  `;
  warpBtn.addEventListener('mouseenter', () => { warpBtn.style.background = '#2a4a6a'; });
  warpBtn.addEventListener('mouseleave', () => { warpBtn.style.background = '#1e2e3e'; });
  warpBtn.addEventListener('click', () => onWarpToMilestone?.());
  panel.appendChild(warpBtn);

  let visible = false;

  function toggle() {
    visible = !visible;
    panel.style.display = visible ? 'block' : 'none';
  }

  function update(s: DebugState) {
    if (!visible) return;

    // Time formatting
    const dayNum   = Math.floor(s.daysTraveled) + 1;
    const hourFrac = (s.daysTraveled % 1) * 24;
    const hr       = Math.floor(hourFrac);
    const mn       = Math.floor((hourFrac - hr) * 60);
    const ampm     = hr < 12 ? 'AM' : 'PM';
    const h12      = hr % 12 || 12;
    const timeStr  = `Day ${dayNum}, ${h12}:${String(mn).padStart(2, '0')} ${ampm}`;

    // Velocity section
    const modeLabel = s.usingCanoe    ? 'paddling'
                    : s.carryingCanoe ? 'portaging'
                    : 'walking';
    const velRows = [
      row('Biome base',  `${f(s.speedBiome)} [${s.biome}]`),
      row('Mode',        `${modeLabel}${s.carryingCanoe ? ' ×0.45' : s.usingCanoe ? ' (overrides biome)' : ''}`),
      row('Weight',      `×${f(s.speedWeight)}`),
      row('Weather',     `×${f(s.speedWeather)}`),
      row('Morale',      `×${f(s.speedMorale)}`),
      row('Crampons',    `×${f(s.speedCrampons)}`),
      row('Night boots', `×${f(s.speedNightBoots)}`),
      row('Slope',       `×${f(s.speedSlope)}`),
      divider(),
      row('Net mult',    f(s.speedNet), true),
      row('TPH',         `${f(s.tph, 1)} tiles / game-hr`, true),
    ].join('');

    // Tile section
    const tileRows = [
      row('Biome',     s.biome),
      row('Elevation', `${f(s.elevation, 3)}  →  ${s.elevationFt.toLocaleString()} ft`),
      row('Moisture',  `${f(s.moisture, 3)}  (${moistureLabel(s.moisture)})`),
      row('River val', f(s.riverVal, 4)),
      row('Lake val',  f(s.lakeVal, 4)),
      row('In water',  s.inWater ? 'yes' : 'no'),
      row('Step grade', s.stepGrade === 0
        ? '— (standing)'
        : `${s.stepGrade > 0 ? '+' : ''}${f(s.stepGrade, 4)}${s.stepGrade > 0.002 ? ` → ×${f(Math.max(0.6, 1 - s.stepGrade * 50))} speed` : ' (no penalty)'}`),
    ].join('');

    // Position section
    const posRows = [
      row('Tile',      `(${s.tileX}, ${s.tileY})`),
      row('Visual',    `(${f(s.visualX, 1)}, ${f(s.visualY, 1)})`),
      row('Distance',  `${f(s.distMiles, 2)} mi from start`),
    ].join('');

    // Stats section
    const statsRows = [
      row('Health',   `${f(s.health, 1)}${s.bleeding ? '  🩸 BLEEDING' : ''}`),
      row('Energy',   f(s.energy, 1)),
      row('Morale',   f(s.morale, 1)),
      row('Warmth',   f(s.warmth, 1)),
      row('Food',     `${f(s.food, 2)} lbs`),
      row('Water',    `${f(s.water, 2)} gal`),
      divider(),
      row('Minerals', String(s.minerals)),
      row('Canoes',   String(s.canoes)),
      row('Pelts',    String(s.pelts)),
      row('Ammo',     String(s.rifleAmmo)),
      row('Medicine', String(s.medicine)),
    ].join('');

    // Time & weather section
    const weatherSame = s.resolvedWeather === s.currentWeather;
    const timeRows = [
      row('Time',       timeStr),
      row('Daylight',   s.isDay ? 'yes' : 'no'),
      row('Temp',       `${Math.round(s.ambientTempF)}°F`),
      row('Weather',    s.currentWeather),
      row('Resolved',   weatherSame ? '(same)' : s.resolvedWeather),
      row('Move mult',  `×${f(s.weatherMoveMult)}`),
      row('In shelter', s.inShelter ? 'yes' : 'no'),
    ].join('');

    // Action section
    let actionStr: string;
    if (!s.activeActionId) {
      actionStr = 'none';
    } else if (s.actionDurationH === Infinity || s.actionDurationH === null) {
      actionStr = `${s.activeActionId} (ongoing, ${f(s.actionProgressH ?? 0, 2)} hr elapsed)`;
    } else {
      actionStr = `${s.activeActionId}<br>${f(s.actionProgressH ?? 0, 2)} / ${f(s.actionDurationH, 2)} hr`;
    }
    const actionRows = row('Action', actionStr);

    // Rivals section
    const rivalRows = s.rivals.map(r => {
      let statusStr: string;
      if (r.status === 'lost') {
        statusStr = 'feared lost';
      } else if (r.reachedCapital) {
        statusStr = 'at the capital';
      } else if (r.ruinsFound >= 4) {
        const progressed = r.milesTraveled - (r.milesAtRuinsComplete ?? r.milesTraveled);
        const daysSince = typeof r.dayRuinsComplete === 'number'
          ? Math.floor(s.daysTraveled) - r.dayRuinsComplete
          : null;
        statusStr = `${f(progressed, 0)} / ${f(r.capitalDistanceMiles, 0)} mi to capital`
          + (daysSince !== null ? ` (${daysSince}d on this leg)` : '');
      } else {
        statusStr = `${r.ruinsFound}/4 ruins, ${f(r.milesTraveled, 0)} mi`;
      }
      if (r.status === 'active' && !r.reachedCapital && r.restDaysRemaining > 0) statusStr += ' (resting)';
      return stackedRow(r.name, statusStr);
    }).join('');

    contentEl.innerHTML = `
      <div style="color:#3a8a5a;font-size:10px;letter-spacing:.12em;
                  margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #2a3a4a">
        DEBUG · ${s.seed}
      </div>
      ${section('VELOCITY', velRows)}
      ${section('TILE', tileRows)}
      ${section('POSITION', posRows)}
      ${section('STATS', statsRows)}
      ${section('TIME & WEATHER', timeRows)}
      ${section('ACTION', actionRows)}
      ${section('RIVALS', rivalRows)}
    `;
  }

  return { toggle, update, isVisible: () => visible };
}
