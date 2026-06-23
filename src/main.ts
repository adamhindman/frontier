import * as THREE from 'three';
import { createNoiseGenerators } from './noise';
import { ChunkManager } from './chunkManager';
import { Player } from './player';
import { createInputHandler } from './input';
import { createTileInspector } from './tileInspector';
import { createStats, updateStats, getWeightMultiplier, isDaylight } from './playerStats';
import { createHud } from './hud';
import { createInventory } from './inventory';
import { StructureManager, CANOE_TIMBER_COST, SHELTER_TIMBER_COST, STRUCTURE_CONFIGS } from './structures';
import { createRadialMenu } from './radialMenu';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome, BIOMES } from './biomes';
import { SEED, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

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
  return [
    {
      label: 'Rest',
      disabled: onWater,
      children: [
        { label: '1 day',  action: () => { stats.activeAction = { id: 'rest', label: 'Resting', durationDays: 1, progressDays: 0 }; } },
        { label: 'Til dawn', action: () => {
          const frac = stats.daysTraveled % 1;
          const morning = 6 / 24;
          const duration = frac < morning ? morning - frac : (1 + morning) - frac;
          stats.activeAction = { id: 'rest', label: 'Resting', durationDays: duration, progressDays: 0 };
        }},
      ],
    },
    {
      label: 'Forage',
      disabled: !daylight,
      action: () => { stats.activeAction = { id: 'forage', label: 'Foraging', durationDays: Infinity, progressDays: 0 }; },
    },
    {
      label: 'Hunt',
      disabled: !daylight,
      action: () => { stats.activeAction = { id: 'hunt', label: 'Hunting', durationDays: Infinity, progressDays: 0 }; },
    },
    {
      label: 'Harvest',
      disabled: !daylight,
      children: [
        { label: 'Timber',   action: () => { stats.activeAction = { id: 'harvest_timber',   label: 'Harvesting timber',   durationDays: Infinity, progressDays: 0 }; } },
        { label: 'Minerals', action: () => { stats.activeAction = { id: 'harvest_minerals', label: 'Harvesting minerals', durationDays: Infinity, progressDays: 0 }; } },
      ],
    },
    {
      label: 'Build',
      disabled: !daylight,
      children: (() => {
        const tileX = Math.floor(player.tileX);
        const tileY = Math.floor(player.tileY);
        const existingCanoe   = structures.findUnfinished(tileX, tileY, 'canoe');
        const existingShelter = structures.findUnfinished(tileX, tileY, 'shelter');
        return [
          {
            label: existingCanoe >= 0 ? 'Resume Canoe' : `Canoe (${CANOE_TIMBER_COST}🪵)`,
            disabled: existingCanoe < 0 && stats.timber < CANOE_TIMBER_COST,
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
            disabled: existingShelter < 0 && stats.timber < SHELTER_TIMBER_COST,
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

// --- Stats & HUD ---
const stats     = createStats();
const updateHud = createHud(currentSeed, () => { stats.activeAction = null; });
const inventory = createInventory();
const structures = new StructureManager(renderer.domElement, camera);

// --- Water movement constraint ---
function isWaterBiome(tx: number, ty: number): boolean {
  const b = getBiome(sampleElevation(tx, ty, elevation), sampleMoisture(tx, ty, moisture), sampleRiver(tx, ty, river), sampleLake(tx, ty, river));
  return b === 'deep_water' || b === 'shallow_water';
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
  btn.addEventListener('click', () => window.location.reload());

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
  const inWater      = currentBiome === 'deep_water' || currentBiome === 'shallow_water';
  const usingCanoe   = inWater && stats.canoes > 0;
  const effectiveSpeed = (usingCanoe ? 1.5 : biomeProps.speedMultiplier) * getWeightMultiplier(stats);

  const prevX = player.visualX;
  const prevY = player.visualY;
  player.update(input, delta, effectiveSpeed, canEnterTile);

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
  if (playerMoving) radialMenu.closeAll();

  // Stop build if player left the structure's tile (must run before prevAction is captured)
  if (stats.activeAction?.id.startsWith('build_') && stats.activeAction.structureIndex !== undefined) {
    const tile = structures.getTile(stats.activeAction.structureIndex);
    if (tile && (Math.floor(player.tileX) !== tile.tileX || Math.floor(player.tileY) !== tile.tileY)) {
      stats.activeAction = null;
    }
  }

  const prevAction = stats.activeAction;
  const { timeTicking, forageEvents } = updateStats(stats, delta, tilesMoved, biomeProps);
  for (const ev of forageEvents) showForageEmoji(ev.emoji);

  // Sync build progress; detect completion (updateStats nulls the action on finish)
  if (prevAction?.id.startsWith('build_') && prevAction.structureIndex !== undefined) {
    if (stats.activeAction) {
      structures.setProgress(prevAction.structureIndex, stats.activeAction.progressDays);
    } else {
      structures.complete(prevAction.structureIndex, stats);
    }
  }
  if (stats.health <= 0) { showGameOver(); return; }
  updateHud(stats, timeTicking);
  inventory.update(stats);
  updateNightOverlay(stats.daysTraveled);
  tileInspector.update();
  structures.update();

  chunkManager.update(player.visualX, player.visualY);

  camera.position.set(player.mesh.position.x, player.mesh.position.y, 1);

  renderer.render(scene, camera);
}

tick();
