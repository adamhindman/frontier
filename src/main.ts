import * as THREE from "three";
import { createNoiseGenerators } from "./noise";
import { ChunkManager } from "./chunkManager";
import { Player } from "./player";
import { createInputHandler } from "./input";
import { createTileInspector } from "./tileInspector";
import {
  createStats,
  updateStats,
  getWeightMultiplier,
  isDaylight,
  MILES_PER_TILE,
  SECONDS_PER_DAY,
  FOOD_CAPACITY_LBS,
  WATER_CAPACITY_GAL,
} from "./playerStats";
import playerFrontIdleUrl from "./assets/tiles/player-front-idle.png";
import playerBackIdleUrl from "./assets/tiles/player-back-idle.png";
import playerRightWalkUrl from "./assets/tiles/player-right-walking.png";
import playerLeftWalkUrl from "./assets/tiles/player-left-walking.png";
import canoeRightUrl from "./assets/tiles/canoe-profile-right.png";
import canoeLeftUrl from "./assets/tiles/canoe-profile-left.png";
import { createHud, getTopBandHeight, getBottomBandHeight } from "./hud";
import {
  StructureManager,
  DroppedCanoeManager,
  CANOE_TIMBER_COST,
  SHELTER_TIMBER_COST,
  CAMPFIRE_TIMBER_COST,
  STRUCTURE_CONFIGS,
} from "./structures";
import { TimberPileManager } from "./timberPiles";
import { saveGame, loadGame, deleteSave } from "./save";
import { createRadialMenu } from "./radialMenu";
import {
  sampleElevation,
  sampleMoisture,
  sampleRiver,
  sampleLake,
} from "./noise";
import { getBiome, BIOMES, BiomeProperties } from "./biomes";
import {
  SEED,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  TILE_SIZE,
  CHUNK_WIDTH,
  CHUNK_HEIGHT,
  SURVEY_CHUNK_RADIUS,
  SURVEY_PAN_SPEED,
} from "./constants";
import {
  createWeatherSystem,
  getWeatherEffects,
  weatherLabel,
  resolveWeatherForTemp,
} from "./weather";
import { createWeatherOverlay } from "./weatherOverlay";
import { MapPinManager } from "./mapPins";
import { QuestManager } from "./quests";
import { createQuestPanel } from "./questPanel";
import { RuinSpriteManager } from "./ruinSprites";
import { createActivityLog } from "./activityLog";
import { AnimalManager, FishJumpEffect, RIFLE_RANGE } from "./animals";
import { HuntingOverlay } from "./hunting";
import { SettlementManager } from "./settlements";
import { TraderManager } from "./traders";

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// --- Camera ---
const hw = CANVAS_WIDTH / 2;
const hh = CANVAS_HEIGHT / 2;
const camera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, -10, 10);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
renderer.domElement.style.cssText = `
  position: fixed;
  left: 0; right: 0;
  object-fit: contain;
  image-rendering: pixelated;
`;
document.body.appendChild(renderer.domElement);

function layoutCanvas() {
  const top = getTopBandHeight();
  const bot = getBottomBandHeight();
  renderer.domElement.style.top = `${top}px`;
  renderer.domElement.style.bottom = `${bot}px`;
}
layoutCanvas();
window.addEventListener("resize", layoutCanvas);

// --- Seed: read from URL param; write it back so reloads preserve it ---
function resolveSeed(): string {
  const params = new URLSearchParams(window.location.search);
  const s = params.get("seed");
  if (s) return s;
  const url = new URL(window.location.href);
  url.searchParams.set("seed", SEED);
  window.history.replaceState(null, "", url.toString());
  return SEED;
}
const currentSeed = resolveSeed();
let weatherSeed = Math.floor(Math.random() * 0x100000000);

// --- World ---
const { elevation, moisture, river } = createNoiseGenerators(currentSeed);
const chunkManager = new ChunkManager(scene, elevation, moisture, river);

// --- Player & input ---
const player = new Player(scene);
const input = createInputHandler();
function capitalizeBiomeName(biome: string): string {
  return biome.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const radialMenu = createRadialMenu(
  renderer.domElement,
  camera,
  (clickedTileX, clickedTileY) => {
    const isSurveying = stats.activeAction?.id === "survey";

    if (isSurveying) {
      const existingPin = mapPins.findAt(clickedTileX, clickedTileY);
      const hasPin = existingPin >= 0;
      return [
        {
          label: hasPin ? "Rename Location" : "Name Location",
          action: () => {
            if (hasPin) {
              mapPins.triggerEdit(existingPin);
            } else {
              const elev = sampleElevation(
                clickedTileX,
                clickedTileY,
                elevation,
              );
              const moist = sampleMoisture(
                clickedTileX,
                clickedTileY,
                moisture,
              );
              const riverV = sampleRiver(clickedTileX, clickedTileY, river);
              const lakeV = sampleLake(clickedTileX, clickedTileY, river);
              const biome = getBiome(elev, moist, riverV, lakeV);
              const elevFt = Math.round(Math.max(0, (elev - 0.42) * 25000));
              const dx = clickedTileX - startTileX;
              const dy = clickedTileY - startTileY;
              const miles = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
              const angleDeg =
                ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
              const bearing =
                miles < 0.1
                  ? "at start"
                  : `${miles.toFixed(1)} mi ${COMPASS_DIRS[Math.round(angleDeg / 22.5) % 16]}`;
              const defaultName =
                capitalizeBiomeName(biome) + (elev > 0.76 ? " Peak" : "");
              const idx = mapPins.add({
                id: `pin_${Date.now()}`,
                tileX: clickedTileX,
                tileY: clickedTileY,
                name: defaultName,
                color: "#000",
                dayPlaced: stats.daysTraveled,
                elevationFt: elevFt,
                biome,
                distanceMiles: miles,
                bearing,
                notes: "",
              });
              mapPins.triggerEdit(idx);
            }
          },
        },
        {
          label: "Exit Survey",
          action: () => exitSurvey(),
        },
      ];
    }

    const daylight = isDaylight(stats.daysTraveled);
    const onWater = isWaterBiome(
      Math.floor(player.tileX),
      Math.floor(player.tileY),
    );
    const ptx = Math.floor(player.tileX),
      pty = Math.floor(player.tileY);
    const tileElev = sampleElevation(ptx, pty, elevation);
    const aboveTreeline = tileElev >= 0.76;
    const tileBiome = getBiome(
      tileElev,
      sampleMoisture(ptx, pty, moisture),
      sampleRiver(ptx, pty, river),
      sampleLake(ptx, pty, river),
    );
    const biomeTimber = BIOMES[tileBiome].baseResources.timber;
    const inShelter = structures.playerInCompletedShelter(ptx, pty);

    // Check for unfinished structures on the player's tile (for top-level resume buttons).
    const resumeCanoeIdx    = structures.findUnfinished(ptx, pty, 'canoe');
    const resumeShelterIdx  = structures.findUnfinished(ptx, pty, 'shelter');
    const resumeCanoeItem = resumeCanoeIdx >= 0 ? {
      label: 'Resume Canoe',
      disabled: !daylight,
      action: () => {
        const cfg = STRUCTURE_CONFIGS.canoe;
        const timberPerHour = cfg.timberCost / cfg.totalHours;
        const savedProgress = structures.getProgressDays(resumeCanoeIdx);
        if (savedProgress >= cfg.totalHours / 24) { structures.complete(resumeCanoeIdx, stats); }
        else { stats.activeAction = { id: 'build_canoe', label: 'Building canoe', durationDays: cfg.totalHours / 24, progressDays: savedProgress, structureIndex: resumeCanoeIdx, timberPerHour }; }
      },
    } : null;
    const resumeShelterItem = resumeShelterIdx >= 0 ? {
      label: 'Resume Shelter',
      disabled: !daylight,
      action: () => {
        const cfg = STRUCTURE_CONFIGS.shelter;
        const timberPerHour = cfg.timberCost / cfg.totalHours;
        const savedProgress = structures.getProgressDays(resumeShelterIdx);
        if (savedProgress >= cfg.totalHours / 24) { structures.complete(resumeShelterIdx, stats); }
        else { stats.activeAction = { id: 'build_shelter', label: 'Building shelter', durationDays: cfg.totalHours / 24, progressDays: savedProgress, structureIndex: resumeShelterIdx, timberPerHour }; }
      },
    } : null;

    return [
      {
        label: "Rest Until Dawn",
        disabled: onWater || aboveTreeline,
        action: () => {
          const frac = stats.daysTraveled % 1;
          const morning = 6 / 24;
          const toNextDawn =
            frac < morning ? morning - frac : 1 + morning - frac;
          const duration = toNextDawn < 2 / 24 ? toNextDawn + 1 : toNextDawn;
          autoDropCanoe(ptx, pty);
          stats.activeAction = {
            id: "rest",
            label: "Resting",
            durationDays: duration,
            progressDays: 0,
            energyMultiplier: inShelter ? 8 : 1.5,
          };
          if (!inShelter) {
            const timberNeeded = Math.ceil((duration * 24) / 2);
            placeCampfire(ptx, pty, timberNeeded);
          }
        },
      },
      {
        label: "Forage",
        disabled: !daylight || inShelter,
        action: () => {
          stats.activeAction = {
            id: "forage",
            label: "Foraging",
            durationDays: Infinity,
            progressDays: 0,
          };
        },
      },
      {
        label: "Harvest Timber",
        disabled: !daylight || aboveTreeline || inShelter || onWater,
        action: () => {
          stats.activeAction = {
            id: "harvest_timber",
            label: "Harvesting timber",
            durationDays: Infinity,
            progressDays: 0,
          };
        },
      },
      {
        label: "Survey",
        disabled: !daylight || inShelter,
        action: () => enterSurvey(),
      },
      {
        label: "Drop Canoe",
        disabled: stats.canoes === 0 || onWater,
        action: () => {
          stats.canoes--;
          droppedCanoes.drop(
            Math.floor(player.tileX) + 1,
            Math.floor(player.tileY),
          );
        },
      },
      {
        label: "Campfire",
        disabled: onWater || aboveTreeline || inShelter,
        action: () => placeCampfire(ptx, pty, 2),
      },
      ...(resumeCanoeItem   ? [resumeCanoeItem]   : []),
      ...(resumeShelterItem ? [resumeShelterItem] : []),
      ...(() => {
        const site = settlements.getProximitySite(ptx, pty);
        if (!site) return [];
        const label = site.type === 'settlement'
          ? `Enter ${site.name}`
          : `Visit ${site.name}`;
        return [{
          label,
          action: () => {
            stats.food  = FOOD_CAPACITY_LBS;
            stats.water = WATER_CAPACITY_GAL;
            showToast(`Resupplied at ${site.name}`);
          },
        }];
      })(),
      {
        label: "Build",
        children: (() => {
          const tileX = Math.floor(player.tileX);
          const tileY = Math.floor(player.tileY);
          const existingCanoe = structures.findUnfinished(
            tileX,
            tileY,
            "canoe",
          );
          const existingShelter = structures.findUnfinished(
            tileX,
            tileY,
            "shelter",
          );
          const canBuildFromBiome = !aboveTreeline && biomeTimber > 0;
          return [
            {
              label: existingCanoe >= 0 ? "Resume Canoe" : "Canoe",
              disabled:
                !daylight ||
                inShelter ||
                (existingCanoe < 0 && !canBuildFromBiome),
              action: () => {
                const cfg = STRUCTURE_CONFIGS.canoe;
                const timberPerHour = cfg.timberCost / cfg.totalHours;
                if (existingCanoe >= 0) {
                  const savedProgress =
                    structures.getProgressDays(existingCanoe);
                  if (savedProgress >= cfg.totalHours / 24) {
                    structures.complete(existingCanoe, stats);
                  } else {
                    stats.activeAction = {
                      id: "build_canoe",
                      label: "Building canoe",
                      durationDays: cfg.totalHours / 24,
                      progressDays: savedProgress,
                      structureIndex: existingCanoe,
                      timberPerHour,
                    };
                  }
                } else {
                  const idx = structures.add(tileX, tileY, "canoe");
                  const matTile = findAdjacentLandTile(tileX, tileY) ?? {
                    tileX: tileX + 1,
                    tileY: tileY,
                  };
                  timberPiles.addAmount(
                    matTile.tileX,
                    matTile.tileY,
                    cfg.timberCost,
                    isWaterBiome,
                    isOccupied,
                  );
                  stats.activeAction = {
                    id: "build_canoe",
                    label: "Building canoe",
                    durationDays: cfg.totalHours / 24,
                    progressDays: 0,
                    structureIndex: idx,
                    timberPerHour,
                  };
                }
              },
            },
            {
              label: existingShelter >= 0 ? "Resume Shelter" : "Shelter",
              disabled:
                !daylight ||
                inShelter ||
                (existingShelter < 0 && !canBuildFromBiome),
              action: () => {
                const cfg = STRUCTURE_CONFIGS.shelter;
                const timberPerHour = cfg.timberCost / cfg.totalHours;
                if (existingShelter >= 0) {
                  const savedProgress =
                    structures.getProgressDays(existingShelter);
                  if (savedProgress >= cfg.totalHours / 24) {
                    structures.complete(existingShelter, stats);
                  } else {
                    stats.activeAction = {
                      id: "build_shelter",
                      label: "Building shelter",
                      durationDays: cfg.totalHours / 24,
                      progressDays: savedProgress,
                      structureIndex: existingShelter,
                      timberPerHour,
                    };
                  }
                } else {
                  const idx = structures.add(tileX, tileY, "shelter");
                  const matTile = findAdjacentLandTile(tileX, tileY) ?? {
                    tileX: tileX + 1,
                    tileY: tileY,
                  };
                  timberPiles.addAmount(
                    matTile.tileX,
                    matTile.tileY,
                    cfg.timberCost,
                    isWaterBiome,
                    isOccupied,
                  );
                  stats.activeAction = {
                    id: "build_shelter",
                    label: "Building shelter",
                    durationDays: cfg.totalHours / 24,
                    progressDays: 0,
                    structureIndex: idx,
                    timberPerHour,
                  };
                }
              },
            },
          ];
        })(),
      },
    ];
  },
  () => stats.activeAction?.id === "survey",
  () => input.reset(),
);
window.addEventListener("keydown", (e) => {
  if (manualPaused || blurPaused) {
    // Only P can resume — block everything else so no accidental key unpauses or moves the player.
    if (e.key === "p" || e.key === "P")
      (toggleManualPause(), (blurPaused = false), updatePauseState());
    e.preventDefault();
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    radialMenu.openAtTile(player.tileX, player.tileY);
  }
  if (e.key === "Escape") {
    activityLog.close();
    if (stats.activeAction) {
      if (stats.activeAction.id === "survey") exitSurvey();
      stats.activeAction = null;
    }
  }
  if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    toggleManualPause();
  }
  if (e.key === "q" || e.key === "Q") {
    e.preventDefault();
    questPanel.toggle();
  }
  if (e.key === "l" || e.key === "L") {
    e.preventDefault();
    activityLog.toggle();
  }
  if (e.key === "d" || e.key === "D") {
    const onWaterNow = isWaterBiome(
      Math.floor(player.tileX),
      Math.floor(player.tileY),
    );
    if (stats.canoes > 0 && !onWaterNow) {
      stats.canoes--;
      const tile = findNearbyDropTile(
        Math.floor(player.tileX),
        Math.floor(player.tileY),
      ) ?? {
        tileX: Math.floor(player.tileX) + 1,
        tileY: Math.floor(player.tileY),
      };
      droppedCanoes.drop(tile.tileX, tile.tileY);
    }
  }
  if (e.key === "Shift" && !e.repeat) {
    e.preventDefault();
    huntingMode = true;
    huntingOverlay.setActive(true);
    animals.setHuntingMode(true);
    huntingVignette.style.opacity = '1';
    radialMenu.closeAll();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") {
    huntingMode = false;
    huntingOverlay.setActive(false);
    animals.setHuntingMode(false);
    huntingVignette.style.opacity = '0';
  }
});

// Hunting click: fire rifle toward the clicked tile direction.
renderer.domElement.addEventListener("click", (e) => {
  if (!huntingMode) return;
  if (stats.rifleAmmo <= 0) {
    showHudMessage("Out of ammunition");
    return;
  }
  const tile = huntingOverlay.getClickTile(e, camera);
  if (!tile) return;

  // Direction from player center to clicked tile center
  const cx = tile.tileX + 0.5, cy = tile.tileY + 0.5;
  const dx = cx - player.tileX, dy = cy - player.tileY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ndx = dx / len, ndy = dy / len;

  const result = animals.fireRay(player.tileX, player.tileY, ndx, ndy, RIFLE_RANGE);
  animals.scareAll(player.tileX, player.tileY);
  stats.rifleAmmo--;

  // Bullet streak: player screen pos → endpoint screen pos
  const fromPos = getPlayerScreenPos();
  const toPos   = tileToScreen(result.endX, result.endY);
  huntingOverlay.fireBullet(fromPos.x, fromPos.y, toPos.x, toPos.y);
});

let playerMoving = false;
const tileInspector = createTileInspector(
  renderer.domElement,
  scene,
  camera,
  elevation,
  moisture,
  river,
  () => radialMenu.isOpen(),
  () => playerMoving,
  () => manualPaused || blurPaused,
  () => huntingMode,
);

// --- Pause state ---
// Two independent pause sources: manual (P key / button) and blur (window lost focus).
// Blur-pause requires an explicit click or keypress to dismiss; it does not auto-clear on focus.
// manualPaused is persisted in sessionStorage so hot reloads don't silently unpause the game.
let manualPaused = sessionStorage.getItem("manualPaused") === "true";
let blurPaused = false;

const pauseOverlay = document.createElement("div");
pauseOverlay.style.cssText = `
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.52);
  display: none;
  align-items: center; justify-content: center;
  z-index: 1900;
  font: 16px/1 monospace;
  letter-spacing: 0.18em;
  color: rgba(200,215,230,0.85);
  pointer-events: none;
`;
pauseOverlay.textContent = "PAUSED  —  press P to resume";
document.body.appendChild(pauseOverlay);

function updatePauseState() {
  pauseOverlay.style.display = manualPaused || blurPaused ? "flex" : "none";
}

function toggleManualPause() {
  manualPaused = !manualPaused;
  sessionStorage.setItem("manualPaused", String(manualPaused));
  updatePauseState();
}

// Auto-pause when window loses focus. Only P resumes — no click or accidental keypress can do it.
window.addEventListener("blur", () => {
  blurPaused = true;
  updatePauseState();
});

// --- Hunting vignette ---
const huntingVignette = document.createElement("div");
huntingVignette.style.cssText = `
  position: fixed; inset: 0;
  background: radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,0.72) 100%);
  pointer-events: none;
  z-index: 501;
  opacity: 0;
  transition: opacity 0.15s ease;
`;
document.body.appendChild(huntingVignette);

// --- Night overlay ---
const nightOverlay = document.createElement("div");
nightOverlay.style.cssText = `
  position: fixed; inset: 0;
  background: rgb(0, 8, 40);
  pointer-events: none;
  z-index: 500;
  opacity: 0;
`;
document.body.appendChild(nightOverlay);

function updateNightOverlay(daysFractional: number) {
  const timeOfDay = daysFractional % 1; // 0 = midnight, 0.5 = noon
  const darkness = (1 + Math.cos(timeOfDay * Math.PI * 2)) / 2; // 1 at midnight, 0 at noon
  nightOverlay.style.opacity = (darkness * 0.88).toFixed(3);
}

// --- Daily distance recap ---
// Shows miles traveled the previous day at midnight, fades out by 9 AM.
const dailyRecapEl = document.createElement("div");
dailyRecapEl.style.cssText = `
  position: fixed; top: 0; left: 0; right: 0;
  height: 44px;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 1001;
  opacity: 0;
  transition: opacity 1.5s ease;
`;
const dailyRecapText = document.createElement("span");
dailyRecapText.style.cssText =
  "color: #c8d8e8; font: 12px monospace; letter-spacing: 0.06em;";
dailyRecapEl.appendChild(dailyRecapText);
document.body.appendChild(dailyRecapEl);

let milesAtLastMidnight    = 0; // set after load
let foodAtLastMidnight     = 0;
let waterAtLastMidnight    = 0;
let foodSpoiledAtLastMidnight = 0;
let lastKnownDay = -1; // set after load; -1 means not yet initialized
let hasRecapData = false;

function updateDailyRecap(daysTraveled: number) {
  if (!hasRecapData) {
    dailyRecapEl.style.opacity = "0";
    return;
  }
  const t = daysTraveled % 1; // 0 = midnight, fraction of day
  const FADE_START = 8 / 24;
  const FADE_END = 9 / 24;
  if (t >= FADE_END) {
    dailyRecapEl.style.opacity = "0";
  } else if (t >= FADE_START) {
    dailyRecapEl.style.removeProperty("transition");
    dailyRecapEl.style.opacity = String(
      1 - (t - FADE_START) / (FADE_END - FADE_START),
    );
  } else {
    dailyRecapEl.style.opacity = "1";
  }
}

// --- Stats & HUD ---
const COMPASS_DIRS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

const stats = createStats();
const activityLog = createActivityLog();
const hud = createHud(
  currentSeed,
  () => {
    if (stats.activeAction?.id === "survey") exitSurvey();
    stats.activeAction = null;
  },
  () => {
    autoDropCanoe(Math.floor(player.tileX), Math.floor(player.tileY));
  },
  () => {
    blurPaused = false;
    toggleManualPause();
  },
  () => {
    questPanel.toggle();
  },
  {
    enter: () => questPanel.show(),
    leave: () => questPanel.scheduleHide(),
  },
  () => {
    activityLog.toggle();
  },
);
const updateHud = hud.update;
const showHudMessage = hud.showMessage;
const structures = new StructureManager(renderer.domElement, camera);
const droppedCanoes = new DroppedCanoeManager(renderer.domElement, camera);
const animals = new AnimalManager(
  renderer.domElement,
  camera,
  elevation,
  moisture,
  river,
);
const fishJumps = new FishJumpEffect(
  renderer.domElement,
  camera,
  elevation,
  moisture,
  river,
);
let huntingMode = false;
const huntingOverlay = new HuntingOverlay(renderer.domElement);

// Convert continuous tile position to fixed screen coordinates.
function tileToScreen(tileX: number, tileY: number): { x: number; y: number } {
  const r = renderer.domElement.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let cx: number, cy: number, w: number, h: number;
  if (ea > ca) { h = r.height; w = h * ca; cx = r.left + (r.width - w) / 2; cy = r.top; }
  else         { w = r.width; h = w / ca; cx = r.left; cy = r.top + (r.height - h) / 2; }
  const worldX = tileX * TILE_SIZE;
  const worldY = -tileY * TILE_SIZE;
  return {
    x: cx + (0.5 + (worldX - camera.position.x) / CANVAS_WIDTH)  * w,
    y: cy + (0.5 - (worldY - camera.position.y) / CANVAS_HEIGHT) * h,
  };
}
const timberPiles = new TimberPileManager(renderer.domElement, camera);
const mapPins = new MapPinManager(renderer.domElement, camera);
const ruinSprites = new RuinSpriteManager(renderer.domElement, camera);
const settlements = new SettlementManager(renderer.domElement, camera, elevation, moisture, river, currentSeed, mapPins);
const traders = new TraderManager(renderer.domElement, camera);
const quests = new QuestManager({
  onComplete: (q) => {
    if (q.type !== 'find_and_name') return;

    // Bearing from previous ruins → just-completed ruins, for forward chaining.
    const completedPin = mapPins.findById(q.data.pinId as string);
    const curX = completedPin?.tileX ?? lastRuinsTileX;
    const curY = completedPin?.tileY ?? lastRuinsTileY;
    const ddx = curX - prevRuinsTileX, ddy = curY - prevRuinsTileY;
    const forwardBearing = ((Math.atan2(ddx, -ddy) * 180 / Math.PI) + 360) % 360;

    // Place the next quest immediately — don't gate it on the screen being dismissed.
    prevRuinsTileX = curX;
    prevRuinsTileY = curY;
    placeRuinsQuest(curX, curY, forwardBearing, ruinsQuestCount++);

    showQuestComplete(q, pendingCityName || completedPin?.name || 'the ruins', () => {});
  },
});
const questPanel = createQuestPanel(quests);
// Capture the name here — onComplete fires synchronously inside notify, so this
// is always the name that triggered the quest completion.
let pendingCityName = '';
mapPins.onRename = (pinId, newName) => {
  pendingCityName = newName;
  quests.notify("pin_renamed", { pinId, newName });
};

// --- Persistence ---
let startTileX = Math.floor(player.tileX);
let startTileY = Math.floor(player.tileY);

function doSave() {
  if (gameOver) return;
  saveGame(
    currentSeed,
    weatherSeed,
    stats,
    Math.floor(player.tileX),
    Math.floor(player.tileY),
    startTileX,
    startTileY,
    structures.getSaveData(),
    droppedCanoes.getSaveData(),
    timberPiles.getSaveData(),
    mapPins.getSaveData(),
    quests.getSaveData(),
  );
}

const save = loadGame(currentSeed);
if (save) {
  Object.assign(stats, save.stats);
  player.teleport(save.playerTileX, save.playerTileY);
  startTileX = save.startTileX ?? Math.floor(player.tileX);
  startTileY = save.startTileY ?? Math.floor(player.tileY);
  for (const s of save.structures ?? [])
    structures.restore(s.tileX, s.tileY, s.type, s.progressDays, s.complete);
  for (const c of save.droppedCanoes ?? [])
    droppedCanoes.drop(c.tileX, c.tileY);
  for (const p of save.timberPiles ?? [])
    timberPiles.restorePile(p.tileX, p.tileY, p.amount);
  if (save.mapPins !== undefined) mapPins.restore(save.mapPins);
  if (save.quests !== undefined) quests.restore(save.quests);
}

// On a fresh game, scan for a large lake shore to start near.
if (!save) {
  const lakeTile = findLakeStartTile();
  if (lakeTile) {
    player.teleport(lakeTile.tileX, lakeTile.tileY);
    startTileX = lakeTile.tileX;
    startTileY = lakeTile.tileY;
  }
}

if (save?.weatherSeed !== undefined) weatherSeed = save.weatherSeed;
const weatherSystem = createWeatherSystem(weatherSeed);
const weatherOverlay = createWeatherOverlay(renderer.domElement);

// If this is a fresh game (or an old save without map-pin data), seed the starting location pin.
if (save?.mapPins === undefined) {
  const sx = startTileX,
    sy = startTileY + 4;
  const selev = sampleElevation(sx, sy, elevation);
  const smoist = sampleMoisture(sx, sy, moisture);
  const sriver = sampleRiver(sx, sy, river);
  const slake = sampleLake(sx, sy, river);
  const sbiome = getBiome(selev, smoist, sriver, slake);
  const elevFt = Math.round(Math.max(0, ((selev - 0.42) / 0.58) * 14400));
  mapPins.add({
    id: "start",
    tileX: sx,
    tileY: sy,
    name: "Starting Location",
    color: "#000",
    dayPlaced: stats.daysTraveled,
    elevationFt: elevFt,
    biome: sbiome,
    distanceMiles: 0,
    bearing: "at start",
    notes: "",
  });
}

// Compute the ruins tile — always deterministic per world seed.
// Sprites are placed every load; pin + quest only on fresh game.
{
  let ruinsSeed = 0;
  for (let i = 0; i < currentSeed.length; i++)
    ruinsSeed = (ruinsSeed * 31 + currentSeed.charCodeAt(i)) >>> 0;
  const rng = () => {
    ruinsSeed ^= ruinsSeed << 13;
    ruinsSeed ^= ruinsSeed >>> 17;
    ruinsSeed ^= ruinsSeed << 5;
    return (ruinsSeed >>> 0) / 0x100000000;
  };

  const RUINS_MIN_MILES = 15 * 0.85;
  const RUINS_MAX_MILES = 15 * 1.15;
  const WATER_BIOMES = new Set(["deep_water", "shallow_water"]);
  let rtx = startTileX,
    rty = startTileY;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist =
      (RUINS_MIN_MILES + rng() * (RUINS_MAX_MILES - RUINS_MIN_MILES)) /
      MILES_PER_TILE;
    const cx = Math.round(startTileX + Math.cos(angle) * dist);
    const cy = Math.round(startTileY + Math.sin(angle) * dist);
    const re = sampleElevation(cx, cy, elevation);
    const rm = sampleMoisture(cx, cy, moisture);
    const rr = sampleRiver(cx, cy, river);
    const rl = sampleLake(cx, cy, river);
    const rb = getBiome(re, rm, rr, rl);
    if (!WATER_BIOMES.has(rb)) {
      rtx = cx;
      rty = cy;
      break;
    }
  }

  // Always place the visual sprites.
  const spriteCount = 3 + Math.floor(rng() * 4); // 3–6
  ruinSprites.scatter(rtx, rty, spriteCount, rng);

  // Only add pin + quest on a fresh game.
  if (save?.quests === undefined) {
    const re = sampleElevation(rtx, rty, elevation);
    const rm = sampleMoisture(rtx, rty, moisture);
    const rr = sampleRiver(rtx, rty, river);
    const rl = sampleLake(rtx, rty, river);
    const rb = getBiome(re, rm, rr, rl);
    const reElevFt = Math.round(Math.max(0, ((re - 0.42) / 0.58) * 14400));
    const rdx = rtx - startTileX,
      rdy = rty - startTileY;
    const rMiles = Math.sqrt(rdx * rdx + rdy * rdy) * MILES_PER_TILE;
    const rAngle = ((Math.atan2(rdx, -rdy) * 180) / Math.PI + 360) % 360;
    const rBearing =
      rMiles < 0.1
        ? "at start"
        : `${rMiles.toFixed(1)} mi ${COMPASS_DIRS[Math.round(rAngle / 22.5) % 16]}`;
    const ruinsPinId = "ruins_0";
    mapPins.add({
      id: ruinsPinId,
      tileX: rtx,
      tileY: rty,
      name: "Nameless ruins",
      color: "#000",
      dayPlaced: 0,
      elevationFt: reElevFt,
      biome: rb,
      distanceMiles: rMiles,
      bearing: rBearing,
      notes: "",
    });
    quests.add({
      id: "quest_ruins_0",
      type: "find_and_name",
      title: "Find and name the ruins",
      description: `${rBearing} of starting location`,
      status: "active",
      data: { pinId: ruinsPinId },
    });
  }
}

// --- Ruins quest chain ---
// Track the "from" tile for each chain link so bearing stays forward.
let prevRuinsTileX = startTileX;
let prevRuinsTileY = startTileY;
let lastRuinsTileX = startTileX; // updated each time a ruins is placed
let lastRuinsTileY = startTileY;
// Derive the next quest index from however many ruins quests have already been placed
// (both complete and active). This survives save/reload correctly.
let ruinsQuestCount = quests.getAll().reduce((max, q) => {
  const m = q.id.match(/^quest_ruins_(\d+)$/);
  return m ? Math.max(max, parseInt(m[1]) + 1) : max;
}, 1);

// Seed lastRuinsTile from the most recently placed ruins pin.
{
  const latestPin = mapPins.findById(`ruins_${ruinsQuestCount - 1}`)
    ?? mapPins.findById('ruins_0');
  if (latestPin) { lastRuinsTileX = latestPin.tileX; lastRuinsTileY = latestPin.tileY; }
}

function placeRuinsQuest(fromTileX: number, fromTileY: number, forwardBearingDeg: number, questIndex: number) {
  // Distance grows with each quest: ~20, ~44, ~97, ~213, ~469 miles…
  const targetMiles  = 15 * Math.pow(3, questIndex - 1);
  const RUINS_MIN_MILES = targetMiles * 0.85;
  const RUINS_MAX_MILES = targetMiles * 1.15;
  const CONE_HALF_DEG   = 30;
  const WATER_BIOMES    = new Set(['deep_water', 'shallow_water']);

  let rtx = fromTileX, rty = fromTileY;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const bearingDeg = forwardBearingDeg + (Math.random() * CONE_HALF_DEG * 2 - CONE_HALF_DEG);
    const bearingRad = (bearingDeg * Math.PI) / 180;
    const dist = (RUINS_MIN_MILES + Math.random() * (RUINS_MAX_MILES - RUINS_MIN_MILES)) / MILES_PER_TILE;
    const cx = Math.round(fromTileX + Math.sin(bearingRad) * dist);
    const cy = Math.round(fromTileY - Math.cos(bearingRad) * dist);
    const re = sampleElevation(cx, cy, elevation);
    const rm = sampleMoisture(cx, cy, moisture);
    const rr = sampleRiver(cx, cy, river);
    const rl = sampleLake(cx, cy, river);
    if (!WATER_BIOMES.has(getBiome(re, rm, rr, rl))) { rtx = cx; rty = cy; break; }
  }

  const spriteCount = 3 + Math.floor(Math.random() * 4);
  ruinSprites.scatter(rtx, rty, spriteCount, Math.random);

  const re = sampleElevation(rtx, rty, elevation);
  const rm = sampleMoisture(rtx, rty, moisture);
  const rr = sampleRiver(rtx, rty, river);
  const rl = sampleLake(rtx, rty, river);
  const rb = getBiome(re, rm, rr, rl);
  const reElevFt = Math.round(Math.max(0, ((re - 0.42) / 0.58) * 14400));
  const rdx = rtx - startTileX, rdy = rty - startTileY;
  const rMiles = Math.sqrt(rdx * rdx + rdy * rdy) * MILES_PER_TILE;
  const rAngle = ((Math.atan2(rdx, -rdy) * 180) / Math.PI + 360) % 360;
  const rBearing = rMiles < 0.1 ? 'at start' : `${rMiles.toFixed(1)} mi ${COMPASS_DIRS[Math.round(rAngle / 22.5) % 16]}`;
  const pinId = `ruins_${questIndex}`;
  mapPins.add({
    id: pinId, tileX: rtx, tileY: rty, name: 'Nameless ruins', color: '#000',
    dayPlaced: stats.daysTraveled, elevationFt: reElevFt, biome: rb,
    distanceMiles: rMiles, bearing: rBearing, notes: '',
  });
  quests.add({
    id: `quest_ruins_${questIndex}`,
    type: 'find_and_name',
    title: 'Find and name the ruins',
    description: `${rBearing} of starting location`,
    status: 'active',
    data: { pinId },
  });

  lastRuinsTileX = rtx;
  lastRuinsTileY = rty;
}

// Initialize daily recap tracking after stats are loaded.
milesAtLastMidnight       = stats.milesTraveled;
foodAtLastMidnight        = stats.foodConsumed;
waterAtLastMidnight       = stats.waterConsumed;
foodSpoiledAtLastMidnight = stats.foodSpoiled;
lastKnownDay = Math.floor(stats.daysTraveled);

// --- Ambient temperature ---
// °F at a tile, accounting for biome base temp, elevation, and time of day.
// Coldest at midnight, warmest at noon; higher elevation = colder.
function ambientTempAt(tx: number, ty: number): number {
  const elev = sampleElevation(tx, ty, elevation);
  const moist = sampleMoisture(tx, ty, moisture);
  const riverVal = sampleRiver(tx, ty, river);
  const lakeVal = sampleLake(tx, ty, river);
  const biome = getBiome(elev, moist, riverVal, lakeVal);
  const dayFrac = stats.daysTraveled % 1;
  const timeMod = -Math.cos(dayFrac * Math.PI * 2) * 22; // -22 at midnight, +22 at noon
  const elevMod = -(elev - 0.5) * 45; // -22.5 at peaks, +9 in valleys

  // Special biomes keep their own base temp; everything else uses a smooth
  // elevation curve so there's no hard temperature jump at biome boundaries.
  let baseTemp: number;
  if (biome === "desert") baseTemp = 88;
  else if (biome === "beach") baseTemp = 60;
  else if (biome === "swamp") baseTemp = 50;
  else if (biome === "deep_water") baseTemp = 40;
  else if (biome === "shallow_water") baseTemp = 44;
  else baseTemp = 62 - Math.max(0, elev - 0.38) * 70; // plains→hills→mountains→snow

  return baseTemp + timeMod + elevMod;
}

// --- Distance from start ---
function distanceFromStart(): string {
  const dx = player.tileX - startTileX;
  const dy = player.tileY - startTileY;
  const miles = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
  if (miles < 0.1) return "at start";
  const angleDeg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const dir = COMPASS_DIRS[Math.round(angleDeg / 22.5) % 16];
  return `${miles.toFixed(1)} mi ${dir}`;
}

window.addEventListener("beforeunload", doSave);
setInterval(doSave, 60_000);

// --- Water movement constraint ---
function isWaterBiome(tx: number, ty: number): boolean {
  const b = getBiome(
    sampleElevation(tx, ty, elevation),
    sampleMoisture(tx, ty, moisture),
    sampleRiver(tx, ty, river),
    sampleLake(tx, ty, river),
  );
  return b === "deep_water" || b === "shallow_water";
}

function adjacentWaterBiome(tx: number, ty: number): BiomeProperties | null {
  for (let ddx = -1; ddx <= 1; ddx++) {
    for (let ddy = -1; ddy <= 1; ddy++) {
      if (ddx === 0 && ddy === 0) continue;
      if (isWaterBiome(tx + ddx, ty + ddy)) {
        const b = getBiome(
          sampleElevation(tx + ddx, ty + ddy, elevation),
          sampleMoisture(tx + ddx, ty + ddy, moisture),
          sampleRiver(tx + ddx, ty + ddy, river),
          sampleLake(tx + ddx, ty + ddy, river),
        );
        return BIOMES[b];
      }
    }
  }
  return null;
}

// Returns the first cardinal neighbor that is not a water tile, or null if all are water.
const ADJ_OFFSETS_R1 = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;
const ADJ_OFFSETS_R2 = [
  [0, 2],
  [2, 0],
  [-2, 0],
  [0, -2],
  [1, 2],
  [-1, 2],
  [2, 1],
  [2, -1],
  [-1, -2],
  [1, -2],
  [-2, 1],
  [-2, -1],
  [2, 2],
  [-2, 2],
  [2, -2],
  [-2, -2],
] as const;

function isOccupied(tx: number, ty: number): boolean {
  return structures.hasStructureAt(tx, ty) || droppedCanoes.hasCanoeAt(tx, ty);
}

function findFreeTile(
  tx: number,
  ty: number,
  alsoExcludeTimber = false,
): { tileX: number; tileY: number } | null {
  const blocked = (dx: number, dy: number) => {
    const x = tx + dx,
      y = ty + dy;
    return (
      isWaterBiome(x, y) ||
      isOccupied(x, y) ||
      (alsoExcludeTimber && timberPiles.getAmountWithin(x, y, 0) > 0)
    );
  };
  const r1 = ADJ_OFFSETS_R1.find(([dx, dy]) => !blocked(dx, dy));
  if (r1) return { tileX: tx + r1[0], tileY: ty + r1[1] };
  const r2 = ADJ_OFFSETS_R2.find(([dx, dy]) => !blocked(dx, dy));
  if (r2) return { tileX: tx + r2[0], tileY: ty + r2[1] };
  return null;
}

function findAdjacentLandTile(
  tx: number,
  ty: number,
): { tileX: number; tileY: number } | null {
  return findFreeTile(tx, ty, true);
}

function placeCampfire(tx: number, ty: number, timberUnits: number) {
  const tile = findAdjacentLandTile(tx, ty) ?? { tileX: tx + 1, tileY: ty };
  const idx = structures.add(tile.tileX, tile.tileY, "campfire");
  structures.complete(idx, stats);
  timberPiles.addAmount(
    tile.tileX,
    tile.tileY,
    timberUnits,
    isWaterBiome,
    isOccupied,
  );
  stats.warmth = 100;
}

// Find the nearest non-water, unoccupied tile within 2 squares to drop a canoe.
function findNearbyDropTile(
  fromX: number,
  fromY: number,
): { tileX: number; tileY: number } | null {
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = fromX + dx,
          ty = fromY + dy;
        if (isWaterBiome(tx, ty)) continue;
        if (timberPiles.getAmountWithin(tx, ty, 0) > 0) continue;
        if (structures.hasStructureAt(tx, ty)) continue;
        return { tileX: tx, tileY: ty };
      }
    }
  }
  return null;
}

function autoDropCanoe(fromX: number, fromY: number) {
  if (stats.canoes <= 0) return;
  const tile = findNearbyDropTile(fromX, fromY) ?? {
    tileX: fromX + 1,
    tileY: fromY,
  };
  stats.canoes--;
  droppedCanoes.drop(tile.tileX, tile.tileY);
}

// Search for the nearest land tile that borders a large lake.
// Pre-sorts candidates by distance from origin so the scan terminates as
// soon as the closest qualifying shore is found.
function findLakeStartTile(): { tileX: number; tileY: number } | null {
  const SEARCH = 280; // tile radius to scan
  const STEP = 3; // grid step (coarse pass)
  const MIN_ADJ = 2; // adjacent lake-water tiles required on the player tile
  const CHECK_R = 8; // radius for the "is it a large lake?" count
  const MIN_LAKE = 30; // lake tiles required within CHECK_R

  // Build candidate list and sort nearest-first for early termination.
  const pts: [number, number][] = [];
  for (let tx = -SEARCH; tx <= SEARCH; tx += STEP) {
    for (let ty = -SEARCH; ty <= SEARCH; ty += STEP) {
      pts.push([tx, ty]);
    }
  }
  pts.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));

  for (const [tx, ty] of pts) {
    // Must be a walkable land tile.
    const e = sampleElevation(tx, ty, elevation);
    const m = sampleMoisture(tx, ty, moisture);
    const r = sampleRiver(tx, ty, river);
    const l = sampleLake(tx, ty, river);
    const b = getBiome(e, m, r, l);
    if (b === "deep_water" || b === "shallow_water") continue;

    // Count adjacent lake-type water tiles (lake noise check, not river).
    let adjLake = 0;
    for (let adx = -1; adx <= 1; adx++) {
      for (let ady = -1; ady <= 1; ady++) {
        if (adx === 0 && ady === 0) continue;
        const ae = sampleElevation(tx + adx, ty + ady, elevation);
        const al = sampleLake(tx + adx, ty + ady, river);
        if (al > 0.78 && ae >= 0.42 && ae < 0.52) adjLake++;
      }
    }
    if (adjLake < MIN_ADJ) continue;

    // Verify it's a *large* lake by counting water tiles in a wider radius.
    let lakeCount = 0;
    for (let dx = -CHECK_R; dx <= CHECK_R; dx++) {
      for (let dy = -CHECK_R; dy <= CHECK_R; dy++) {
        const le = sampleElevation(tx + dx, ty + dy, elevation);
        const ll = sampleLake(tx + dx, ty + dy, river);
        if (ll > 0.78 && le >= 0.42 && le < 0.52) lakeCount++;
      }
    }
    if (lakeCount < MIN_LAKE) continue;

    return { tileX: tx, tileY: ty };
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

// --- Player sprite overlay ---
const playerEl = document.createElement("img");
playerEl.src = playerFrontIdleUrl;
playerEl.style.cssText = `
  position: fixed;
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 600;
`;
document.body.appendChild(playerEl);
player.mesh.visible = false;

// --- Canoe sprite overlay ---
const canoeEl = document.createElement("img");
canoeEl.src = canoeRightUrl;
canoeEl.style.cssText = `
  position: fixed;
  width: 64px;
  height: auto;
  image-rendering: pixelated;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 600;
  display: none;
`;
document.body.appendChild(canoeEl);

// --- Status indicators (above player head) ---
const snowflakeEl = document.createElement("div");
snowflakeEl.textContent = "❄️";
snowflakeEl.style.cssText = `
  position: fixed;
  font-size: 14px;
  line-height: 1;
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 601;
  display: none;
`;
document.body.appendChild(snowflakeEl);

const mendingHeartEl = document.createElement("div");
mendingHeartEl.textContent = "❤️‍🩹";
mendingHeartEl.style.cssText = `
  position: fixed;
  font-size: 14px;
  line-height: 1;
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 601;
  display: none;
`;
document.body.appendChild(mendingHeartEl);

// --- Survey mode ---
let surveyOffsetX = 0;
let surveyOffsetY = 0;
let surveyMaxRange = 0;
let forecastDepth = 1;

// Sample elevation advantage over the surrounding horizon to compute how
// far the player can see. Higher ground → wider view.
function computeSurveyRange(
  tx: number,
  ty: number,
  weatherVisMult = 1,
): number {
  const playerElev = sampleElevation(tx, ty, elevation);
  const biome = getBiome(
    playerElev,
    sampleMoisture(tx, ty, moisture),
    sampleRiver(tx, ty, river),
    sampleLake(tx, ty, river),
  );
  const visMult = BIOMES[biome].surveyVisibilityMult * weatherVisMult;
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
  const advantage = Math.max(0, playerElev - horizonElev);
  // Advantage of 0.10 (hills) → ~72 tiles; 0.25 (mountain peak) → ~144 tiles.
  // Cap at what fits within the survey chunk radius to avoid black edges.
  const maxPossible = SURVEY_CHUNK_RADIUS * CHUNK_WIDTH - 24;
  return Math.round(Math.min(24 + advantage * 480, maxPossible) * visMult);
}

function enterSurvey() {
  forecastDepth = 3;
  const tx = Math.floor(player.tileX);
  const ty = Math.floor(player.tileY);
  const currentWeatherForSurvey = weatherSystem.getCurrentEvent(
    stats.daysTraveled,
  );
  const resolvedForSurvey = resolveWeatherForTemp(
    currentWeatherForSurvey,
    ambientTempAt(tx, ty),
  );
  const weatherVisMult =
    getWeatherEffects(resolvedForSurvey).surveyVisibilityMult;
  surveyMaxRange = computeSurveyRange(tx, ty, weatherVisMult);
  surveyOffsetX = 0;
  surveyOffsetY = 0;
  const rangeStr = (surveyMaxRange * 0.1).toFixed(1);
  stats.activeAction = {
    id: "survey",
    label: `Surveying (${rangeStr} mi range)`,
    durationDays: Infinity,
    progressDays: 0,
  };
  chunkManager.beginSurvey(tx, ty, SURVEY_CHUNK_RADIUS);
  surveyTotalQueue = chunkManager.queueLength;
  if (surveyTotalQueue > 0) surveyLoadBar.style.display = "block";
}

function exitSurvey() {
  surveyOffsetX = 0;
  surveyOffsetY = 0;
  chunkManager.endSurvey();
  surveyLoadBar.style.display = "none";
}


// Thin progress bar at top of canvas showing async chunk load progress.
const surveyLoadBar = document.createElement("div");
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
  const r = renderer.domElement.getBoundingClientRect();
  const ea = r.width / r.height,
    ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  let cx: number, cy: number, w: number, h: number;
  if (ea > ca) {
    h = r.height;
    w = h * ca;
    cx = r.left + (r.width - w) / 2;
    cy = r.top;
  } else {
    w = r.width;
    h = w / ca;
    cx = r.left;
    cy = r.top + (r.height - h) / 2;
  }
  const wx = player.mesh.position.x;
  const wy = player.mesh.position.y;
  return {
    x: cx + (0.5 + (wx - camera.position.x) / CANVAS_WIDTH) * w,
    y: cy + (0.5 - (wy - camera.position.y) / CANVAS_HEIGHT) * h,
  };
}

function showToast(message: string) {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `
    position: fixed; left: 50%; top: 30%;
    transform: translateX(-50%);
    background: rgba(14,14,14,0.92);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px;
    color: #d8c88a; font: 13px/1 monospace;
    padding: 10px 20px;
    pointer-events: none; z-index: 1800;
    opacity: 1; transition: opacity 0.6s 1.4s ease-in;
  `;
  document.body.appendChild(el);
  void el.offsetHeight;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 2200);
}

function showForageEmoji(emoji: string) {
  const { x, y } = getPlayerScreenPos();
  const jitter = (Math.random() - 0.5) * 64;
  const el = document.createElement("div");
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
  el.style.top = `${y - 96}px`;
  el.style.transform = "translate(-50%, -50%) scale(1.5)";
  el.style.opacity = "0";
  setTimeout(() => el.remove(), 1900);
}

// --- Quest complete ---
function showQuestComplete(quest: { title: string }, cityName: string, onDismiss: () => void) {
  const homeDx = player.tileX - startTileX, homeDy = player.tileY - startTileY;
  const milesFromHome = Math.sqrt(homeDx * homeDx + homeDy * homeDy) * MILES_PER_TILE;
  const homeAngle = ((Math.atan2(homeDx, -homeDy) * 180 / Math.PI) + 360) % 360;
  const homeBearing = milesFromHome < 0.1 ? 'at start'
    : `${milesFromHome.toFixed(1)} mi ${COMPASS_DIRS[Math.round(homeAngle / 22.5) % 16]} of start`;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.78);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 2000; font-family: monospace; color: #ccc;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background: rgba(18,18,18,0.97);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px; padding: 40px 56px;
    max-width: 500px; width: 100%;
    display: flex; flex-direction: column; align-items: center;
  `;

  const title = document.createElement('div');
  title.textContent = '✦ Quest Complete ✦';
  title.style.cssText = 'font-size: 20px; color: #c8a84a; margin-bottom: 6px; letter-spacing: 0.06em;';

  const subtitle = document.createElement('div');
  subtitle.textContent = quest.title;
  subtitle.style.cssText = 'font-size: 13px; color: #aaa; margin-bottom: 14px;';

  const cityLine = document.createElement('div');
  cityLine.textContent = `You explored ${cityName}`;
  cityLine.style.cssText = 'font-size: 15px; color: #e8d8a0; margin-bottom: 28px; letter-spacing: 0.03em;';

  const stats_el = document.createElement('div');
  stats_el.style.cssText = 'font-size: 13px; margin-bottom: 32px; width: 100%;';

  function statRow(label: string, value: string, indent = false): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = `display:flex; justify-content:space-between; align-items:baseline; gap:24px; padding:4px 0 4px ${indent ? '20px' : '0'};`;
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.color = indent ? '#666' : '#888';
    const val = document.createElement('span');
    val.textContent = value;
    val.style.cssText = 'color:#ddd; white-space:nowrap;';
    row.append(lbl, val);
    return row;
  }

  function divider(): HTMLHRElement {
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:none; border-top:1px solid rgba(255,255,255,0.07); margin:8px 0;';
    return hr;
  }

  stats_el.append(
    statRow('Miles traveled', `${stats.milesTraveled.toFixed(1)} mi`),
    ...(stats.milesOverland  > 0.05 ? [statRow('· Overland',  `${stats.milesOverland.toFixed(1)} mi`,  true)] : []),
    ...(stats.milesPortaging > 0.05 ? [statRow('· Portaging', `${stats.milesPortaging.toFixed(1)} mi`, true)] : []),
    ...(stats.milesByCanoe   > 0.05 ? [statRow('· By canoe',  `${stats.milesByCanoe.toFixed(1)} mi`,   true)] : []),
    statRow('Distance from start', homeBearing),
    divider(),
    statRow('Food consumed',  `${stats.foodConsumed.toFixed(1)} lbs`),
    statRow('Water consumed', `${stats.waterConsumed.toFixed(1)} gal`),
  );

  const btn = document.createElement('button');
  btn.textContent = 'Continue';
  btn.style.cssText = `
    background: rgba(40,40,40,0.9); border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px; color: #d0d0d0; font: 13px monospace;
    padding: 10px 28px; cursor: pointer;
  `;
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)'; btn.style.color = '#d0d0d0'; });
  const dismiss = () => { overlay.remove(); onDismiss(); };
  // Delay input binding by one frame so the Enter that triggered the pin rename
  // doesn't immediately fire the Continue button.
  requestAnimationFrame(() => {
    btn.addEventListener('click', dismiss);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') dismiss(); });
    btn.focus();
  });

  box.append(title, subtitle, cityLine, stats_el, btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// --- Game over ---
let gameOver = false;

function showGameOver() {
  gameOver = true;
  radialMenu.closeAll();

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.78);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 2000;
    font-family: monospace;
    color: #ccc;
  `;

  const box = document.createElement("div");
  box.style.cssText = `
    background: rgba(18,18,18,0.97);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 40px 56px;
    text-align: center;
    max-width: 380px;
  `;

  const title = document.createElement("div");
  title.textContent = "You have perished.";
  title.style.cssText =
    "font-size: 22px; color: #c94040; margin-bottom: 14px; letter-spacing: 0.04em;";

  const sub = document.createElement("div");
  sub.style.cssText =
    "font-size: 13px; color: #888; margin-bottom: 32px; line-height: 1.6;";
  const homeDx = player.tileX - startTileX,
    homeDy = player.tileY - startTileY;
  const milesFromHome =
    Math.sqrt(homeDx * homeDx + homeDy * homeDy) * MILES_PER_TILE;
  sub.innerHTML = `Day ${Math.floor(stats.daysTraveled) + 1}  ·  ${stats.milesTraveled.toFixed(1)} miles traveled<br>${milesFromHome.toFixed(1)} miles from home`;

  const btn = document.createElement("button");
  btn.textContent = "Start over";
  btn.style.cssText = `
    background: rgba(40,40,40,0.9);
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px;
    color: #d0d0d0;
    font: 13px monospace;
    padding: 10px 28px;
    cursor: pointer;
  `;
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(70,70,70,0.95)";
    btn.style.color = "#fff";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(40,40,40,0.9)";
    btn.style.color = "#d0d0d0";
  });
  btn.addEventListener("click", () => {
    deleteSave(currentSeed);
    sessionStorage.removeItem("manualPaused");
    window.location.reload();
  });

  box.append(title, sub, btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// --- Game loop ---
let lastTime = performance.now();
let prevInShelter = false;
let lastFacingDir: "up" | "down" | "left" | "right" = "down";
let lastCanoeDir: "left" | "right" = "right";

function tick() {
  if (gameOver) return;
  requestAnimationFrame(tick);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  // Pause the simulation while the radial menu is open or the game is paused.
  const isPaused = manualPaused || blurPaused;
  const effectiveDelta = isPaused || radialMenu.isOpen() ? 0 : delta;

  const tx = Math.floor(player.tileX);
  const ty = Math.floor(player.tileY);
  const currentBiome = getBiome(
    sampleElevation(tx, ty, elevation),
    sampleMoisture(tx, ty, moisture),
    sampleRiver(tx, ty, river),
    sampleLake(tx, ty, river),
  );
  const biomeProps = BIOMES[currentBiome];
  const inWater =
    currentBiome === "deep_water" || currentBiome === "shallow_water";
  const usingCanoe = inWater && stats.canoes > 0;
  const carryingCanoe = !inWater && stats.canoes > 0;
  const inShelter = structures.playerInCompletedShelter(tx, ty);
  if (inShelter && !prevInShelter) autoDropCanoe(tx, ty);
  prevInShelter = inShelter;
  const currentTemp = ambientTempAt(tx, ty);
  const currentWeather = weatherSystem.getCurrentEvent(stats.daysTraveled);
  const resolvedWeather = resolveWeatherForTemp(currentWeather, currentTemp);
  const weatherEffects = getWeatherEffects(resolvedWeather);
  const effectiveSpeed =
    (usingCanoe
      ? 1.5
      : biomeProps.speedMultiplier * (carryingCanoe ? 0.45 : 1)) *
    getWeightMultiplier(stats) *
    weatherEffects.moveMult;

  // Canoeing is easy; portaging is exhausting
  const effectiveBiome = usingCanoe
    ? { ...biomeProps, energyDrainPerTile: 0.1 }
    : carryingCanoe
      ? {
          ...biomeProps,
          energyDrainPerTile: biomeProps.energyDrainPerTile * 2.2,
        }
      : biomeProps;

  // Survey mode: freeze the player and redirect WASD to camera pan instead.
  const isSurveying = stats.activeAction?.id === "survey";
  if (isSurveying) {
    const panX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const panY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (panX !== 0 || panY !== 0) {
      surveyOffsetX += panX * SURVEY_PAN_SPEED * effectiveDelta;
      surveyOffsetY += panY * SURVEY_PAN_SPEED * effectiveDelta;
      // Clamp to circular pan range
      const dist = Math.sqrt(
        surveyOffsetX * surveyOffsetX + surveyOffsetY * surveyOffsetY,
      );
      if (dist > surveyMaxRange) {
        surveyOffsetX = (surveyOffsetX / dist) * surveyMaxRange;
        surveyOffsetY = (surveyOffsetY / dist) * surveyMaxRange;
      }
    }
    // Update async-load progress bar
    if (surveyTotalQueue > 0) {
      const remaining = chunkManager.queueLength;
      if (remaining === 0) {
        surveyLoadBar.style.display = "none";
      } else {
        const pct = (1 - remaining / surveyTotalQueue) * 100;
        surveyLoadBar.style.display = "block";
        surveyLoadBar.style.width = `${pct}%`;
      }
    }
  }

  const playerInput = isSurveying
    ? { up: false, down: false, left: false, right: false }
    : input;

  const prevX = player.visualX;
  const prevY = player.visualY;
  player.update(playerInput, effectiveDelta, effectiveSpeed, canEnterTile);

  const dx = player.visualX - prevX;
  const dy = player.visualY - prevY;
  const tilesMoved = Math.sqrt(dx * dx + dy * dy);

  // Update facing direction and choose sprites.
  // Use integer input state (not float delta) so horizontal always wins over vertical
  // when both are held simultaneously, eliminating diagonal flicker.
  // Position is set later, after the camera update, so DOM and WebGL share the same camera.
  {
    if (tilesMoved > 1e-4) {
      const inputDx = (playerInput.right ? 1 : 0) - (playerInput.left ? 1 : 0);
      const inputDy = (playerInput.down ? 1 : 0) - (playerInput.up ? 1 : 0);
      if (inputDx !== 0) {
        lastFacingDir = inputDx > 0 ? "right" : "left";
        lastCanoeDir = inputDx > 0 ? "right" : "left";
      } else if (inputDy !== 0) {
        lastFacingDir = inputDy > 0 ? "down" : "up";
      }
    }
    let playerSrc: string;
    if (
      tilesMoved > 1e-4 &&
      (lastFacingDir === "right" || lastFacingDir === "left")
    ) {
      playerSrc =
        lastFacingDir === "right" ? playerRightWalkUrl : playerLeftWalkUrl;
    } else if (lastFacingDir === "up") {
      playerSrc = playerBackIdleUrl;
    } else {
      playerSrc = playerFrontIdleUrl;
    }
    if (usingCanoe) {
      playerEl.style.display = "none";
      canoeEl.style.display = "block";
      const newCanoeSrc =
        lastCanoeDir === "left" ? canoeLeftUrl : canoeRightUrl;
      if (canoeEl.src !== newCanoeSrc) canoeEl.src = newCanoeSrc;
    } else {
      canoeEl.style.display = "none";
      playerEl.style.display = inShelter ? "none" : "block";
      if (playerEl.src !== playerSrc) playerEl.src = playerSrc;
    }
  }

  playerMoving = tilesMoved > 1e-4;
  if (playerMoving) {
    radialMenu.closeAll();
    const id = stats.activeAction?.id;
    if (id === "forage" || id === "harvest_timber" || id === "harvest_minerals")
      stats.activeAction = null;
  }

  // Auto-pickup: collect a dropped canoe when walking onto its tile
  if (droppedCanoes.tryPickup(tx, ty)) stats.canoes++;

  // Collect dead animals when the player walks onto their tile
  {
    const harvest = animals.collectAt(tx, ty);
    if (harvest) {
      if (harvest.meatLbs > 0) {
        stats.food = Math.min(FOOD_CAPACITY_LBS, stats.food + harvest.meatLbs);
        showForageEmoji('🍖');
      }
      if (harvest.furPelts > 0) {
        stats.pelts += harvest.furPelts;
        showForageEmoji('🧣');
      }
    }
  }

  // Stepping onto a campfire tile douses it
  structures.extinguishAt(tx, ty);

  // Stop build if player left the required build tile.
  // buildTileX/Y overrides the structure tile (used when the structure is placed
  // on an adjacent tile, e.g. campfire, while the player stays on their own tile).
  if (
    stats.activeAction?.id.startsWith("build_") &&
    stats.activeAction.structureIndex !== undefined
  ) {
    const action = stats.activeAction;
    const stayTile =
      action.buildTileX !== undefined && action.buildTileY !== undefined
        ? { tileX: action.buildTileX, tileY: action.buildTileY }
        : structures.getTile(action.structureIndex!);
    if (
      stayTile &&
      (Math.floor(player.tileX) !== stayTile.tileX ||
        Math.floor(player.tileY) !== stayTile.tileY)
    ) {
      stats.activeAction = null;
    }
  }

  const prevAction = stats.activeAction;
  const buildProgressBefore = prevAction?.id.startsWith("build_")
    ? prevAction.progressDays
    : -1;
  const prevDaysTraveled = stats.daysTraveled;

  const fishBiome = inWater
    ? effectiveBiome
    : (adjacentWaterBiome(tx, ty) ?? undefined);
  const warming: "campfire" | "shelter" | false = structures.isWarmed(tx, ty)
    ? inShelter
      ? "shelter"
      : "campfire"
    : false;
  const { timeTicking, forageEvents } = updateStats(
    stats,
    effectiveDelta,
    tilesMoved,
    effectiveBiome,
    fishBiome,
    usingCanoe,
    currentTemp,
    warming,
    weatherEffects,
    carryingCanoe,
  );

  // A shelter always keeps warmth above "Chilled" regardless of detection edge-cases.
  if (inShelter) stats.warmth = Math.max(41, stats.warmth);

  for (const ev of forageEvents) {
    showForageEmoji(ev.emoji);
    if (ev.timber)
      timberPiles.addAmount(tx, ty, ev.timber, isWaterBiome, isOccupied);
  }

  // Lightning: thunderstorm + high elevation + not sheltered = strike chance
  if (resolvedWeather.type === "thunderstorm" && !inShelter) {
    const playerElev = sampleElevation(tx, ty, elevation);
    if (playerElev >= 0.65) {
      const exposureFactor = Math.min(1, (playerElev - 0.65) / 0.17);
      const strikeProbThisFrame =
        (effectiveDelta / SECONDS_PER_DAY) *
        5.4 *
        resolvedWeather.intensity *
        exposureFactor;
      if (Math.random() < strikeProbThisFrame) {
        const damage = 20 + Math.floor(Math.random() * 20);
        stats.health = Math.max(0, stats.health - damage);
        weatherOverlay.triggerLightningFlash();
      }
    }
  }

  weatherOverlay.update(
    resolvedWeather,
    effectiveDelta / SECONDS_PER_DAY,
    inShelter,
  );

  // Deduct timber from adjacent piles once per build hour crossed
  if (
    prevAction?.id.startsWith("build_") &&
    prevAction.timberPerHour !== undefined &&
    prevAction.structureIndex !== undefined
  ) {
    const buildProgressAfter = prevAction.progressDays; // mutated in-place by updateStats
    const hoursBefore = Math.floor(buildProgressBefore * 24);
    const hoursNow = Math.floor(buildProgressAfter * 24);
    if (hoursNow > hoursBefore) {
      const tile = structures.getTile(prevAction.structureIndex);
      if (tile)
        timberPiles.consumeFromAdjacent(
          tile.tileX,
          tile.tileY,
          prevAction.timberPerHour,
        );
    }
  }

  // Sync build progress; detect completion (updateStats nulls the action on finish)
  if (
    prevAction?.id.startsWith("build_") &&
    prevAction.structureIndex !== undefined
  ) {
    if (stats.activeAction) {
      structures.setProgress(
        prevAction.structureIndex,
        stats.activeAction.progressDays,
      );
    } else if (prevAction.progressDays >= prevAction.durationDays) {
      structures.complete(prevAction.structureIndex, stats);
    } else {
      // Cancelled (night, player moved off tile) — save progress for resumption
      structures.setProgress(
        prevAction.structureIndex,
        prevAction.progressDays,
      );
    }
  }

  // If survey was auto-stopped by sunset, clean up camera state.
  if (prevAction?.id === "survey" && !stats.activeAction) {
    exitSurvey();
  }

  // Campfire fuel consumption: burns 1 timber per 2 game-hours from piles within 2 tiles.
  const gameDaysElapsed = stats.daysTraveled - prevDaysTraveled;
  if (gameDaysElapsed > 0) {
    for (const {
      index,
      tileX: ftx,
      tileY: fty,
      fuelNeeded,
    } of structures.tickCampfires(gameDaysElapsed)) {
      const consumed = timberPiles.consumeFromAdjacent(ftx, fty, fuelNeeded, 2);
      if (consumed < fuelNeeded) structures.burnOut(index);
    }
  }

  // Midnight recap: when a new game-day begins, record how far the player
  // walked during the day that just ended and show it until 9 AM.
  const currentDay = Math.floor(stats.daysTraveled);
  if (currentDay > lastKnownDay) {
    const dayMiles   = stats.milesTraveled - milesAtLastMidnight;
    const dayFood    = stats.foodConsumed  - foodAtLastMidnight;
    const dayWater   = stats.waterConsumed - waterAtLastMidnight;
    const daySpoiled = stats.foodSpoiled   - foodSpoiledAtLastMidnight;
    if (dayMiles >= 0.05) {
      dailyRecapText.textContent = `Day ${lastKnownDay + 1}: ${dayMiles.toFixed(1)} miles traveled`;
      dailyRecapEl.style.transition = "none";
      dailyRecapEl.style.opacity = "1";
      hasRecapData = true;
      const spoiledStr = daySpoiled >= 0.1 ? ` · ${daySpoiled.toFixed(1)} lbs spoiled` : '';
      activityLog.addEntry(
        `Day ${lastKnownDay + 1}: ${dayMiles.toFixed(1)} mi · ate ${dayFood.toFixed(1)} lbs · drank ${dayWater.toFixed(1)} gal${spoiledStr}`,
      );
    }
    milesAtLastMidnight       = stats.milesTraveled;
    foodAtLastMidnight        = stats.foodConsumed;
    waterAtLastMidnight       = stats.waterConsumed;
    foodSpoiledAtLastMidnight = stats.foodSpoiled;
    lastKnownDay = currentDay;
  }
  updateDailyRecap(stats.daysTraveled);

  if (stats.health <= 0) {
    showGameOver();
    return;
  }
  const forecast = weatherSystem.getForecast(stats.daysTraveled, forecastDepth);
  const weatherStr = [
    weatherLabel(resolvedWeather),
    ...forecast.map((e) => weatherLabel(resolveWeatherForTemp(e, currentTemp))),
  ].join(" → ");
  const playerElevFt = Math.max(
    0,
    Math.round((sampleElevation(tx, ty, elevation) - 0.42) * 25000),
  );
  updateHud(
    stats,
    timeTicking,
    distanceFromStart(),
    currentTemp,
    carryingCanoe,
    weatherStr,
    isPaused,
    playerElevFt,
    huntingMode,
  );
  updateNightOverlay(stats.daysTraveled);
  tileInspector.update();
  structures.update();
  droppedCanoes.update();
  timberPiles.update();
  ruinSprites.update();
  settlements.discover(tx, ty, startTileX, startTileY);
  settlements.update();
  traders.update(effectiveDelta, player.visualX, player.visualY);
  animals.update(
    effectiveDelta,
    player.visualX,
    player.visualY,
    stats.daysTraveled,
  );
  fishJumps.update(effectiveDelta, player.visualX, player.visualY);
  mapPins.update();

  // During survey the player tile doesn't change, so normal ACTIVE_RADIUS
  // window stays centered on the player. The survey async queue handles far chunks.
  chunkManager.update(player.visualX, player.visualY);

  // Camera follows player + survey pan offset (offset is 0,0 outside survey mode).
  const camX = player.mesh.position.x + surveyOffsetX * TILE_SIZE;
  const camY = player.mesh.position.y - surveyOffsetY * TILE_SIZE;
  camera.position.set(camX, camY, 1);

  // Position player/canoe overlays after camera update so DOM and WebGL use the same camera,
  // preventing the per-frame jitter that comes from using a stale camera position.
  {
    const pos = getPlayerScreenPos();
    if (usingCanoe) {
      canoeEl.style.left = `${pos.x}px`;
      canoeEl.style.top = `${pos.y}px`;
    } else {
      playerEl.style.left = `${pos.x}px`;
      playerEl.style.top = `${pos.y}px`;
    }
    // Status indicators above the player sprite. Offset sideways when both show.
    const cold = stats.warmth < 50;
    const injured = stats.health < 50;
    const both = cold && injured;
    snowflakeEl.style.display = cold ? "block" : "none";
    mendingHeartEl.style.display = injured ? "block" : "none";
    if (cold || injured) {
      const indicatorY = pos.y - 16;
      snowflakeEl.style.left = `${pos.x + (both ? -9 : 0)}px`;
      snowflakeEl.style.top = `${indicatorY}px`;
      mendingHeartEl.style.left = `${pos.x + (both ? 9 : 0)}px`;
      mendingHeartEl.style.top = `${indicatorY}px`;
    }
  }

  // Hunting reticle wobble: amplitude scales with distance, settles after ~1.5s of stillness.
  if (huntingMode) {
    const fromPos = getPlayerScreenPos();
    const mPos = huntingOverlay.getMouseScreenPos();
    const distPx = Math.sqrt((mPos.x - fromPos.x) ** 2 + (mPos.y - fromPos.y) ** 2);
    huntingOverlay.update(delta, distPx * 0.12);
  }

  renderer.render(scene, camera);
}

updatePauseState(); // restore overlay if manualPaused was persisted
tick();
