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
import { TrapManager } from "./traps";
import { saveGame, loadGame, deleteSave, saveManualGame, loadManualGame, hasManualSave, promoteManualToAuto, cleanLegacySaves } from "./save";
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
  getSeasonLabel,
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
import { MANEATER_QUEST_EXPIRE_DAYS } from "./manEaterQuests";
import { createDebugPanel } from "./debugPanel";
import { PLAYER_SPEED } from "./constants";
import { computeAmbientTemp, canWadeShallowWater, createWorldQueries } from "./worldQueries";
import { createRivalParties, tickRivalParties, getNewsReport, RIVAL_TOTAL_RUINS } from "./rivalParties";
import type { RivalParty } from "./rivalParties";

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

// --- Seed: read from URL param; fall back to last-played seed; then default ---
function resolveSeed(): string {
  // Priority: URL param > sessionStorage (same-tab HMR reload) > lastSeed (new tab) > default
  const params = new URLSearchParams(window.location.search);
  const urlSeed = params.get("seed");
  if (urlSeed) {
    sessionStorage.setItem("currentSeed", urlSeed);
    return urlSeed;
  }
  const sessionSeed = sessionStorage.getItem("currentSeed");
  if (sessionSeed) return sessionSeed;
  const resolved = localStorage.getItem("lastSeed") ?? SEED;
  sessionStorage.setItem("currentSeed", resolved);
  const url = new URL(window.location.href);
  url.searchParams.set("seed", resolved);
  window.history.replaceState(null, "", url.toString());
  return resolved;
}
const currentSeed = resolveSeed();
cleanLegacySaves();
let weatherSeed = Math.floor(Math.random() * 0x100000000);

// --- World ---
const { elevation, moisture, river } = createNoiseGenerators(currentSeed);
const chunkManager = new ChunkManager(scene, elevation, moisture, river);
const { getBiomeAt, isWaterBiome, adjacentWaterBiome } = createWorldQueries(elevation, moisture, river);

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
        disabled: inShelter,
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
              label: "Canoe",
              disabled:
                !daylight ||
                inShelter ||
                existingCanoe >= 0 ||
                !canBuildFromBiome,
              action: () => {
                const cfg = STRUCTURE_CONFIGS.canoe;
                const timberPerHour = cfg.timberCost / cfg.totalHours;
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
                  durationDays: cfg.totalHours / 24 / (stats.tools > 0 ? 2 : 1),
                  progressDays: 0,
                  structureIndex: idx,
                  timberPerHour,
                };
              },
            },
            {
              label: "Shelter",
              disabled:
                !daylight ||
                inShelter ||
                existingShelter >= 0 ||
                !canBuildFromBiome,
              action: () => {
                const cfg = STRUCTURE_CONFIGS.shelter;
                const timberPerHour = cfg.timberCost / cfg.totalHours;
                {
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
                    durationDays: cfg.totalHours / 24 / (stats.tools > 0 ? 2 : 1),
                    progressDays: 0,
                    structureIndex: idx,
                    timberPerHour,
                  };
                }
              },
            },
            {
              label: "Deadfall",
              disabled: !daylight || onWater,
              action: () => {
                stats.activeAction = {
                  id: "build_deadfall",
                  label: "Setting deadfall trap",
                  durationDays: 20 / 60 / 24,
                  progressDays: 0,
                };
              },
            },
          ];
        })(),
      },
      {
        label: "Survey",
        disabled: !daylight || inShelter,
        action: () => enterSurvey(),
      },
      {
        label: "Treat Wound",
        disabled: !stats.bleeding,
        action: () => {
          stats.activeAction = {
            id: "treat_wound",
            label: "Treating wound",
            durationDays: 1 / 24,
            progressDays: 0,
          };
        },
      },
      {
        label: "Track",
        disabled: !daylight || onWater || !settlements.getAcceptedManEaterQuests().some(q => !q.completed),
        action: () => {
          stats.activeAction = {
            id: "track_maneater",
            label: "Tracking",
            durationDays: 1 / 24,
            progressDays: 0,
          };
        },
      },
      {
        label: "Campfire",
        disabled: onWater || aboveTreeline || inShelter,
        action: () => placeCampfire(ptx, pty, 2),
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
        label: "Use Item",
        disabled: stats.medicine === 0 && stats.liquor === 0,
        children: [
          {
            label: `Medicine 💊${stats.medicine > 1 ? ` ×${stats.medicine}` : ''}`,
            disabled: stats.medicine === 0,
            action: () => {
              stats.medicine--;
              stats.health = 100;
              stats.bleeding = false;
              showHudMessage("Medicine taken — health restored");
            },
          },
          {
            label: `Liquor 🍶${stats.liquor > 1 ? ` ×${stats.liquor}` : ''}`,
            disabled: stats.liquor === 0,
            action: () => {
              stats.liquor--;
              stats.morale = Math.min(100, stats.morale + 60);
              stats.warmth = Math.min(100, stats.warmth + 35);
              showHudMessage("Liquor consumed — morale & warmth restored");
            },
          },
        ],
      },
    ];
  },
  () => stats.activeAction?.id === "survey",
  () => input.reset(),
);
window.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key === '\\') {
    e.preventDefault();
    debugPanel.toggle();
    return;
  }
  if (manualPaused || blurPaused) {
    // Only P can resume — block everything else so no accidental key unpauses or moves the player.
    if (e.key === "p" || e.key === "P")
      (toggleManualPause(), (blurPaused = false), updatePauseState());
    e.preventDefault();
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    if (!traders.isTradingPaused()) radialMenu.openAtTile(player.tileX, player.tileY);
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
  if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    doSave();
    showHudMessage("Game saved.");
  }
  if (e.key === "v" || e.key === "V") {
    e.preventDefault();
    hud.togglePlaces();
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
  // Arrow keys or Escape cancel auto-walk.
  if (autoWalkMode && !e.repeat && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(e.key)) {
    autoWalkMode = false;
    autoWalkDx = 0;
    autoWalkDy = 0;
    hud.flash("Auto-walk off");
  }
  if (e.key === "Meta" && !e.repeat) {
    cmdDownTime = performance.now();
  }
  if (e.key === "Shift" && !e.repeat) {
    huntingMode = true;
    huntingOverlay.setActive(true);
    animals.setHuntingMode(true);
    huntingVignette.style.opacity = '1';
    radialMenu.closeAll();
  }
  // Shift + any other key (e.g. Shift+4 screenshot shortcut) → exit hunting mode.
  if (e.shiftKey && e.key !== "Shift") {
    if (huntingMode) {
      huntingMode = false;
      huntingOverlay.setActive(false);
      animals.setHuntingMode(false);
      huntingVignette.style.opacity = '0';
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") {
    huntingMode = false;
    huntingOverlay.setActive(false);
    animals.setHuntingMode(false);
    huntingVignette.style.opacity = '0';
  }
  if (e.key === "Meta" && cmdDownTime > 0) {
    if (performance.now() - cmdDownTime >= CMD_LONGPRESS_MS) {
      autoWalkMode = !autoWalkMode;
      if (!autoWalkMode) { autoWalkDx = 0; autoWalkDy = 0; }
      hud.flash(autoWalkMode ? "Auto-walk on" : "Auto-walk off");
    }
    cmdDownTime = 0;
  }
});

// Hunting click: fire rifle toward the clicked tile direction.
renderer.domElement.addEventListener("click", (e) => {
  if (manualPaused || blurPaused) return;
  if (!huntingMode) return;
  if (stats.rifleAmmo <= 0) {
    showHudMessage("Out of ammunition");
    return;
  }
  const tile = huntingOverlay.getClickTile(e, camera);
  if (!tile) return;

  // Direction from player visual center to clicked tile center, with random spread (±1°).
  const cx = tile.tileX + 0.5, cy = tile.tileY + 0.5;
  const dx = cx - player.visualX, dy = cy - player.visualY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const baseNdx = dx / len, baseNdy = dy / len;
  const precision = stats.precisionRifle > 0;
  const jitterDeg = precision ? 0.25 : 2;
  const jitter = (Math.random() * 2 - 1) * (jitterDeg * Math.PI / 180);
  const cosJ = Math.cos(jitter), sinJ = Math.sin(jitter);
  const ndx = baseNdx * cosJ - baseNdy * sinJ;
  const ndy = baseNdx * sinJ + baseNdy * cosJ;

  const rifleRange = RIFLE_RANGE + (precision ? 2 : 0);
  const result = animals.fireRay(player.visualX, player.visualY, ndx, ndy, rifleRange);
  animals.scareAll(player.tileX, player.tileY);
  stats.rifleAmmo--;

  if (result.manEaterKilled) {
    stats.trophies.push(result.manEaterKilled);
    showHudMessage(`You've killed ${result.manEaterKilled.manEaterName}! Return to the village to claim your reward.`);
  }

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
  (tileX, tileY) => animals.getDescriptionAt(tileX, tileY) ?? settlements.getResidentDescriptionAt(tileX, tileY),
);

// --- Pause state ---
// Two independent pause sources: manual (P key / button) and blur (window lost focus).
// Blur-pause requires an explicit click or keypress to dismiss; it does not auto-clear on focus.
// manualPaused is persisted in localStorage so it survives page reloads and crash recovery.
let manualPaused = localStorage.getItem("manualPaused") === "true";
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

// Clear any held-key/long-press state at the moment pause engages, so a key that's
// physically still held (or released while paused, swallowing its keyup) can't leave
// stale input state that causes movement or an auto-walk toggle right after resuming.
function clearInputStateForPause() {
  input.reset();
  cmdDownTime = 0;
}

function toggleManualPause() {
  manualPaused = !manualPaused;
  localStorage.setItem("manualPaused", String(manualPaused));
  if (manualPaused) clearInputStateForPause();
  updatePauseState();
}

// Auto-pause when window loses focus. Only P resumes — no click or accidental keypress can do it.
window.addEventListener("blur", () => {
  blurPaused = true;
  clearInputStateForPause();
  updatePauseState();
});
// Also pause when the tab/page is hidden (covers sleep/wake and tab switches that don't fire blur).
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { blurPaused = true; clearInputStateForPause(); updatePauseState(); }
});

// --- Global pause input gate ---
// Runs in the capture phase on window, which fires before every other listener in the
// document (including ones added later by trader/settlement/radial-menu dialogs), so it
// is the single choke point that guarantees "nothing happens" while paused rather than
// relying on every individual click/keydown handler to remember to check pause state.
// keyup is intentionally NOT blocked — clearInputStateForPause() already neutralizes any
// held-key state at the moment pause engages, so letting keyup through avoids a stuck-key
// bug where releasing a key during pause would otherwise never clear it.
window.addEventListener("keydown", (e) => {
  if (!(manualPaused || blurPaused)) return;
  if (e.key === "p" || e.key === "P") return; // the sole resume action
  if (e.metaKey && e.key === "\\") return; // dev debug-panel toggle; doesn't touch game state
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

for (const type of ["click", "mousedown", "pointerdown", "dblclick", "contextmenu"]) {
  window.addEventListener(type, (e) => {
    if (manualPaused || blurPaused) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
}

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

// --- Random ruin name generator ---
// Names draw from Quechua and Sanskrit phonetics to evoke a lost ancient civilization.
const RUIN_ROOTS_A = [
  'Pacha', 'Huayna', 'Inti', 'Qori', 'Saxa', 'Rumi', 'Puma', 'Cusi',
  'Wira', 'Yana', 'Tupa', 'Vica', 'Urco', 'Paucar', 'Tampu', 'Caxas',
  'Maha', 'Vara', 'Naga', 'Soma', 'Deva', 'Mani', 'Surya', 'Hema',
  'Jaya', 'Chandra', 'Kavi', 'Indra', 'Patta', 'Dhara',
];
const RUIN_ROOTS_B = [
  'camac', 'marca', 'tambo', 'cocha', 'pampa', 'cancha', 'bamba',
  'huasi', 'picchu', 'pura', 'vati', 'giri', 'nagar', 'kota',
  'pur', 'puram', 'garh', 'nath', 'wadi', 'yoc',
];
function randomRuinName(): string {
  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const cap  = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const a = pick(RUIN_ROOTS_A);
  const b = pick(RUIN_ROOTS_B);
  const r = Math.random();
  if (r < 0.55) return `${a}${b}`;          // compound: "Pachacamac"
  if (r < 0.85) return `${a} ${cap(b)}`;    // two words: "Huayna Tambo"
  // three parts: two A-roots fused + B-suffix
  const a2 = pick(RUIN_ROOTS_A);
  return `${a}${a2.toLowerCase()} ${cap(b)}`;
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

// --- Race state ---
let rivalParties: RivalParty[] = [];
let capitalTileX = 0;
let capitalTileY = 0;
let capitalUnlocked = false;

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
  () => {
    if (stats.medicine <= 0) return;
    stats.medicine--;
    stats.health = 100;
    stats.bleeding = false;
    hud.flash("Medicine taken — health restored");
  },
  () => {
    if (stats.liquor <= 0) return;
    stats.liquor--;
    stats.morale = Math.min(100, stats.morale + 60);
    stats.warmth = Math.min(100, stats.warmth + 35);
    hud.flash("Liquor consumed — morale & warmth restored");
  },
  () => {
    if (stats.lodestone <= 0) return;
    if (capitalUnlocked) {
      const dx = capitalTileX - player.tileX, dy = capitalTileY - player.tileY;
      const deg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
      const bearing = COMPASS_DIRS[Math.round(deg / 22.5) % 16];
      const distMi = (Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE).toFixed(0);
      hud.flash(`Lodestone: capital to the ${bearing} (~${distMi} mi)`);
      return;
    }
    // Nameless ruin pins are placed by the quest system with id "ruins_N" and
    // name "Nameless ruins". They exist at the target tile even before the player
    // has visited the area, unlike ruin footprint sprites which are scattered on arrival.
    const pins = mapPins.getAll();
    let bestDist = Infinity, bestTileX = 0, bestTileY = 0, found = false;
    for (const p of pins) {
      if (!p.id.startsWith("ruins_") || p.name !== "Nameless ruins") continue;
      const dx = p.tileX - player.tileX, dy = p.tileY - player.tileY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; bestTileX = p.tileX; bestTileY = p.tileY; found = true; }
    }
    if (!found) {
      hud.flash("The lodestone is still.");
      return;
    }
    const dx = bestTileX - player.tileX, dy = bestTileY - player.tileY;
    const deg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
    const bearing = COMPASS_DIRS[Math.round(deg / 22.5) % 16];
    hud.flash(`Lodestone: ruins to the ${bearing}`);
  },
  () => doManualSave(),
  () => {
    gameOver = true; // prevent beforeunload from re-saving
    deleteSave();
    const newSeed = Math.random().toString(36).slice(2, 10);
    const url = new URL(window.location.href);
    url.searchParams.set('seed', newSeed);
    window.location.href = url.toString();
  },
);
const updateHud = hud.update;
const showHudMessage = hud.flash;
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
const traps = new TrapManager(renderer.domElement, camera);
// Tiles where a trap was just placed — skip the step-check until the player leaves and returns.
const freshTrapTiles = new Set<string>();
const mapPins = new MapPinManager(renderer.domElement, camera);
const ruinSprites = new RuinSpriteManager(renderer.domElement, camera);
const settlements = new SettlementManager(renderer.domElement, camera, elevation, moisture, river, currentSeed, mapPins);
const traders = new TraderManager(renderer.domElement, camera, elevation, moisture, river);

function buildCapitalClue(
  ruinIndex: number,
  fromX: number,
  fromY: number,
  hasLodestone: boolean,
  nextRuinsX?: number,
  nextRuinsY?: number,
): string[] {
  const dx = capitalTileX - fromX, dy = capitalTileY - fromY;
  const deg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
  const bearingIdx = Math.round(deg / 22.5) % 16;
  const bearing = COMPASS_DIRS[bearingIdx];

  let capitalHint: string;
  if (ruinIndex === 0) {
    const lo = COMPASS_DIRS[(bearingIdx + 14) % 16];
    const hi = COMPASS_DIRS[(bearingIdx + 2) % 16];
    capitalHint = `The inscriptions suggest the capital lies somewhere between ${lo} and ${hi}.`;
  } else if (ruinIndex === 1) {
    capitalHint = `The artifacts point clearly to the ${bearing}.`;
  } else if (ruinIndex === 2) {
    const distMi = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
    capitalHint = `The capital lies approximately ${distMi.toFixed(0)} miles to the ${bearing}.`;
  } else {
    capitalHint = hasLodestone
      ? `Your lodestone now points toward the ancient capital. Tap it to check your bearing.`
      : `Among the rubble you find a Lodestone Amulet. It now guides you to the capital — tap it to check your bearing.`;
  }

  const ordinals = ['first', 'second', 'third', 'fourth'];
  const ordinal = ordinals[ruinIndex] ?? `${ruinIndex + 1}th`;
  const isFinal = ruinIndex === RIVAL_TOTAL_RUINS - 1;
  const paragraphs: string[] = [
    isFinal
      ? `You've found the fourth and final clue about the location of the ancient capital.`
      : `You've found the ${ordinal} of four clues about the location of the ancient capital.`,
  ];

  if (nextRuinsX !== undefined && nextRuinsY !== undefined) {
    const ndx = nextRuinsX - startTileX, ndy = nextRuinsY - startTileY;
    const ndeg = ((Math.atan2(ndx, -ndy) * 180 / Math.PI) + 360) % 360;
    const nBearing = COMPASS_DIRS[Math.round(ndeg / 22.5) % 16];
    const nDist = (Math.sqrt(ndx * ndx + ndy * ndy) * MILES_PER_TILE).toFixed(1);
    paragraphs.push(`Another clue can be found at nameless ruins ${nDist} mi to the ${nBearing} of your starting location.`);
  } else {
    paragraphs.push(capitalHint);
  }

  return paragraphs;
}

function showCluePopup(paragraphs: string[], onDismiss?: () => void): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.72);
    display: flex; align-items: center; justify-content: center;
    z-index: 2001; font-family: monospace;
  `;
  const box = document.createElement('div');
  box.style.cssText = `
    background: rgba(18,14,8,0.98);
    border: 1px solid rgba(200,168,80,0.3);
    border-radius: 10px; padding: 36px 48px;
    max-width: 480px; width: 100%;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  `;
  const icon = document.createElement('div');
  icon.textContent = '📜';
  icon.style.cssText = 'font-size: 28px;';
  box.appendChild(icon);
  for (const para of paragraphs) {
    const p = document.createElement('div');
    p.textContent = para;
    p.style.cssText = 'color: #d8c890; font-size: 13px; line-height: 1.7; text-align: center;';
    box.appendChild(p);
  }
  const btn = document.createElement('button');
  btn.textContent = 'Continue';
  btn.style.cssText = `
    background: rgba(40,40,40,0.9); border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px; color: #d0d0d0; font: 13px monospace;
    padding: 10px 28px; cursor: pointer; margin-top: 8px;
  `;
  const dismiss = () => { overlay.remove(); onDismiss?.(); };
  btn.addEventListener('click', dismiss);
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)'; btn.style.color = '#d0d0d0'; });
  box.appendChild(btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
}

function showRaceIntro(parties: RivalParty[]): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.88);
    display: flex; align-items: center; justify-content: center;
    z-index: 3000; font-family: monospace;
  `;
  const box = document.createElement('div');
  box.style.cssText = `
    background: rgba(14,10,4,0.98);
    border: 1px solid rgba(200,168,80,0.35);
    border-radius: 10px; padding: 40px 52px;
    max-width: 520px; width: 100%;
    display: flex; flex-direction: column; gap: 18px;
  `;
  const title = document.createElement('div');
  title.textContent = '⚑  The Race Begins';
  title.style.cssText = 'font-size: 20px; color: #c8a84a; letter-spacing: 0.06em; text-align: center;';
  const p1 = document.createElement('div');
  p1.textContent = 'The ancient ruins scattered across this continent are remnants of a civilization lost to time. Legend holds that their great capital still stands — a discovery that would make your name eternal.';
  p1.style.cssText = 'color: #c0b090; font-size: 13px; line-height: 1.8;';
  const p2 = document.createElement('div');
  p2.textContent = `Name ${RIVAL_TOTAL_RUINS} ruins to uncover the capital's location — and reach it before your rivals.`;
  p2.style.cssText = 'color: #c0b090; font-size: 13px; line-height: 1.8;';
  const rivalsDiv = document.createElement('div');
  rivalsDiv.style.cssText = 'display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-top: 1px solid rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.08);';
  const rivalsLabel = document.createElement('div');
  rivalsLabel.textContent = 'Your rivals:';
  rivalsLabel.style.cssText = 'color: #666; font-size: 11px; margin-bottom: 4px;';
  rivalsDiv.appendChild(rivalsLabel);
  for (const p of parties) {
    const row = document.createElement('div');
    row.textContent = `⚐  ${p.name}`;
    row.style.cssText = 'color: #a09070; font-size: 12px;';
    rivalsDiv.appendChild(row);
  }
  const btn = document.createElement('button');
  btn.textContent = 'Begin Expedition';
  btn.style.cssText = `
    background: rgba(40,40,40,0.9); border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px; color: #d0d0d0; font: 13px monospace;
    padding: 12px 32px; cursor: pointer; align-self: center;
  `;
  btn.addEventListener('click', () => overlay.remove());
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)'; btn.style.color = '#d0d0d0'; });
  box.append(title, p1, p2, rivalsDiv, btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

const quests = new QuestManager({
  onComplete: (q) => {
    if (q.type !== 'find_and_name') return;

    // Bearing from previous ruins → just-completed ruins, for forward chaining.
    const completedPin = mapPins.findById(q.data.pinId as string);
    const curX = completedPin?.tileX ?? lastRuinsTileX;
    const curY = completedPin?.tileY ?? lastRuinsTileY;
    const ddx = curX - prevRuinsTileX, ddy = curY - prevRuinsTileY;
    const forwardBearing = ((Math.atan2(ddx, -ddy) * 180 / Math.PI) + 360) % 360;

    prevRuinsTileX = curX;
    prevRuinsTileY = curY;

    const m = q.id.match(/^quest_ruins_(\d+)$/);
    const completedIndex = m ? parseInt(m[1]) : -1;

    let nextRuinsX: number | undefined;
    let nextRuinsY: number | undefined;

    if (completedIndex >= 0 && completedIndex < RIVAL_TOTAL_RUINS - 1) {
      // Place the next ruins quest immediately — not gated on screen dismissal.
      placeRuinsQuest(curX, curY, forwardBearing, ruinsQuestCount++);
      nextRuinsX = lastRuinsTileX;
      nextRuinsY = lastRuinsTileY;
    } else if (completedIndex === RIVAL_TOTAL_RUINS - 1) {
      // Final ruin — activate capital navigation.
      capitalUnlocked = true;
      if (stats.lodestone <= 0) stats.lodestone = 1;
      ruinsQuestCount++;
    }

    const clue = completedIndex >= 0
      ? buildCapitalClue(completedIndex, curX, curY, stats.lodestone > 0, nextRuinsX, nextRuinsY)
      : null;

    showQuestComplete(q, pendingCityName || completedPin?.name || 'the ruins', () => {
      if (clue) showCluePopup(clue);
    });
  },
});
const questPanel = createQuestPanel(
  quests,
  () => settlements.getAcceptedManEaterQuests(),
  () => stats.trophies.map(t => t.questId),
  () => {
    if (!capitalUnlocked) return null;
    const dx = capitalTileX - startTileX;
    const dy = capitalTileY - startTileY;
    const distanceMi = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
    const angleDeg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const bearing = COMPASS_DIRS[Math.round(angleDeg / 22.5) % 16];
    return { distanceMi, bearing };
  },
);
// Capture the name here — onComplete fires synchronously inside notify, so this
// is always the name that triggered the quest completion.
let pendingCityName = '';
mapPins.onRename = (pinId, newName) => {
  pendingCityName = newName;
  quests.notify("pin_renamed", { pinId, newName });
  // Keep visitedLocations in sync: update an existing entry's name, or add
  // a new entry for any user-placed pin (non-fixed).
  const pin = mapPins.findById(pinId);
  if (pin) {
    const existing = visitedLocations.find(v => v.tileX === pin.tileX && v.tileY === pin.tileY);
    if (existing) {
      existing.name = newName;
    } else if (!pin.fixed) {
      const type = pinId.startsWith('ruins_') ? 'ruins' : 'pin';
      visitedLocations.push({ name: newName, type, tileX: pin.tileX, tileY: pin.tileY });
    }
  }
};

// --- Persistence ---
let startTileX = Math.floor(player.tileX);
let startTileY = Math.floor(player.tileY);
const visitedLocations: { name: string; type: string; tileX: number; tileY: number }[] = [];

function doManualSave() {
  if (gameOver) return;
  saveManualGame(
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
    traps.getSaveData(),
    settlements.getManEaterQuestSaveData(),
    animals.getManEaterSaveData(),
    visitedLocations,
    { rivalParties, capitalUnlocked },
  );
  localStorage.setItem("lastSeed", currentSeed);
  showHudMessage("Game saved.");
}

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
    traps.getSaveData(),
    settlements.getManEaterQuestSaveData(),
    animals.getManEaterSaveData(),
    visitedLocations,
    { rivalParties, capitalUnlocked },
  );
  localStorage.setItem("lastSeed", currentSeed);
}

const saveRaw = loadGame();
const save = saveRaw?.seed === currentSeed ? saveRaw : null;
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
  if (save.mapPins !== undefined) {
    mapPins.restore(save.mapPins.map(p =>
      p.id.startsWith('ruins_') && p.name === 'Nameless ruins'
        ? { ...p, suggestName: randomRuinName }
        : p
    ));
  }
  if (save.quests !== undefined) quests.restore(save.quests);
  for (const t of save.traps ?? [])
    traps.restoreTrap(t.tileX, t.tileY, t.biome, t.ageHours ?? 0);
  if (save.manEaterQuests) settlements.restoreManEaterQuests(save.manEaterQuests);
  for (const m of save.activeManEaters ?? [])
    animals.restoreManEater(m);
  if (save.visitedLocations) visitedLocations.push(...save.visitedLocations);
  if (save.raceState?.rivalParties) {
    rivalParties = save.raceState.rivalParties.map(p => ({ ...p, restDaysRemaining: p.restDaysRemaining ?? 0 }));
    capitalUnlocked = save.raceState.capitalUnlocked ?? false;
  }
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
const debugPanel = createDebugPanel();

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
    fixed: true,
    dayPlaced: stats.daysTraveled,
    elevationFt: elevFt,
    biome: sbiome,
    distanceMiles: 0,
    bearing: "at start",
    notes: "",
  });
}

// Direction of the first ruins quest, captured below so the capital can be
// placed generally along the same heading (see "Capital tile" block) instead
// of an unrelated random direction that could require backtracking.
let firstRuinAngleRad = 0;

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

  const RUINS_MIN_MILES = 7.5 * 0.85;
  const RUINS_MAX_MILES = 7.5 * 1.15;
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
      firstRuinAngleRad = angle;
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
      suggestName: randomRuinName,
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

// --- Capital tile ---
// Seeded from world seed, ~250 miles from start (testing distance). Always deterministic.
{
  let capSeed = 0;
  for (let i = 0; i < currentSeed.length; i++)
    capSeed = (capSeed * 31 + currentSeed.charCodeAt(i) + 17) >>> 0;
  const capRng = () => {
    capSeed ^= capSeed << 13;
    capSeed ^= capSeed >>> 17;
    capSeed ^= capSeed << 5;
    return (capSeed >>> 0) / 0x100000000;
  };
  const CAPITAL_MIN_MILES = 215;
  const CAPITAL_MAX_MILES = 285;
  // Keep the capital within a wide cone of the ruins-chain's initial heading so
  // the ruins quests generally lead the player toward it instead of away from it.
  const CAPITAL_CONE_RAD = Math.PI / 3; // ±60°
  const WATER_BIOMES_CAP = new Set(["deep_water", "shallow_water"]);
  const capAngle = firstRuinAngleRad + (capRng() - 0.5) * 2 * CAPITAL_CONE_RAD;
  const capDist = (CAPITAL_MIN_MILES + capRng() * (CAPITAL_MAX_MILES - CAPITAL_MIN_MILES)) / MILES_PER_TILE;
  capitalTileX = Math.round(startTileX + Math.cos(capAngle) * capDist);
  capitalTileY = Math.round(startTileY + Math.sin(capAngle) * capDist);
  // Nudge off water if needed
  for (let attempt = 0; attempt < 200; attempt++) {
    const cb = getBiome(
      sampleElevation(capitalTileX, capitalTileY, elevation),
      sampleMoisture(capitalTileX, capitalTileY, moisture),
      sampleRiver(capitalTileX, capitalTileY, river),
      sampleLake(capitalTileX, capitalTileY, river),
    );
    if (!WATER_BIOMES_CAP.has(cb)) break;
    const a = firstRuinAngleRad + (capRng() - 0.5) * 2 * CAPITAL_CONE_RAD;
    capitalTileX = Math.round(startTileX + Math.cos(a) * capDist);
    capitalTileY = Math.round(startTileY + Math.sin(a) * capDist);
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
  // Distance grows with each quest (testing distances, halved): ~7.5, ~22.5, ~67.5, ~202.5 miles…
  const targetMiles  = 7.5 * Math.pow(3, questIndex - 1);
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
    suggestName: randomRuinName,
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

// --- Rival parties init ---
if (rivalParties.length === 0) {
  rivalParties = createRivalParties(currentSeed, startTileX, startTileY);
}
// Also derive capitalUnlocked from quest state in case it wasn't saved
if (!capitalUnlocked) {
  capitalUnlocked = quests.getAll().some(q => q.id === `quest_ruins_${RIVAL_TOTAL_RUINS - 1}` && q.status === 'complete');
}

// Wire news provider to trader menu (applies to both trader and village menus)
traders.setNewsProvider(() => rivalParties.map(p => getNewsReport(p, stats.daysTraveled)));

// Intro splash on fresh game
if (!save) {
  showRaceIntro(rivalParties);
}

// --- Ambient temperature ---
// °F at a tile, accounting for biome base temp, elevation, and time of day.
// Coldest at midnight, warmest at noon; higher elevation = colder.
function ambientTempAt(tx: number, ty: number): number {
  const elev = sampleElevation(tx, ty, elevation);
  const moist = sampleMoisture(tx, ty, moisture);
  const riverVal = sampleRiver(tx, ty, river);
  const lakeVal = sampleLake(tx, ty, river);
  const biome = getBiome(elev, moist, riverVal, lakeVal);
  return computeAmbientTemp(biome, elev, stats.daysTraveled % 1);
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

// Returns the nearest non-water tile to (tx, ty), scanning outward in Chebyshev rings.
function findNearestLandTile(tx: number, ty: number, maxRadius = 60): { tileX: number; tileY: number } {
  if (!isWaterBiome(tx, ty)) return { tileX: tx, tileY: ty };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) < r && Math.abs(dy) < r) continue; // only the border of this ring
        if (!isWaterBiome(tx + dx, ty + dy)) return { tileX: tx + dx, tileY: ty + dy };
      }
    }
  }
  return { tileX: tx, tileY: ty };
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
  // Deep water is impassable on foot regardless of waders.
  const b = getBiomeAt(tx, ty);
  if (b === 'deep_water') return false;
  // Hip waders extend shallow-water wading range to 3 tiles from shore; default is 1.
  const wadeRadius = stats.hipWaders > 0 ? 3 : 1;
  return canWadeShallowWater(wadeRadius, (ddx, ddy) => isWaterBiome(tx + ddx, ty + ddy));
}

// --- Player sprite overlay ---
const playerEl = document.createElement("img");
playerEl.src = playerFrontIdleUrl;
playerEl.style.cssText = `
  position: fixed;
  width: 24px;
  height: 24px;
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
  width: 50px;
  height: auto;
  image-rendering: pixelated;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 600;
  display: none;
`;
document.body.appendChild(canoeEl);

// --- Status indicators (above player head) ---
function makeIndicatorEl(emoji: string): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = emoji;
  el.style.cssText = `
    position: fixed;
    font-size: 14px;
    line-height: 1;
    transform: translate(-50%, -100%);
    pointer-events: none;
    z-index: 601;
    display: none;
  `;
  document.body.appendChild(el);
  return el;
}
const snowflakeEl    = makeIndicatorEl("❄️");
const mendingHeartEl = makeIndicatorEl("❤️‍🩹");
const energyLowEl   = makeIndicatorEl("⚡");
const hungerEl       = makeIndicatorEl("🍖");
const thirstEl       = makeIndicatorEl("💧");
const bleedingEl     = makeIndicatorEl("🩸");
const allIndicators  = [snowflakeEl, mendingHeartEl, energyLowEl, hungerEl, thirstEl, bleedingEl];

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
  // Horizon points below the player don't block — halve their weight so a
  // single tall nearby peak doesn't collapse the whole survey range.
  const advantage = Math.max(0, playerElev - horizonElev * 0.5);
  // Base scales with own elevation so higher ground is intrinsically better.
  // Cap at what fits within the survey chunk radius to avoid black edges.
  const maxPossible = SURVEY_CHUNK_RADIUS * CHUNK_WIDTH - 24;
  return Math.round(Math.min(24 + playerElev * 48 + advantage * 500, maxPossible) * visMult);
}

function enterSurvey() {
  forecastDepth = 2;
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
  stats.activeAction = null;
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
    gameOver = true; // prevent beforeunload from re-saving
    deleteSave();
    localStorage.removeItem("manualPaused");
    window.location.reload();
  });

  box.append(title, sub, btn);

  if (hasManualSave()) {
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Load save";
    loadBtn.style.cssText = `
      background: rgba(40,40,80,0.9);
      border: 1px solid rgba(120,120,200,0.4);
      border-radius: 6px;
      color: #a0a0e0;
      font: 13px monospace;
      padding: 10px 28px;
      cursor: pointer;
      margin-top: 10px;
      display: block;
      width: 100%;
    `;
    loadBtn.addEventListener("mouseenter", () => {
      loadBtn.style.background = "rgba(60,60,120,0.95)";
      loadBtn.style.color = "#d0d0ff";
    });
    loadBtn.addEventListener("mouseleave", () => {
      loadBtn.style.background = "rgba(40,40,80,0.9)";
      loadBtn.style.color = "#a0a0e0";
    });
    loadBtn.addEventListener("click", () => {
      const seed = promoteManualToAuto();
      localStorage.removeItem("manualPaused");
      if (seed) {
        const url = new URL(window.location.href);
        url.searchParams.set("seed", seed);
        window.location.href = url.toString();
      } else {
        window.location.reload();
      }
    });
    box.appendChild(loadBtn);
  }

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// --- Game loop ---
let lastTime = performance.now();
let prevInShelter = false;
let lastFacingDir: "up" | "down" | "left" | "right" = "down";
let lastCanoeDir: "left" | "right" = "right";

// --- Auto-walk ---
let autoWalkMode = false;
let autoWalkDx = 0;
let autoWalkDy = 0;
let prevWalkTileX = Math.floor(player.tileX);
let prevWalkTileY = Math.floor(player.tileY);
let cmdDownTime = 0;
const CMD_LONGPRESS_MS = 500;

function tick() {
  if (gameOver) return;
  requestAnimationFrame(tick);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  // Belt-and-suspenders: if the document has lost focus but the blur event
  // didn't fire (can happen when switching to a native app on some systems),
  // catch it here so the game never runs while the window is unfocused.
  if (!document.hasFocus() && !blurPaused) {
    blurPaused = true;
    updatePauseState();
  }
  // Pause the simulation while the radial menu is open or the game is paused.
  const isPaused = manualPaused || blurPaused;
  const effectiveDelta = isPaused || radialMenu.isOpen() || traders.isTradingPaused() ? 0 : delta;

  const tx = Math.floor(player.tileX);
  const ty = Math.floor(player.tileY);
  const tileElev   = sampleElevation(tx, ty, elevation);
  const tileMoist  = sampleMoisture(tx, ty, moisture);
  const tileRiver  = sampleRiver(tx, ty, river);
  const tileLake   = sampleLake(tx, ty, river);
  const currentBiome = getBiome(tileElev, tileMoist, tileRiver, tileLake);
  const biomeProps = BIOMES[currentBiome];
  const inWater =
    currentBiome === "deep_water" || currentBiome === "shallow_water";
  const usingCanoe = inWater && stats.canoes > 0;
  const carryingCanoe = !inWater && stats.canoes > 0;
  const inShelter = structures.playerInCompletedShelter(tx, ty) || stats.activeAction?.sheltered === true;
  if (inShelter && !prevInShelter) autoDropCanoe(tx, ty);
  prevInShelter = inShelter;
  const currentTemp = ambientTempAt(tx, ty);
  const currentWeather = weatherSystem.getCurrentEvent(stats.daysTraveled);
  const resolvedWeather = resolveWeatherForTemp(currentWeather, currentTemp);
  const weatherEffects = getWeatherEffects(resolvedWeather);
  // Low morale saps energy — small speed penalty below the "Weary" threshold.
  const moraleMult = stats.morale < 40 ? 0.85 : 1;
  const cramponsMult = stats.crampons > 0 && (currentBiome === 'mountains' || currentBiome === 'hills') ? 1.5 : 1;

  // Slope penalty: uphill land movement is slower and costs more energy.
  let slopeMult = 1;
  if (!inWater) {
    const moveDx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const moveDy = (input.down  ? 1 : 0) - (input.up   ? 1 : 0);
    if (moveDx !== 0 || moveDy !== 0) {
      const currElev = sampleElevation(tx, ty, elevation);
      const destElev = sampleElevation(tx + moveDx, ty + moveDy, elevation);
      const deltaElev = destElev - currElev;
      if (deltaElev > 0.002)
        slopeMult = Math.max(0.6, 1 - deltaElev * 50);
    }
  }

  const effectiveSpeed =
    (usingCanoe
      ? 1.5
      : biomeProps.speedMultiplier * (carryingCanoe ? 0.45 : 1)) *
    getWeightMultiplier(stats) *
    weatherEffects.moveMult *
    moraleMult *
    cramponsMult *
    slopeMult;

  // Canoeing is easy; portaging is exhausting; uphill drains extra energy.
  const slopeEnergyMult = inWater ? 1 : Math.max(1, 2 - slopeMult);
  const effectiveBiome = usingCanoe
    ? { ...biomeProps, energyDrainPerTile: 0.1 }
    : carryingCanoe
      ? { ...biomeProps, energyDrainPerTile: biomeProps.energyDrainPerTile * 2.75 * slopeEnergyMult }
      : slopeEnergyMult > 1
        ? { ...biomeProps, energyDrainPerTile: biomeProps.energyDrainPerTile * slopeEnergyMult }
        : biomeProps;

  // Debug panel update
  if (debugPanel.isVisible()) {
    const dbHomeDx = player.tileX - startTileX, dbHomeDy = player.tileY - startTileY;
    const dbDist = Math.sqrt(dbHomeDx * dbHomeDx + dbHomeDy * dbHomeDy) * MILES_PER_TILE;
    const dbElevFt = Math.max(0, Math.round((tileElev - 0.42) / (1.0 - 0.42) * 14400));
    const dbStepGrade = sampleElevation(player.stepTargetX, player.stepTargetY, elevation) - tileElev;
    debugPanel.update({
      tileX: tx, tileY: ty,
      visualX: player.visualX, visualY: player.visualY,
      distMiles: dbDist,
      biome: currentBiome,
      elevation: tileElev, elevationFt: dbElevFt,
      moisture: tileMoist, riverVal: tileRiver, lakeVal: tileLake,
      inWater, stepGrade: dbStepGrade,
      speedBiome: usingCanoe ? 1.5 : biomeProps.speedMultiplier,
      speedPortage: carryingCanoe ? 0.45 : 1,
      speedWeight: getWeightMultiplier(stats),
      speedWeather: weatherEffects.moveMult,
      speedMorale: moraleMult,
      speedCrampons: cramponsMult,
      speedSlope: slopeMult,
      speedNet: effectiveSpeed,
      tph: PLAYER_SPEED * effectiveSpeed * (SECONDS_PER_DAY / 24),
      usingCanoe, carryingCanoe, inShelter,
      bleeding: stats.bleeding,
      health: stats.health, energy: stats.energy,
      morale: stats.morale, warmth: stats.warmth,
      food: stats.food, water: stats.water,
      minerals: stats.minerals, canoes: stats.canoes,
      pelts: stats.pelts, rifleAmmo: stats.rifleAmmo, medicine: stats.medicine,
      daysTraveled: stats.daysTraveled,
      isDay: isDaylight(stats.daysTraveled),
      ambientTempF: currentTemp,
      currentWeather: currentWeather.type,
      resolvedWeather: resolvedWeather.type,
      weatherMoveMult: weatherEffects.moveMult,
      activeActionId: stats.activeAction?.id ?? null,
      actionProgressH: stats.activeAction ? stats.activeAction.progressDays * 24 : null,
      actionDurationH: stats.activeAction ? stats.activeAction.durationDays * 24 : null,
      seed: SEED,
    });
  }

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
    } else {
      // Drift camera back toward player when no keys held
      const returnSpeed = 1.5; // fraction of offset closed per second (~2s return
      const decay = 1 - returnSpeed * effectiveDelta;
      surveyOffsetX *= decay;
      surveyOffsetY *= decay;
      if (Math.abs(surveyOffsetX) < 0.01) surveyOffsetX = 0;
      if (Math.abs(surveyOffsetY) < 0.01) surveyOffsetY = 0;
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

  // Update auto-walk direction from the most recent completed tile step.
  const curWalkTileX = Math.floor(player.tileX);
  const curWalkTileY = Math.floor(player.tileY);
  if (curWalkTileX !== prevWalkTileX || curWalkTileY !== prevWalkTileY) {
    const vx = curWalkTileX - prevWalkTileX;
    const vy = curWalkTileY - prevWalkTileY;
    autoWalkDx = Math.abs(vx) >= Math.abs(vy) * 0.5 ? Math.sign(vx) : 0;
    autoWalkDy = Math.abs(vy) >= Math.abs(vx) * 0.5 ? Math.sign(vy) : 0;
    prevWalkTileX = curWalkTileX;
    prevWalkTileY = curWalkTileY;
  }

  const playerInput = isSurveying
    ? { up: false, down: false, left: false, right: false }
    : (autoWalkMode && (autoWalkDx !== 0 || autoWalkDy !== 0))
      ? { up: autoWalkDy < 0, down: autoWalkDy > 0, left: autoWalkDx < 0, right: autoWalkDx > 0 }
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
    // "rest" must be cancelled on movement too: village rest sets `sheltered: true`
    // on the action itself (not tied to actually standing in a shelter), which hides
    // the player sprite via `inShelter`. Nothing else stops the player from walking
    // away mid-rest, so without this the sprite stays invisible — on whatever tile
    // they wander onto — until the (fast-forwarded) rest naturally completes.
    if (id === "forage" || id === "harvest_timber" || id === "harvest_minerals" || id === "rest")
      stats.activeAction = null;
  }

  // Auto-pickup: collect a dropped canoe when walking onto its tile
  if (droppedCanoes.tryPickup(tx, ty)) stats.canoes++;

  // Check deadfall traps when the player steps onto their tile.
  // Skip tiles where a trap was just placed this step (player hasn't left yet).
  {
    const key = `${tx},${ty}`;
    if (freshTrapTiles.has(key)) {
      // Player is still standing on the tile where they just placed the trap — don't check it.
      // (It will be cleared once they move off.)
    } else {
      const result = traps.checkStep(tx, ty);
      if (result !== null) {
        if (result.caught) {
          stats.food  = Math.min(FOOD_CAPACITY_LBS, stats.food  + (result.meatLbs ?? 0));
          stats.pelts = (stats.pelts ?? 0) + (result.pelts ?? 0);
          showForageEmoji(result.emoji!);
          showHudMessage(`Trap caught a ${result.emoji}! +${result.meatLbs} lbs`);
        } else {
          showHudMessage('Trap was empty.');
        }
      }
    }
    // Clear any fresh-trap markers for tiles the player has left.
    for (const k of freshTrapTiles) {
      const [fx, fy] = k.split(',').map(Number);
      if (fx !== tx || fy !== ty) freshTrapTiles.delete(k);
    }
  }

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

  // Auto-resume: stepping onto an unfinished structure tile automatically restarts the build.
  if (!stats.activeAction && isDaylight(stats.daysTraveled)) {
    for (const type of ['canoe', 'shelter'] as const) {
      const idx = structures.findUnfinished(tx, ty, type);
      if (idx < 0) continue;
      const cfg = STRUCTURE_CONFIGS[type];
      const savedProgress = structures.getProgressDays(idx);
      if (savedProgress >= cfg.totalHours / 24) {
        structures.complete(idx, stats);
      } else {
        stats.activeAction = {
          id: `build_${type}` as 'build_canoe' | 'build_shelter',
          label: `Building ${cfg.label.toLowerCase()}`,
          durationDays: cfg.totalHours / 24 / (stats.tools > 0 ? 2 : 1),
          progressDays: savedProgress,
          structureIndex: idx,
          timberPerHour: cfg.timberCost / cfg.totalHours,
        };
      }
      break; // only resume one at a time
    }
  }

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
  const warming: "campfire" | "shelter" | false = stats.activeAction?.sheltered
    ? "shelter"
    : structures.isWarmed(tx, ty)
      ? inShelter
        ? "shelter"
        : "campfire"
      : false;
  // Heavy coat makes ambient temp feel 10°F warmer for warmth drain calculation.
  const effectiveTemp = currentTemp + (stats.heavyCoat > 0 ? 10 : 0);
  const { timeTicking, forageEvents } = updateStats(
    stats,
    effectiveDelta,
    tilesMoved,
    effectiveBiome,
    fishBiome,
    usingCanoe,
    effectiveTemp,
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


  // Particle animation advances a fixed step per call regardless of the delta
  // argument, so it must be skipped outright while paused rather than fed 0.
  if (!isPaused) {
    weatherOverlay.update(
      resolvedWeather,
      effectiveDelta / SECONDS_PER_DAY,
      inShelter,
    );
  }

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

  // Wound treatment complete.
  if (prevAction?.id === "treat_wound" && !stats.activeAction &&
      prevAction.progressDays >= prevAction.durationDays) {
    stats.bleeding = false;
    showHudMessage("Wound treated — bleeding stopped.");
  }

  // Auto-save when a rest completes (player woke at dawn).
  if (prevAction?.id === "rest" && !stats.activeAction &&
      prevAction.progressDays >= prevAction.durationDays) {
    doSave();
    showHudMessage("Game saved.");
  }

  // Deadfall trap placement: action completed → place trap at current tile.
  if (prevAction?.id === "build_deadfall" && !stats.activeAction &&
      prevAction.progressDays >= prevAction.durationDays) {
    traps.add(tx, ty, currentBiome);
    freshTrapTiles.add(`${tx},${ty}`);
    showHudMessage("Deadfall set. 🪤");
  }

  // Tracking result: find the nearest active man-eater and report direction.
  if (prevAction?.id === "track_maneater" && !stats.activeAction) {
    const activeHunts = settlements.getAcceptedManEaterQuests().filter(q => !q.completed);
    if (activeHunts.length > 0) {
      const livePositions = animals.getActiveManEaterPositions();
      let bestQuest = activeHunts[0];
      let bestX = bestQuest.spawnTileX;
      let bestY = bestQuest.spawnTileY;
      let bestDist = Infinity;
      let bestIsLive = false;
      for (const q of activeHunts) {
        const live = livePositions.find(m => m.questId === q.id);
        const qx = live ? live.tileX : q.spawnTileX;
        const qy = live ? live.tileY : q.spawnTileY;
        const d = Math.sqrt((qx - tx) ** 2 + (qy - ty) ** 2);
        if (d < bestDist) { bestDist = d; bestQuest = q; bestX = qx; bestY = qy; bestIsLive = !!live; }
      }
      // Add imprecision when animal hasn't spawned yet (tracks are older)
      if (!bestIsLive) {
        const noise = bestDist * 0.2;
        bestX += Math.round((Math.random() - 0.5) * 2 * noise);
        bestY += Math.round((Math.random() - 0.5) * 2 * noise);
      }
      const ddx = bestX - tx, ddy = bestY - ty;
      const miles = Math.sqrt(ddx * ddx + ddy * ddy) * MILES_PER_TILE;
      const deg = ((Math.atan2(ddx, -ddy) * 180 / Math.PI) + 360) % 360;
      const bearing = COMPASS_DIRS[Math.round(deg / 22.5) % 16];
      const freshness = bestIsLive ? "Fresh tracks" : "Old tracks";
      showHudMessage(`${freshness} — ${bestQuest.manEaterName} is ~${miles.toFixed(1)} mi ${bearing}`);
    }
  }

  // Campfire fuel consumption and trap checks share the same elapsed-time window.
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

    // Age deadfall traps.
    traps.advanceAge(gameDaysElapsed);
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

    // Advance rival parties for each day that passed
    const daysPassed = currentDay - lastKnownDay;
    const lostMsgs = tickRivalParties(rivalParties, daysPassed, capitalTileX, capitalTileY, MILES_PER_TILE);
    for (const msg of lostMsgs) {
      if (msg.startsWith('lost:')) {
        const partyName = msg.slice(5);
        activityLog.addEntry(`${partyName} has not been heard from in many weeks. Feared lost.`);
      } else if (msg.startsWith('resting:')) {
        const partyName = msg.slice(8);
        activityLog.addEntry(`${partyName} is reported to have made camp — building a canoe or tending to the injured.`);
      }
    }

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
    getSeasonLabel(stats.daysTraveled),
  );
  updateNightOverlay(stats.daysTraveled);
  tileInspector.update();
  structures.update();
  droppedCanoes.update();
  timberPiles.update();
  traps.update();
  ruinSprites.update();
  settlements.discover(tx, ty, startTileX, startTileY);

  // Track visited locations (within 5 tiles of a settlement center).
  for (const site of settlements.getSites()) {
    const alreadyVisited = visitedLocations.some(v => v.tileX === site.centerTileX && v.tileY === site.centerTileY);
    if (!alreadyVisited) {
      const dist = Math.max(Math.abs(site.centerTileX - tx), Math.abs(site.centerTileY - ty));
      if (dist <= 5) visitedLocations.push({ name: site.name, type: site.type, tileX: site.centerTileX, tileY: site.centerTileY });
    }
  }
  // Track visited ruins (within 5 tiles of ruins pin center).
  for (const pin of mapPins.getAll()) {
    if (!pin.id.startsWith('ruins_')) continue;
    const alreadyVisited = visitedLocations.some(v => v.tileX === pin.tileX && v.tileY === pin.tileY);
    if (!alreadyVisited) {
      const dist = Math.max(Math.abs(pin.tileX - tx), Math.abs(pin.tileY - ty));
      if (dist <= 5) visitedLocations.push({ name: pin.name, type: 'ruins', tileX: pin.tileX, tileY: pin.tileY });
    }
  }
  hud.updateVisited(visitedLocations, tx, ty);
  settlements.update(
    effectiveDelta, tx, ty,
    (site) => {
      const vdx = site.centerTileX - startTileX, vdy = site.centerTileY - startTileY;
      const vMiles = Math.sqrt(vdx * vdx + vdy * vdy) * MILES_PER_TILE;
      traders.openVillageMenu(site.name, site.id, stats, vMiles);
    },
    (site) => {
      const frac = stats.daysTraveled % 1;
      const morning = 6 / 24;
      const toNextDawn = frac < morning ? morning - frac : 1 + morning - frac;
      const durationDays = toNextDawn < 2 / 24 ? toNextDawn + 1 : toNextDawn;
      stats.activeAction = {
        id: 'rest',
        label: `Resting in ${site.name}`,
        durationDays,
        progressDays: 0,
        energyMultiplier: 8,
        sheltered: true,
      };
    },
    traders.isTradingPaused(),
    // Quest callbacks
    (quest) => {
      // Accept a man-eater quest: record day, spawn the animal
      quest.acceptedDay = stats.daysTraveled;
      quest.spawned = true;
      const spawnLand = findNearestLandTile(quest.spawnTileX, quest.spawnTileY);
      animals.addManEater(quest.animalName, spawnLand.tileX, spawnLand.tileY, quest.id, quest.manEaterName);
      // Place a vague map pin (centered on a 20-tile uncertainty circle)
      const pinTileX = quest.spawnTileX + Math.round((Math.random() * 2 - 1) * 20);
      const pinTileY = quest.spawnTileY + Math.round((Math.random() * 2 - 1) * 20);
      const dx2 = pinTileX - startTileX, dy2 = pinTileY - startTileY;
      const distMiles = Math.sqrt(dx2*dx2 + dy2*dy2) * MILES_PER_TILE;
      mapPins.add({
        id: `maneater_pin_${quest.id}`,
        tileX: pinTileX, tileY: pinTileY,
        name: `${quest.manEaterName}?`,
        color: '#cc4444',
        fixed: true,
        dayPlaced: stats.daysTraveled,
        elevationFt: 0,
        biome: quest.biome,
        distanceMiles: distMiles,
        bearing: '',
        notes: `Reported ${quest.animalName.toLowerCase()} — may not be exact`,
      });
      const qdx = quest.spawnTileX - player.tileX, qdy = quest.spawnTileY - player.tileY;
      const qMiles = Math.round(Math.sqrt(qdx*qdx + qdy*qdy) * MILES_PER_TILE);
      const qDeg = ((Math.atan2(qdx, -qdy) * 180 / Math.PI) + 360) % 360;
      const qDirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
      const qBearing = qDirs[Math.round(qDeg / 22.5) % 16];
      const expireDay = Math.floor(stats.daysTraveled) + MANEATER_QUEST_EXPIRE_DAYS + 1;
      showHudMessage(`Quest accepted: Hunt ${quest.manEaterName} — last seen ~${qMiles} mi ${qBearing}. Expires Day ${expireDay}. Location marked on map.`, 8000);
    },
    (questId, pelts) => {
      // Claim reward
      const idx = stats.trophies.findIndex(t => t.questId === questId);
      if (idx !== -1) stats.trophies.splice(idx, 1);
      stats.pelts += pelts;
      showHudMessage(`Reward claimed: +${pelts} pelts`);
    },
    stats.trophies,
    stats.daysTraveled,
    () => traders.showNews(),
  );
  const homeDx = player.tileX - startTileX, homeDy = player.tileY - startTileY;
  const milesFromStart = Math.sqrt(homeDx * homeDx + homeDy * homeDy) * MILES_PER_TILE;
  traders.update(effectiveDelta, player.visualX, player.visualY, stats, milesFromStart);
  const animalAttacks = animals.update(
    effectiveDelta,
    player.visualX,
    player.visualY,
    stats.daysTraveled,
    playerMoving,
  );
  for (const atk of animalAttacks) {
    stats.health = Math.max(0, stats.health - atk.damage);
    stats.bleeding = true;
    showHudMessage(`You've been attacked! -${atk.damage} health — you are bleeding`);
  }
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
    const cr = renderer.domElement.getBoundingClientRect();
    const spriteScale = cr.width / CANVAS_WIDTH;
    const playerPx = Math.round(24 * spriteScale);
    const canoePx  = Math.round(50 * spriteScale);
    if (usingCanoe) {
      canoeEl.style.left  = `${pos.x}px`;
      canoeEl.style.top   = `${pos.y}px`;
      canoeEl.style.width = `${canoePx}px`;
    } else {
      playerEl.style.left   = `${pos.x}px`;
      playerEl.style.top    = `${pos.y}px`;
      playerEl.style.width  = `${playerPx}px`;
      playerEl.style.height = `${playerPx}px`;
    }
    // Status indicators above the player sprite — centered row, spaced 16px apart.
    const activeIndicators: HTMLDivElement[] = [];
    if (stats.warmth < 50)  activeIndicators.push(snowflakeEl);
    if (stats.health < 50)  activeIndicators.push(mendingHeartEl);
    if (stats.energy < 10)  activeIndicators.push(energyLowEl);
    if (stats.food === 0)   activeIndicators.push(hungerEl);
    if (stats.water === 0)  activeIndicators.push(thirstEl);
    if (stats.bleeding)     activeIndicators.push(bleedingEl);

    allIndicators.forEach(el => (el.style.display = "none"));
    if (activeIndicators.length > 0) {
      const spacing = 16;
      const totalW  = (activeIndicators.length - 1) * spacing;
      const startX  = pos.x - totalW / 2;
      const indicatorY = pos.y - 16;
      activeIndicators.forEach((el, i) => {
        el.style.display = "block";
        el.style.left    = `${startX + i * spacing}px`;
        el.style.top     = `${indicatorY}px`;
      });
    }
  }

  // Hunting reticle wobble: amplitude scales with distance, settles after ~1.5s of stillness.
  // Skipped entirely while paused — the reticle also re-centers on the live mouse
  // position each call, so feeding it a frozen delta alone isn't enough to stop it.
  if (huntingMode && !isPaused) {
    const fromPos = getPlayerScreenPos();
    const mPos = huntingOverlay.getMouseScreenPos();
    const distPx = Math.sqrt((mPos.x - fromPos.x) ** 2 + (mPos.y - fromPos.y) ** 2);
    const wobbleAmp = distPx * (stats.precisionRifle > 0 ? 0.05 * 0.75 : 0.05);
    huntingOverlay.update(effectiveDelta, wobbleAmp);
  }

  renderer.render(scene, camera);
}

updatePauseState(); // restore overlay if manualPaused was persisted
tick();
