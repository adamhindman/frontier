import * as THREE from 'three';
import { type NoiseFunction2D } from 'simplex-noise';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome, BIOMES, getTileResources } from './biomes';
import { canvasCoordsToTile } from './coordinates';

const INTENT_DELAY_MS = 300;

function capitalize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// elev=0.42 → 0 ft (sea level), elev=1.0 → ~14,400 ft
function formatElevation(elev: number): string {
  const ft = Math.round((elev - 0.42) * 25000);
  return `${ft.toLocaleString()} ft`;
}

function formatMoisture(moist: number): string {
  if (moist < 0.2) return 'Arid';
  if (moist < 0.4) return 'Dry';
  if (moist < 0.6) return 'Moderate';
  if (moist < 0.8) return 'Humid';
  return 'Saturated';
}

function getContentRect(el: HTMLCanvasElement): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  const elAspect = r.width / r.height;
  const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
  let w: number, h: number, x: number, y: number;
  if (elAspect > canvasAspect) {
    h = r.height; w = h * canvasAspect; x = r.left + (r.width - w) / 2; y = r.top;
  } else {
    w = r.width; h = w / canvasAspect; x = r.left; y = r.top + (r.height - h) / 2;
  }
  return { x, y, w, h };
}

export function createTileInspector(
  canvas: HTMLCanvasElement,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  elevNoise: NoiseFunction2D,
  moistNoise: NoiseFunction2D,
  riverNoise: NoiseFunction2D,
  isMenuOpen: () => boolean = () => false,
  isMoving: () => boolean = () => false,
): { update: () => void } {
  // --- Tooltip ---
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: fixed;
    background: rgba(0, 0, 0, 0.75);
    color: #e8e8e8;
    font: 13px/1.6 monospace;
    padding: 6px 10px;
    border-radius: 4px;
    pointer-events: none;
    white-space: pre;
    z-index: 999;
    opacity: 0;
    transition: opacity 0.15s ease;
  `;
  document.body.appendChild(tooltip);

  // --- Highlight outline ---
  const s = TILE_SIZE / 2;
  const highlightGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-s, -s, 0),
    new THREE.Vector3( s, -s, 0),
    new THREE.Vector3( s,  s, 0),
    new THREE.Vector3(-s,  s, 0),
  ]);
  const highlightMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const highlight = new THREE.LineLoop(highlightGeo, highlightMat);
  highlight.position.z = 0.5;
  highlight.visible = false;
  scene.add(highlight);

  let intentTimer: ReturnType<typeof setTimeout> | null = null;

  function hideTooltip() {
    if (intentTimer !== null) { clearTimeout(intentTimer); intentTimer = null; }
    tooltip.style.opacity = '0';
    highlight.visible = false;
  }

  canvas.addEventListener('mousemove', (e) => {
    if (intentTimer !== null) { clearTimeout(intentTimer); intentTimer = null; }

    if (isMenuOpen()) {
      hideTooltip();
      highlight.visible = false;
      return;
    }

    const cr = getContentRect(canvas);
    const lx = e.clientX - cr.x;
    const ly = e.clientY - cr.y;

    if (lx < 0 || lx > cr.w || ly < 0 || ly > cr.h) {
      hideTooltip();
      highlight.visible = false;
      return;
    }

    const cx = (lx / cr.w) * CANVAS_WIDTH;
    const cy = (ly / cr.h) * CANVAS_HEIGHT;
    const { tileX, tileY } = canvasCoordsToTile(cx, cy, camera.position.x, camera.position.y);

    highlight.position.x = (tileX + 0.5) * TILE_SIZE;
    highlight.position.y = -(tileY + 0.5) * TILE_SIZE;
    highlight.visible = !isMoving();

    // Always update content and position so it's ready when the timer fires.
    const elev     = sampleElevation(tileX, tileY, elevNoise);
    const moist    = sampleMoisture(tileX, tileY, moistNoise);
    const riverVal = sampleRiver(tileX, tileY, riverNoise);
    const lakeVal  = sampleLake(tileX, tileY, riverNoise);
    const biome    = getBiome(elev, moist, riverVal, lakeVal);
    const props = BIOMES[biome];
    const res   = getTileResources(biome);
    tooltip.textContent = [
      capitalize(biome),
      `Tile     (${tileX}, ${tileY})`,
      `Elev     ${formatElevation(elev)}`,
      `Moisture ${formatMoisture(moist)}`,
      `Speed    ×${props.speedMultiplier.toFixed(2)}`,
      ``,
      `Plants   ${res.plants}`,
      `Game     ${res.game}`,
      `Water    ${res.water}`,
      `Timber   ${res.timber}`,
      `Minerals ${res.minerals}`,
    ].join('\n');

    // Position tooltip now (getBoundingClientRect works even at opacity 0).
    const tr = tooltip.getBoundingClientRect();
    const tx = e.clientX + 16 + tr.width  > window.innerWidth  ? e.clientX - 16 - tr.width  : e.clientX + 16;
    const ty = e.clientY - 10 + tr.height > window.innerHeight ? e.clientY - 10 - tr.height  : e.clientY - 10;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top  = `${ty}px`;

    if (!isMoving()) {
      intentTimer = setTimeout(() => { tooltip.style.opacity = '1'; }, INTENT_DELAY_MS);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hideTooltip();
    highlight.visible = false;
  });

  // Called every tick so movement hides the tooltip even when the mouse is still.
  function update() {
    if (isMoving() || isMenuOpen()) hideTooltip();
  }

  return { update };
}
