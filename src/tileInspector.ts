import * as THREE from 'three';
import { type NoiseFunction2D } from 'simplex-noise';
import { TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome, BIOMES, getTileResources } from './biomes';
import { canvasCoordsToTile } from './coordinates';
import { getTopBandHeight, getBottomBandHeight } from './hud';

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
  isPaused: () => boolean = () => false,
  isHunting: () => boolean = () => false,
  getEntityAt: (tileX: number, tileY: number) => string | null = () => null,
  isBlockedAt: (clientX: number, clientY: number) => boolean = () => false,
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

  // Mouse position, tracked for click handling.
  let hoverTileX = 0, hoverTileY = 0;
  let hoverInBounds = false;

  // Which tile has the active pinned tooltip (null = none).
  let pinnedTileX: number | null = null;
  let pinnedTileY: number | null = null;

  function hideTooltip() {
    tooltip.style.opacity = '0';
    pinnedTileX = null;
    pinnedTileY = null;
  }

  function showTooltipAt(tileX: number, tileY: number, clientX: number, clientY: number) {
    // Entity first (animal or NPC); fall back to tile info.
    const entityDesc = getEntityAt(tileX, tileY);
    if (entityDesc !== null) {
      tooltip.textContent = entityDesc;
    } else {
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
    }

    // Position near click, flip to stay on screen.
    const tr = tooltip.getBoundingClientRect();
    const tx = clientX + 16 + tr.width  > window.innerWidth  ? clientX - 16 - tr.width  : clientX + 16;
    const ty = clientY - 10 + tr.height > window.innerHeight ? clientY - 10 - tr.height : clientY - 10;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top  = `${ty}px`;
    tooltip.style.opacity = '1';

    pinnedTileX = tileX;
    pinnedTileY = tileY;
  }

  // Highlight follows mouse hover.
  canvas.addEventListener('mousemove', (e) => {
    if (isMenuOpen() || isPaused() || isHunting() || isBlockedAt(e.clientX, e.clientY)) {
      hoverInBounds = false;
      highlight.visible = false;
      return;
    }

    const cr = getContentRect(canvas);
    const lx = e.clientX - cr.x;
    const ly = e.clientY - cr.y;
    const topBand    = getTopBandHeight();
    const bottomBand = getBottomBandHeight();

    if (lx < 0 || lx > cr.w || ly < 0 || ly > cr.h
        || e.clientY < topBand || e.clientY > window.innerHeight - bottomBand) {
      hoverInBounds = false;
      highlight.visible = false;
      return;
    }

    const cx = (lx / cr.w) * CANVAS_WIDTH;
    const cy = (ly / cr.h) * CANVAS_HEIGHT;
    const { tileX, tileY } = canvasCoordsToTile(cx, cy, camera.position.x, camera.position.y);
    hoverTileX = tileX;
    hoverTileY = tileY;
    hoverInBounds = true;

    highlight.position.x = (tileX + 0.5) * TILE_SIZE;
    highlight.position.y = -(tileY + 0.5) * TILE_SIZE;
    highlight.visible = !isMoving();
  });

  canvas.addEventListener('mouseleave', () => {
    hoverInBounds = false;
    highlight.visible = false;
  });

  // Click the pinned tile to dismiss; click anywhere else to dismiss without opening a new one.
  canvas.addEventListener('click', (e) => {
    if (isMenuOpen() || isPaused() || isHunting() || isBlockedAt(e.clientX, e.clientY)) return;
    if (!hoverInBounds) return;

    if (pinnedTileX === null) {
      // Nothing pinned — open on this tile.
      showTooltipAt(hoverTileX, hoverTileY, e.clientX, e.clientY);
    } else {
      // Already pinned — always dismiss, regardless of which tile was clicked.
      hideTooltip();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinnedTileX !== null) hideTooltip();
  });

  // Called every frame — hide tooltip when player moves.
  function update() {
    if (isMoving() || isMenuOpen() || isPaused() || isHunting()) {
      if (pinnedTileX !== null) hideTooltip();
      highlight.visible = false;
    } else if (hoverInBounds) {
      highlight.visible = true;
    }
  }

  return { update };
}
