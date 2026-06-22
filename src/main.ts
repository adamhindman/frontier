import * as THREE from 'three';
import { createNoiseGenerators } from './noise';
import { ChunkManager } from './chunkManager';
import { Player } from './player';
import { createInputHandler } from './input';
import { createTileInspector } from './tileInspector';
import { createStats, updateStats, getWeightMultiplier } from './playerStats';
import { createHud } from './hud';
import { createRadialMenu } from './radialMenu';
import { sampleElevation, sampleMoisture } from './noise';
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
const { elevation, moisture } = createNoiseGenerators(currentSeed);
const chunkManager = new ChunkManager(scene, elevation, moisture);

// --- Player & input ---
const player = new Player(scene);
const input  = createInputHandler();
const noop = () => {};
const radialMenu = createRadialMenu(renderer.domElement, camera, (_tileX, _tileY) => [
  {
    label: 'Rest',
    children: [
      { label: '1 day',  action: () => { stats.activeAction = { id: 'rest', label: 'Resting', durationDays: 1, progressDays: 0 }; } },
      { label: '3 days', action: () => { stats.activeAction = { id: 'rest', label: 'Resting', durationDays: 3, progressDays: 0 }; } },
      { label: '1 week', action: () => { stats.activeAction = { id: 'rest', label: 'Resting', durationDays: 7, progressDays: 0 }; } },
      { label: 'Til dawn', action: () => {
        const frac = stats.daysTraveled % 1;
        const morning = 6 / 24;
        const duration = frac < morning ? morning - frac : (1 + morning) - frac;
        stats.activeAction = { id: 'rest', label: 'Resting', durationDays: duration, progressDays: 0 };
      }},
    ],
  },
  { label: 'Forage',   children: [
    { label: 'Plants', action: noop },
    { label: 'Water',  action: noop },
    { label: 'Game',   action: noop },
  ]},
  { label: 'Build',    action: noop },
  { label: 'Inspect',  action: noop },
  { label: 'Camp',     action: noop },
]);
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    radialMenu.openAtTile(player.tileX, player.tileY);
  }
});

let playerMoving = false;
const tileInspector = createTileInspector(
  renderer.domElement, scene, camera, elevation, moisture,
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
const updateHud = createHud(currentSeed);

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
  const biomeProps = BIOMES[getBiome(
    sampleElevation(tx, ty, elevation),
    sampleMoisture(tx, ty, moisture),
  )];

  const prevX = player.visualX;
  const prevY = player.visualY;
  player.update(input, delta, biomeProps.speedMultiplier * getWeightMultiplier(stats));
  const dx = player.visualX - prevX;
  const dy = player.visualY - prevY;
  const tilesMoved = Math.sqrt(dx * dx + dy * dy);

  playerMoving = tilesMoved > 1e-4;
  if (playerMoving) radialMenu.closeAll();

  const timeTicking = updateStats(stats, delta, tilesMoved, biomeProps);
  if (stats.health <= 0) { showGameOver(); return; }
  updateHud(stats, timeTicking);
  updateNightOverlay(stats.daysTraveled);
  tileInspector.update();

  chunkManager.update(player.visualX, player.visualY);

  camera.position.set(player.mesh.position.x, player.mesh.position.y, 1);

  renderer.render(scene, camera);
}

tick();
