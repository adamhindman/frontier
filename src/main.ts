import * as THREE from 'three';
import { createNoiseGenerators } from './noise';
import { ChunkManager } from './chunkManager';
import { Player } from './player';
import { createInputHandler } from './input';
import { createTileInspector } from './tileInspector';
import { createStats, updateStats, getWeightMultiplier, isDaylight, MILES_PER_TILE } from './playerStats';
import { createHud } from './hud';
import { StructureManager, DroppedCanoeManager, CANOE_TIMBER_COST, SHELTER_TIMBER_COST, CAMPFIRE_TIMBER_COST, STRUCTURE_CONFIGS } from './structures';
import { TimberPileManager } from './timberPiles';
import { saveGame, loadGame, deleteSave } from './save';
import { createRadialMenu } from './radialMenu';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome, BIOMES, BiomeProperties } from './biomes';
import { SEED, CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE, CHUNK_WIDTH, CHUNK_HEIGHT, SURVEY_CHUNK_RADIUS, SURVEY_PAN_SPEED } from './constants';

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// --- Camera ---
const hw = CANVAS_WIDTH  / 2;
const hh = CANVAS_HEIGHT / 2;
const camera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, -10, 10);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
renderer.domElement.style.cssText = `
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
`;
document.body.appendChild(renderer.domElement);

// --- Seed: read from URL param; write it back so reloads preserve it ---
function resolveSeed(): string {
  const params = new URLSearchParams(window.location.search);
  const s = params.get('seed');
  if (s) return s;
  const url = new URL(window.location.href);
  url.searchParams.set('seed', SEED);
  window.history.replaceState(null, '', url.toString());
  return SEED;
}
const currentSeed = resolveSeed();

// --- World ---
const { elevation, moisture, river } = createNoiseGenerators(currentSeed);
const chunkManager = new ChunkManager(scene, elevation, moisture, river);

// --- Player & input ---
const player = new Player(scene);
const input  = createInputHandler();
const radialMenu = createRadialMenu(renderer.domElement, camera, (_tileX, _tileY) => {
  const daylight = isDaylight(stats.daysTraveled);
  const onWater  = isWaterBiome(Math.floor(player.tileX), Math.floor(player.tileY));
  const ptx = Math.floor(player.tileX), pty = Math.floor(player.tileY);
  const aboveTreeline = sampleElevation(ptx, pty, elevation) >= 0.76;
  return [
    {
      label: 'Rest \'til Dawn',
      disabled: onWater || aboveTreeline,
      action: () => {
        const frac = stats.daysTraveled % 1;
        const morning = 6 / 24;
        const toNextDawn = frac < morning ? morning - frac : (1 + morning) - frac;
        const duration = toNextDawn < 2 / 24 ? toNextDawn + 1 : toNextDawn;
        stats.activeAction = { id: 'rest', label: 'Resting', durationDays: duration, progressDays: 0, energyMultiplier: 1.5 };
        const ptx = Math.floor(player.tileX), pty = Math.floor(player.tileY);
        const fireTile = findAdjacentLandTile(ptx, pty) ?? { tileX: ptx + 1, tileY: pty };
        const idx = structures.add(fireTile.tileX, fireTile.tileY, 'campfire');
        structures.complete(idx, stats);
        const timberNeeded = Math.ceil(duration * 24 / 2);
        timberPiles.addAmount(fireTile.tileX, fireTile.tileY, timberNeeded, isWaterBiome);
        stats.bodyTemp = 100;
      },
    },
    {
      label: 'Forage',
      disabled: !daylight,
      action: () => { stats.activeAction = { id: 'forage', label: 'Foraging', durationDays: Infinity, progressDays: 0 }; },
    },
    {
      label: 'Harvest',
      children: [
        { label: 'Timber',   disabled: !daylight || aboveTreeline, action: () => { stats.activeAction = { id: 'harvest_timber',   label: 'Harvesting timber',   durationDays: Infinity, progressDays: 0 }; } },
        { label: 'Minerals', disabled: !daylight, action: () => { stats.activeAction = { id: 'harvest_minerals', label: 'Harvesting minerals', durationDays: Infinity, progressDays: 0 }; } },
      ],
    },
    {
      label: 'Survey',
      disabled: !daylight || onWater,
      action: () => enterSurvey(),
    },
    {
      label: 'Drop Canoe',
      disabled: stats.canoes === 0,
      action: () => {
        stats.canoes--;
        droppedCanoes.drop(Math.floor(player.tileX) + 1, Math.floor(player.tileY));
      },
    },
    {
      label: 'Build',
      children: (() => {
        const tileX = Math.floor(player.tileX);
        const tileY = Math.floor(player.tileY);
        const existingCanoe    = structures.findUnfinished(tileX, tileY, 'canoe');
        const existingShelter  = structures.findUnfinished(tileX, tileY, 'shelter');
        // Campfire is placed on an adjacent tile — search all four neighbors.
        const existingCampfire = (() => {
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]) {
            const idx = structures.findUnfinished(tileX+dx, tileY+dy, 'campfire');
            if (idx >= 0) return idx;
          }
          return -1;
        })();
        const adjacentTimber = timberPiles.getAdjacentAmount(tileX, tileY);
        return [
          {
            label: existingCanoe >= 0 ? 'Resume Canoe' : `Canoe (${CANOE_TIMBER_COST}🪵)`,
            disabled: !daylight || (existingCanoe < 0 && adjacentTimber < CANOE_TIMBER_COST),
            action: () => {
              const cfg = STRUCTURE_CONFIGS.canoe;
              const timberPerHour = cfg.timberCost / cfg.totalHours;
              if (existingCanoe >= 0) {
                stats.activeAction = { id: 'build_canoe', label: 'Building canoe', durationDays: cfg.totalHours / 24, progressDays: structures.getProgressDays(existingCanoe), structureIndex: existingCanoe, timberPerHour };
              } else {
                const idx = structures.add(tileX, tileY, 'canoe');
                stats.activeAction = { id: 'build_canoe', label: 'Building canoe', durationDays: cfg.totalHours / 24, progressDays: 0, structureIndex: idx, timberPerHour };
              }
            },
          },
          {
            label: existingShelter >= 0 ? 'Resume Shelter' : `Shelter (${SHELTER_TIMBER_COST}🪵)`,
            disabled: !daylight || (existingShelter < 0 && adjacentTimber < SHELTER_TIMBER_COST),
            action: () => {
              const cfg = STRUCTURE_CONFIGS.shelter;
              const timberPerHour = cfg.timberCost / cfg.totalHours;
              if (existingShelter >= 0) {
                stats.activeAction = { id: 'build_shelter', label: 'Building shelter', durationDays: cfg.totalHours / 24, progressDays: structures.getProgressDays(existingShelter), structureIndex: existingShelter, timberPerHour };
              } else {
                const idx = structures.add(tileX, tileY, 'shelter');
                stats.activeAction = { id: 'build_shelter', label: 'Building shelter', durationDays: cfg.totalHours / 24, progressDays: 0, structureIndex: idx, timberPerHour };
              }
            },
          },
          {
            label: existingCampfire >= 0 ? 'Resume Campfire' : 'Campfire',
            disabled: onWater || aboveTreeline || (existingCampfire < 0 && timberPiles.getAmountWithin(tileX, tileY, 3) < 1),
            action: () => {
              const cfg = STRUCTURE_CONFIGS.campfire;
              const timberPerHour = cfg.timberCost / cfg.totalHours;
              if (existingCampfire >= 0) {
                // Resume: player stays on their current tile; structure is already placed.
                stats.activeAction = { id: 'build_campfire', label: 'Building campfire', durationDays: cfg.totalHours / 24, progressDays: structures.getProgressDays(existingCampfire), structureIndex: existingCampfire, timberPerHour, buildTileX: tileX, buildTileY: tileY };
              } else {
                const adjTile = findAdjacentLandTile(tileX, tileY);
                if (!adjTile) return;
                const idx = structures.add(adjTile.tileX, adjTile.tileY, 'campfire');
                stats.activeAction = { id: 'build_campfire', label: 'Building campfire', durationDays: cfg.totalHours / 24, progressDays: 0, structureIndex: idx, timberPerHour, buildTileX: tileX, buildTileY: tileY };
              }
            },
          },
        ];
      })(),
    },
  ];
});
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    radialMenu.openAtTile(player.tileX, player.tileY);
  }
  if (e.key === 'Escape' && stats.activeAction) {
    if (stats.activeAction.id === 'survey') exitSurvey();
    stats.activeAction = null;
  }
});

let playerMoving = false;
const tileInspector = createTileInspector(
  renderer.domElement, scene, camera, elevation, moisture, river,
  () => radialMenu.isOpen(),
  () => playerMoving,
);

// --- Night overlay ---
const nightOverlay = document.createElement('div');
nightOverlay.style.cssText = `
  position: fixed; inset: 0;
  background: rgb(0, 8, 40);
  pointer-events: none;
  z-index: 500;
  opacity: 0;
`;
document.body.appendChild(nightOverlay);

function updateNightOverlay(daysFractional: number) {
  const timeOfDay = daysFractional % 1;                               // 0 = midnight, 0.5 = noon
  const darkness  = (1 + Math.cos(timeOfDay * Math.PI * 2)) / 2;     // 1 at midnight, 0 at noon
  nightOverlay.style.opacity = (darkness * 0.88).toFixed(3);
}

// --- Daily distance recap ---
// Shows miles traveled the previous day at midnight, fades out by 9 AM.
const dailyRecapEl = document.createElement('div');
dailyRecapEl.style.cssText = `
  position: fixed; top: 0; left: 0; right: 0;
  height: 44px;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 1001;
  opacity: 0;
  transition: opacity 1.5s ease;
`;
const dailyRecapText = document.createElement('span');
dailyRecapText.style.cssText = 'color: #c8d8e8; font: 12px monospace; letter-spacing: 0.06em;';
dailyRecapEl.appendChild(dailyRecapText);
document.body.appendChild(dailyRecapEl);

let milesAtLastMidnight = 0; // set after load
let lastKnownDay = -1;       // set after load; -1 means not yet initialized
let hasRecapData  = false;

function updateDailyRecap(daysTraveled: number) {
  if (!hasRecapData) { dailyRecapEl.style.opacity = '0'; return; }
  const t = daysTraveled % 1; // 0 = midnight, fraction of day
  const FADE_START = 8  / 24;
  const FADE_END   = 9  / 24;
  if (t >= FADE_END) {
    dailyRecapEl.style.opacity = '0';
  } else if (t >= FADE_START) {
    dailyRecapEl.style.removeProperty('transition');
    dailyRecapEl.style.opacity = String(1 - (t - FADE_START) / (FADE_END - FADE_START));
  } else {
    dailyRecapEl.style.opacity = '1';
  }
}

// --- Stats & HUD ---
const stats      = createStats();
const updateHud  = createHud(currentSeed, () => {
  if (stats.activeAction?.id === 'survey') exitSurvey();
  stats.activeAction = null;
}, () => {
  if (stats.canoes <= 0) return;
  stats.canoes--;
  droppedCanoes.drop(Math.floor(player.tileX) + 1, Math.floor(player.tileY));
});
const structures    = new StructureManager(renderer.domElement, camera);
const droppedCanoes = new DroppedCanoeManager(renderer.domElement, camera);
const timberPiles   = new TimberPileManager(renderer.domElement, camera);

// --- Persistence ---
let startTileX = Math.floor(player.tileX);
let startTileY = Math.floor(player.tileY);

function doSave() {
  saveGame(
    currentSeed, stats,
    Math.floor(player.tileX), Math.floor(player.tileY),
    startTileX, startTileY,
    structures.getSaveData(),
    droppedCanoes.getSaveData(),
    timberPiles.getSaveData(),
  );
}

const save = loadGame(currentSeed);
if (save) {
  Object.assign(stats, save.stats);
  player.teleport(save.playerTileX, save.playerTileY);
  startTileX = save.startTileX ?? Math.floor(player.tileX);
  startTileY = save.startTileY ?? Math.floor(player.tileY);
  for (const s of save.structures    ?? []) structures.restore(s.tileX, s.tileY, s.type, s.progressDays, s.complete);
  for (const c of save.droppedCanoes ?? []) droppedCanoes.drop(c.tileX, c.tileY);
  for (const p of save.timberPiles   ?? []) timberPiles.restorePile(p.tileX, p.tileY, p.amount);
}

// Initialize daily recap tracking after stats are loaded.
milesAtLastMidnight = stats.milesTraveled;
lastKnownDay        = Math.floor(stats.daysTraveled);

// --- Ambient temperature ---
// °F at a tile, accounting for biome base temp, elevation, and time of day.
// Coldest at midnight, warmest at noon; higher elevation = colder.
function ambientTempAt(tx: number, ty: number): number {
  const elev     = sampleElevation(tx, ty, elevation);
  const moist    = sampleMoisture(tx, ty, moisture);
  const riverVal = sampleRiver(tx, ty, river);
  const lakeVal  = sampleLake(tx, ty, river);
  const biome    = getBiome(elev, moist, riverVal, lakeVal);
  const dayFrac  = stats.daysTraveled % 1;
  const timeMod  = -Math.cos(dayFrac * Math.PI * 2) * 15; // -15 at midnight, +15 at noon
  const elevMod  = -(elev - 0.5) * 60;                    // -30 at peaks, +12 in valleys
  return BIOMES[biome].baseTemp + timeMod + elevMod;
}

// --- Distance from start ---
const COMPASS_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const;

function distanceFromStart(): string {
  const dx = player.tileX - startTileX;
  const dy = player.tileY - startTileY;
  const miles = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
  if (miles < 0.1) return 'at start';
  const angleDeg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
  const dir = COMPASS_DIRS[Math.round(angleDeg / 22.5) % 16];
  return `${miles.toFixed(1)} mi ${dir}`;
}

window.addEventListener('beforeunload', doSave);
setInterval(doSave, 60_000);

// --- Water movement constraint ---
function isWaterBiome(tx: number, ty: number): boolean {
  const b = getBiome(sampleElevation(tx, ty, elevation), sampleMoisture(tx, ty, moisture), sampleRiver(tx, ty, river), sampleLake(tx, ty, river));
  return b === 'deep_water' || b === 'shallow_water';
}

function adjacentWaterBiome(tx: number, ty: number): BiomeProperties | null {
  for (let ddx = -1; ddx <= 1; ddx++) {
    for (let ddy = -1; ddy <= 1; ddy++) {
      if (ddx === 0 && ddy === 0) continue;
      if (isWaterBiome(tx + ddx, ty + ddy)) {
        const b = getBiome(sampleElevation(tx + ddx, ty + ddy, elevation), sampleMoisture(tx + ddx, ty + ddy, moisture), sampleRiver(tx + ddx, ty + ddy, river), sampleLake(tx + ddx, ty + ddy, river));
        return BIOMES[b];
      }
    }
  }
  return null;
}

// Returns the first cardinal neighbor that is not a water tile, or null if all are water.
function findAdjacentLandTile(tx: number, ty: number): { tileX: number; tileY: number } | null {
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]) {
    if (!isWaterBiome(tx + dx, ty + dy)) return { tileX: tx + dx, tileY: ty + dy };
  }
  return null;
}

function canEnterTile(tx: number, ty: number): boolean {
  if (!isWaterBiome(tx, ty)) return true;
  if (stats.canoes > 0) return true; // canoe allows all water travel
  // Allow wading 1 tile from land (any 8-neighbor is non-water)
  for (let ddx = -1; ddx <= 1; ddx++) {
    for (let ddy = -1; ddy <= 1; ddy++) {
      if (ddx === 0 && ddy === 0) continue;
      if (!isWaterBiome(tx + ddx, ty + ddy)) return true;
    }
  }
  return false;
}

// --- Canoe emoji overlay ---
const canoeEl = document.createElement('div');
canoeEl.textContent = '🛶';
canoeEl.style.cssText = `
  position: fixed;
  font-size: 26px;
  line-height: 1;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 600;
  display: none;
`;
document.body.appendChild(canoeEl);

// --- Survey mode ---
// Camera offset (tile units) while in survey. Reset to 0,0 on exit.
let surveyOffsetX = 0;
let surveyOffsetY = 0;
let surveyMaxRange = 0; // computed tile radius the player may pan

// Sample elevation advantage over the surrounding horizon to compute how
// far the player can see. Higher ground → wider view.
function computeSurveyRange(tx: number, ty: number): number {
  const playerElev = sampleElevation(tx, ty, elevation);
  const RING = 16;
  const RING_RADIUS = 20; // tiles
  let horizonSum = 0;
  for (let i = 0; i < RING; i++) {
    const angle = (i / RING) * Math.PI * 2;
    horizonSum += sampleElevation(
      tx + Math.round(Math.cos(angle) * RING_RADIUS),
      ty + Math.round(Math.sin(angle) * RING_RADIUS),
      elevation,
    );
  }
  const horizonElev = horizonSum / RING;
  const advantage   = Math.max(0, playerElev - horizonElev);
  // Advantage of 0.10 (hills) → ~72 tiles; 0.25 (mountain peak) → ~144 tiles.
  // Cap at what fits within the survey chunk radius to avoid black edges.
  const maxPossible = SURVEY_CHUNK_RADIUS * CHUNK_WIDTH - 24;
  return Math.round(Math.min(24 + advantage * 480, maxPossible));
}

function enterSurvey() {
  const tx = Math.floor(player.tileX);
  const ty = Math.floor(player.tileY);
  surveyMaxRange = computeSurveyRange(tx, ty);
  surveyOffsetX  = 0;
  surveyOffsetY  = 0;
  const rangeStr = (surveyMaxRange * 0.1).toFixed(1);
  stats.activeAction = {
    id: 'survey',
    label: `Surveying (${rangeStr} mi range)`,
    durationDays: Infinity,
    progressDays: 0,
  };
  chunkManager.beginSurvey(tx, ty, SURVEY_CHUNK_RADIUS);
  surveyTotalQueue = chunkManager.queueLength;
  surveyCrosshair.style.display = 'block';
  if (surveyTotalQueue > 0) surveyLoadBar.style.display = 'block';
}

function exitSurvey() {
  surveyOffsetX = 0;
  surveyOffsetY = 0;
  chunkManager.endSurvey();
  surveyCrosshair.style.display = 'none';
  surveyLoadBar.style.display   = 'none';
}

// Survey crosshair: shown at center of screen while surveying.
const surveyCrosshair = document.createElement('div');
surveyCrosshair.textContent = '⊕';
surveyCrosshair.style.cssText = `
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 22px;
  color: rgba(255,255,255,0.55);
  pointer-events: none;
  z-index: 700;
  display: none;
  text-shadow: 0 0 6px rgba(0,0,0,0.8);
`;
document.body.appendChild(surveyCrosshair);

// Thin progress bar at top of canvas showing async chunk load progress.
const surveyLoadBar = document.createElement('div');
surveyLoadBar.style.cssText = `
  position: fixed;
  top: 0; left: 0;
  height: 2px;
  background: rgba(160,210,255,0.7);
  pointer-events: none;
  z-index: 1001;
  display: none;
  transition: width 0.1s linear;
`;
document.body.appendChild(surveyLoadBar);

let surveyTotalQueue = 0; // snapshot at beginSurvey to drive the load bar

// --- Forage emoji animation ---
function getPlayerScreenPos() {
  const r  = renderer.domElement.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let x: number, y: number, w: number, h: number;
  if (ea > ca) { h = r.height; w = h * ca; x = r.left + (r.width  - w) / 2; y = r.top; }
  else         { w = r.width;  h = w / ca; x = r.left;                        y = r.top + (r.height - h) / 2; }
  return { x: x + w / 2, y: y + h / 2 };
}

function showForageEmoji(emoji: string) {
  const { x, y } = getPlayerScreenPos();
  const jitter = (Math.random() - 0.5) * 64;
  const el = document.createElement('div');
  el.textContent = emoji;
  el.style.cssText = `
    position: fixed;
    left: ${x + jitter}px;
    top: ${y}px;
    font-size: 26px;
    line-height: 1;
    transform: translate(-50%, -50%) scale(0.7);
    opacity: 1;
    pointer-events: none;
    z-index: 1500;
    transition: top 1.8s ease-out, transform 1.8s ease-out, opacity 1.1s 0.7s ease-in;
  `;
  document.body.appendChild(el);
  void el.offsetHeight;
  el.style.top       = `${y - 96}px`;
  el.style.transform = 'translate(-50%, -50%) scale(1.5)';
  el.style.opacity   = '0';
  setTimeout(() => el.remove(), 1900);
}

// --- Game over ---
let gameOver = false;

function showGameOver() {
  gameOver = true;
  radialMenu.closeAll();

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.78);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 2000;
    font-family: monospace;
    color: #ccc;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background: rgba(18,18,18,0.97);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 40px 56px;
    text-align: center;
    max-width: 380px;
  `;

  const title = document.createElement('div');
  title.textContent = 'You have perished.';
  title.style.cssText = 'font-size: 22px; color: #c94040; margin-bottom: 14px; letter-spacing: 0.04em;';

  const sub = document.createElement('div');
  sub.style.cssText = 'font-size: 13px; color: #888; margin-bottom: 32px; line-height: 1.6;';
  sub.textContent = `Day ${Math.floor(stats.daysTraveled) + 1}  ·  ${stats.milesTraveled.toFixed(1)} miles traveled`;

  const btn = document.createElement('button');
  btn.textContent = 'Start over';
  btn.style.cssText = `
    background: rgba(40,40,40,0.9);
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px;
    color: #d0d0d0;
    font: 13px monospace;
    padding: 10px 28px;
    cursor: pointer;
  `;
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)';  btn.style.color = '#d0d0d0'; });
  btn.addEventListener('click', () => { deleteSave(currentSeed); window.location.reload(); });

  box.append(title, sub, btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// --- Game loop ---
let lastTime = performance.now();

function tick() {
  if (gameOver) return;
  requestAnimationFrame(tick);

  const now   = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const tx = Math.floor(player.tileX);
  const ty = Math.floor(player.tileY);
  const currentBiome = getBiome(sampleElevation(tx, ty, elevation), sampleMoisture(tx, ty, moisture), sampleRiver(tx, ty, river), sampleLake(tx, ty, river));
  const biomeProps   = BIOMES[currentBiome];
  const inWater       = currentBiome === 'deep_water' || currentBiome === 'shallow_water';
  const usingCanoe    = inWater && stats.canoes > 0;
  const carryingCanoe = !inWater && stats.canoes > 0;
  const effectiveSpeed = (usingCanoe ? 1.5 : biomeProps.speedMultiplier * (carryingCanoe ? 0.45 : 1)) * getWeightMultiplier(stats);

  // Canoeing is easy; portaging is exhausting
  const effectiveBiome = usingCanoe    ? { ...biomeProps, energyDrainPerTile: 0.10 }
                       : carryingCanoe ? { ...biomeProps, energyDrainPerTile: biomeProps.energyDrainPerTile * 2.2 }
                       : biomeProps;

  // Survey mode: freeze the player and redirect WASD to camera pan instead.
  const isSurveying = stats.activeAction?.id === 'survey';
  if (isSurveying) {
    const panX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const panY = (input.down  ? 1 : 0) - (input.up   ? 1 : 0);
    if (panX !== 0 || panY !== 0) {
      surveyOffsetX += panX * SURVEY_PAN_SPEED * delta;
      surveyOffsetY += panY * SURVEY_PAN_SPEED * delta;
      // Clamp to circular pan range
      const dist = Math.sqrt(surveyOffsetX * surveyOffsetX + surveyOffsetY * surveyOffsetY);
      if (dist > surveyMaxRange) {
        surveyOffsetX = surveyOffsetX / dist * surveyMaxRange;
        surveyOffsetY = surveyOffsetY / dist * surveyMaxRange;
      }
    }
    // Update async-load progress bar
    if (surveyTotalQueue > 0) {
      const remaining = chunkManager.queueLength;
      if (remaining === 0) {
        surveyLoadBar.style.display = 'none';
      } else {
        const pct = (1 - remaining / surveyTotalQueue) * 100;
        surveyLoadBar.style.display = 'block';
        surveyLoadBar.style.width   = `${pct}%`;
      }
    }
  }

  const playerInput = isSurveying ? { up: false, down: false, left: false, right: false } : input;

  const prevX = player.visualX;
  const prevY = player.visualY;
  player.update(playerInput, delta, effectiveSpeed, canEnterTile);

  // Swap player mesh for canoe emoji while paddling
  player.mesh.visible = !usingCanoe;
  if (usingCanoe) {
    const pos = getPlayerScreenPos();
    canoeEl.style.display = 'block';
    canoeEl.style.left = `${pos.x}px`;
    canoeEl.style.top  = `${pos.y}px`;
  } else {
    canoeEl.style.display = 'none';
  }
  const dx = player.visualX - prevX;
  const dy = player.visualY - prevY;
  const tilesMoved = Math.sqrt(dx * dx + dy * dy);

  playerMoving = tilesMoved > 1e-4;
  if (playerMoving) {
    radialMenu.closeAll();
    if (stats.activeAction?.id === 'forage') stats.activeAction = null;
  }

  // Auto-pickup: collect a dropped canoe when walking onto its tile
  if (droppedCanoes.tryPickup(tx, ty)) stats.canoes++;

  // Stepping onto a campfire tile douses it
  structures.extinguishAt(tx, ty);

  // Stop build if player left the required build tile.
  // buildTileX/Y overrides the structure tile (used when the structure is placed
  // on an adjacent tile, e.g. campfire, while the player stays on their own tile).
  if (stats.activeAction?.id.startsWith('build_') && stats.activeAction.structureIndex !== undefined) {
    const action = stats.activeAction;
    const stayTile = (action.buildTileX !== undefined && action.buildTileY !== undefined)
      ? { tileX: action.buildTileX, tileY: action.buildTileY }
      : structures.getTile(action.structureIndex!);
    if (stayTile && (Math.floor(player.tileX) !== stayTile.tileX || Math.floor(player.tileY) !== stayTile.tileY)) {
      stats.activeAction = null;
    }
  }

  const prevAction = stats.activeAction;
  const buildProgressBefore = prevAction?.id.startsWith('build_') ? prevAction.progressDays : -1;
  const prevDaysTraveled = stats.daysTraveled;

  const fishBiome   = inWater ? effectiveBiome : (adjacentWaterBiome(tx, ty) ?? undefined);
  const currentTemp = ambientTempAt(tx, ty);
  const warming     = structures.isWarmed(tx, ty);
  const { timeTicking, forageEvents } = updateStats(stats, delta, tilesMoved, effectiveBiome, fishBiome, usingCanoe, currentTemp, warming);

  for (const ev of forageEvents) {
    showForageEmoji(ev.emoji);
    if (ev.timber) timberPiles.addAmount(tx, ty, ev.timber, isWaterBiome);
  }

  // Deduct timber from adjacent piles once per build hour crossed
  if (prevAction?.id.startsWith('build_') && prevAction.timberPerHour !== undefined && prevAction.structureIndex !== undefined) {
    const buildProgressAfter = prevAction.progressDays; // mutated in-place by updateStats
    const hoursBefore = Math.floor(buildProgressBefore * 24);
    const hoursNow    = Math.floor(buildProgressAfter  * 24);
    if (hoursNow > hoursBefore) {
      const tile = structures.getTile(prevAction.structureIndex);
      if (tile) timberPiles.consumeFromAdjacent(tile.tileX, tile.tileY, prevAction.timberPerHour);
    }
  }

  // Sync build progress; detect completion (updateStats nulls the action on finish)
  if (prevAction?.id.startsWith('build_') && prevAction.structureIndex !== undefined) {
    if (stats.activeAction) {
      structures.setProgress(prevAction.structureIndex, stats.activeAction.progressDays);
    } else {
      structures.complete(prevAction.structureIndex, stats);
    }
  }

  // If survey was auto-stopped by sunset, clean up camera state.
  if (prevAction?.id === 'survey' && !stats.activeAction) {
    exitSurvey();
  }

  // Campfire fuel consumption: burns 1 timber per 2 game-hours from piles within 2 tiles.
  const gameDaysElapsed = stats.daysTraveled - prevDaysTraveled;
  if (gameDaysElapsed > 0) {
    for (const { index, tileX: ftx, tileY: fty, fuelNeeded } of structures.tickCampfires(gameDaysElapsed)) {
      const consumed = timberPiles.consumeFromAdjacent(ftx, fty, fuelNeeded, 2);
      if (consumed < fuelNeeded) structures.burnOut(index);
    }
  }


  // Midnight recap: when a new game-day begins, record how far the player
  // walked during the day that just ended and show it until 9 AM.
  const currentDay = Math.floor(stats.daysTraveled);
  if (currentDay > lastKnownDay) {
    const dayMiles = stats.milesTraveled - milesAtLastMidnight;
    if (dayMiles >= 0.05) {
      dailyRecapText.textContent = `Day ${lastKnownDay + 1}: ${dayMiles.toFixed(1)} miles traveled`;
      dailyRecapEl.style.transition = 'none';
      dailyRecapEl.style.opacity = '1';
      hasRecapData = true;
    }
    milesAtLastMidnight = stats.milesTraveled;
    lastKnownDay        = currentDay;
  }
  updateDailyRecap(stats.daysTraveled);

  if (stats.health <= 0) { showGameOver(); return; }
  updateHud(stats, timeTicking, distanceFromStart(), currentTemp, carryingCanoe);
  updateNightOverlay(stats.daysTraveled);
  tileInspector.update();
  structures.update();
  droppedCanoes.update();
  timberPiles.update();

  // During survey the player tile doesn't change, so normal ACTIVE_RADIUS
  // window stays centered on the player. The survey async queue handles far chunks.
  chunkManager.update(player.visualX, player.visualY);

  // Camera follows player + survey pan offset (offset is 0,0 outside survey mode).
  const camX = player.mesh.position.x + surveyOffsetX * TILE_SIZE;
  const camY = player.mesh.position.y - surveyOffsetY * TILE_SIZE;
  camera.position.set(camX, camY, 1);

  renderer.render(scene, camera);
}

tick();
