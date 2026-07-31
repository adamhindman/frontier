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
import { getBiome, BIOMES, BiomeProperties, type Biome } from "./biomes";
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
import { SettlementManager, isNearSettlementSite } from "./settlements";
import { TraderManager } from "./traders";
import { MANEATER_QUEST_EXPIRE_DAYS } from "./manEaterQuests";
import { createDebugPanel } from "./debugPanel";
import { PLAYER_SPEED } from "./constants";
import { computeAmbientTemp, canWadeShallowWater, createWorldQueries, formatApproxLocation, formatApproxLocationCompact, formatElapsedGameTime, COMPASS_DIRS } from "./worldQueries";
import { createRivalParties, tickRivalParties, getNewsReport, RIVAL_TOTAL_RUINS, CAPITAL_LEG_MILES as RIVAL_CAPITAL_LEG_MILES } from "./rivalParties";
import type { RivalParty } from "./rivalParties";
import { RivalSpriteManager } from "./rivalSprites";
import { RobotCompanionManager } from "./robotCompanion";
import { CloudManager } from "./clouds";
import { ARTIFACTS, type ArtifactDef } from "./artifacts";

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
              const bearing = approxBearingText(miles, angleDeg);
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
    // The Worklight Lantern, while lit, lets Build/Harvest/Survey/Track proceed at night.
    const canWorkAtNight = daylight || stats.worklightOn;
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
    const campfireBuildDays = computeCampfireBuildDays(ptx, pty);

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
          beginRest(ptx, pty, duration, inShelter, true);
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
                !canWorkAtNight ||
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
                !canWorkAtNight ||
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
              disabled: !canWorkAtNight || onWater,
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
        disabled: !canWorkAtNight || onWater || !settlements.getAcceptedManEaterQuests().some(q => !q.completed),
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
        label: "Harvest Timber",
        disabled: !canWorkAtNight || aboveTreeline || inShelter || onWater,
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
      {
        label: "Rest (2 hrs)",
        hotkey: "A",
        disabled: onWater || aboveTreeline,
        action: () => {
          const duration = 2 / 24;
          beginRest(ptx, pty, duration, inShelter, false);
        },
      },
      {
        // Not gated by canWorkAtNight, unlike the Build submenu's items — a
        // campfire is often exactly what you'd want to build after dark.
        label: "Campfire",
        hotkey: "C",
        disabled: onWater || aboveTreeline || inShelter || campfireBuildDays === null,
        action: () => {
          const started = startCampfireBuild(ptx, pty, computeCampfireBurnHours());
          if (!started) hud.flash("Not enough timber here to start a fire.");
        },
      },
    ];
  },
  () => stats.activeAction?.id === "survey",
  () => input.reset(),
);
const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
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
    if (autoWalkMode) {
      autoWalkMode = false;
      autoWalkDx = 0;
      autoWalkDy = 0;
      hud.flash("Auto-walk off");
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
  // Action hotkeys (number badges and lettered shortcuts like "C" for
  // Campfire) work without the radial menu being open at all — same numbering
  // as if you'd just pressed Space, evaluated fresh against the player's
  // current tile. Guarded by the same conditions that gate opening the menu
  // in the first place (trading/hunting/survey/already-open).
  if (
    !e.defaultPrevented &&
    !radialMenu.isOpen() &&
    !huntingMode &&
    stats.activeAction?.id !== "survey" &&
    !traders.isTradingPaused()
  ) {
    if (radialMenu.activateHotkey(Math.floor(player.tileX), Math.floor(player.tileY), e.key)) {
      e.preventDefault();
    }
  }
  if (e.key === "Meta") {
    if (!e.repeat) {
      cmdSequenceClean = true;
      // If one or more arrow keys are already held down when Cmd is pressed,
      // (re)point auto-walk at those held directions — engaging it fresh if it
      // wasn't already on, or redirecting it if it was. The player shouldn't
      // have to release and re-press the arrow after Cmd goes down.
      if (input.up || input.down || input.left || input.right) {
        autoWalkMode = true;
        autoWalkDx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        autoWalkDy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        hud.flash("Auto-walk on");
      } else if (autoWalkMode) {
        // Cmd pressed alone (no arrow currently held) cancels auto-walk outright —
        // a plain "stop" gesture that doesn't require aiming an opposite direction.
        autoWalkMode = false;
        autoWalkDx = 0;
        autoWalkDy = 0;
        hud.flash("Auto-walk off");
      }
    }
  } else if (!ARROW_KEYS.includes(e.key)) {
    // Any non-arrow key pressed while Cmd is held breaks the "clean" combo —
    // a Cmd+Arrow press later in this same hold won't engage auto-walk.
    cmdSequenceClean = false;
  }
  // Cmd + one or more arrow keys (with no other key pressed since Cmd went down)
  // engages auto-walk immediately, using whichever arrow keys are currently
  // held for direction. Once auto-walk is already active, Cmd+Arrow always
  // redirects it to the newly-held direction instead — the "clean combo" gate
  // only matters for engaging fresh, not for redirecting.
  if (e.metaKey && !e.repeat && ARROW_KEYS.includes(e.key) && (autoWalkMode || cmdSequenceClean)) {
    autoWalkMode = true;
    autoWalkDx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    autoWalkDy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    hud.flash("Auto-walk on");
  }
  // While auto-walking, any arrow key(s) currently held (without Cmd) act as a
  // temporary manual override — see the playerInput computation in tick(),
  // which uses raw input directly whenever any arrow is held and only falls
  // back to the auto-walk heading once none are. There's no separate
  // "opposite direction cancels" gesture here (that was tried and repeatedly
  // broke in ways that were confusing to use) — to actually cancel auto-walk,
  // press Escape or Cmd with no arrow currently held (see above).
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
  if (e.key === "Meta") {
    cmdSequenceClean = false;
    // macOS/Chrome quirk: releasing an arrow key while Cmd is still held down
    // often never fires a keyup for that arrow key at all — the OS swallows
    // it. Left unhandled, that arrow's input flag gets stuck "true" forever,
    // so every later lone Cmd press sees "an arrow is held" and redirects
    // auto-walk instead of cancelling it, even though nothing is physically
    // pressed anymore. Releasing Cmd is a natural checkpoint to clear that
    // stuck state out. Tradeoff: if an arrow key genuinely is still held the
    // instant Cmd comes up, this drops it too (no new keydown will arrive to
    // restore it since it was never released) — at worst that's one key that
    // needs re-pressing to resume a temporary strafe override, far cheaper
    // than auto-walk being permanently impossible to cancel.
    input.reset();
  }
});

// Hunting click: fire rifle toward the clicked tile direction.
renderer.domElement.addEventListener("click", (e) => {
  if (manualPaused || blurPaused) return;
  if (!huntingMode) return;
  if (reloadRemaining > 0) return;
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
  // Holding the cursor steady before firing simulates careful aim — the
  // longer it's been still (see HuntingOverlay.getAimSteadiness, tracked off
  // the raw unwobbled cursor), the less baked-in inaccuracy the shot gets.
  // Never reaches zero — even a perfectly settled aim has some human error.
  const AIM_MIN_JITTER_FACTOR = 0.3;
  const steadiness = huntingOverlay.getAimSteadiness();
  const jitterFactor = 1 - steadiness * (1 - AIM_MIN_JITTER_FACTOR);
  const jitterDeg = (precision ? 0.25 : 2) * jitterFactor;
  const jitter = (Math.random() * 2 - 1) * (jitterDeg * Math.PI / 180);
  const cosJ = Math.cos(jitter), sinJ = Math.sin(jitter);
  const ndx = baseNdx * cosJ - baseNdy * sinJ;
  const ndy = baseNdx * sinJ + baseNdy * cosJ;

  const rifleRange = RIFLE_RANGE + (precision ? 2 : 0);
  const result = animals.fireRay(player.visualX, player.visualY, ndx, ndy, rifleRange);
  animals.scareAll(player.tileX, player.tileY);
  stats.rifleAmmo--;
  reloadDuration = precision ? 0.5 : 1;
  reloadRemaining = reloadDuration;
  // Recoil breaks the steady aim — reloading requires resettling before the
  // next shot gets the accuracy benefit again.
  huntingOverlay.resetSteadiness();

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
  (clientX, clientY) => robotCompanion.isNear(clientX, clientY) || rivalSprites.isNear(clientX, clientY),
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
  cmdSequenceClean = false;
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

// --- Worklight lantern overlay ---
// A reddish glow centered on the player that burns through the night overlay
// above it. Positioned at the player's actual on-screen position (not the
// viewport center — those differ once the letterboxed canvas isn't exactly
// the same aspect ratio as the window) with a smooth, continuous falloff
// approximating an inverse-square light falloff rather than a flat-bright
// disc with a hard edge.
const WORKLIGHT_RADIUS_TILES = 4.5;
const WORKLIGHT_PEAK_ALPHA = 0.32;
// [fraction of radius, alpha as a fraction of peak] — roughly inverse-square.
const WORKLIGHT_FALLOFF_STOPS: [number, number][] = [
  [0,    1.00],
  [0.2,  0.70],
  [0.4,  0.42],
  [0.65, 0.20],
  [1,    0],
];
const worklightOverlay = document.createElement("div");
worklightOverlay.style.cssText = `
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 502;
  opacity: 0;
  mix-blend-mode: screen;
`;
document.body.appendChild(worklightOverlay);

function updateWorklightOverlay() {
  if (!stats.worklightOn) {
    worklightOverlay.style.opacity = "0";
    return;
  }
  const r = renderer.domElement.getBoundingClientRect();
  const ea = r.width / r.height, ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  const contentW = ea > ca ? r.height * ca : r.width;
  const scale = contentW / CANVAS_WIDTH;
  const radiusPx = WORKLIGHT_RADIUS_TILES * TILE_SIZE * scale;
  const { x, y } = getPlayerScreenPos();
  const gradientStops = WORKLIGHT_FALLOFF_STOPS
    .map(([t, a]) => `rgba(255,60,30,${(a * WORKLIGHT_PEAK_ALPHA).toFixed(3)}) ${(t * radiusPx).toFixed(1)}px`)
    .join(", ");
  worklightOverlay.style.background = `radial-gradient(circle at ${x}px ${y}px, ${gradientStops})`;
  worklightOverlay.style.opacity = "1";
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
    // Nameless ruin pins are placed by the quest system with id "ruins_N" and
    // name "Nameless ruins". They exist at the target tile even before the player
    // has visited the area, unlike ruin footprint sprites which are scattered on arrival.
    const clue = nearestRuinOrCapitalClue(player.tileX, player.tileY, false);
    hud.flash(clue ? `Lodestone: ${clue}` : "The lodestone is still.");
  },
  () => {
    if (stats.shriekingCoil <= 0) return;
    const affected = animals.frightenAll(player.tileX, player.tileY);
    hud.flash(affected > 0
      ? `The coil shrieks — ${affected} creature${affected === 1 ? '' : 's'} flee.`
      : "The coil shrieks, but nothing responds.");
  },
  () => {
    if (stats.worklightLantern <= 0) return;
    stats.worklightOn = !stats.worklightOn;
    hud.flash(stats.worklightOn
      ? "The worklight lantern glows red — nearby predators will come looking."
      : "The lantern goes dark.");
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
// Reload cooldown after firing — basic musket 1s, advanced (precisionRifle) 0.5s.
// In real seconds, paused-aware (see effectiveDelta), not accelerated game time.
let reloadRemaining = 0;
let reloadDuration = 0;
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
const clouds = new CloudManager(renderer.domElement, camera);
// A rival is only ever able to *name* the capital pin via claimPin(), which
// sets fixed: true — a player rename never does. So pin.fixed is a clean
// signal for "some rival won the naming race overall," independent of which
// specific standee the player happens to click.
const rivalSprites = new RivalSpriteManager(renderer.domElement, camera, () => {
  const capitalPin = mapPins.findById('capital');
  return capitalPin ? capitalPin.fixed === true : true;
});
const settlements = new SettlementManager(renderer.domElement, camera, elevation, moisture, river, currentSeed, mapPins);
const traders = new TraderManager(renderer.domElement, camera, elevation, moisture, river);
const robotCompanion = new RobotCompanionManager(
  renderer.domElement,
  camera,
  FOOD_CAPACITY_LBS / 2,
  WATER_CAPACITY_GAL / 2,
  (food, water) => {
    stats.food = Math.min(FOOD_CAPACITY_LBS, stats.food + food);
    stats.water = Math.min(WATER_CAPACITY_GAL, stats.water + water);
    showHudMessage(`Robot's haul collected: +${food.toFixed(1)} lbs food, +${water.toFixed(1)} gal water`);
  },
  () => manualPaused || blurPaused || radialMenu.isOpen() || huntingMode || stats.activeAction?.id === 'survey',
);

// Every distance+bearing location clue in the game (ruins, capital, man-eater
// tracks, named survey pins, the lodestone) goes through here so they all read
// as an estimate rather than precise surveying data.
function approxBearingText(miles: number, bearingDeg: number): string {
  return miles < 0.1 ? "at start" : formatApproxLocation(miles, bearingDeg);
}

// Quest log entries (ruins/capital "find and name" descriptions) use the same
// compact style as the Location Display (see formatApproxLocationCompact),
// just without an elapsed-time suffix — these clues aren't tied to a survey.
function approxBearingCompactText(miles: number, bearingDeg: number): string {
  return miles < 0.1 ? "at start" : formatApproxLocationCompact(miles, bearingDeg);
}

// approxBearingText leads with a capitalized "About" (sentence-start style);
// mid-sentence uses like "Ruins are ..." read better with it lowercased.
function lowerLeadingAbout(text: string): string {
  return text.startsWith("About ") ? `about ${text.slice(6)}` : text;
}

// Deterministic pseudo-random value in [0,1) from an integer seed — a common
// shader-style hash, not cryptographic, just stable and well-mixed enough
// that nearby seeds don't produce visibly-correlated outputs.
function pseudoRandom01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

// A survey fix's bearing gets randomly jittered, more so the farther away the
// target is — a compass wedge (22.5°) is only ~4 miles wide at 10 miles out
// but ~390 miles wide at 1000, so an exact bearing at long range would be an
// unrealistic freebie, while telling the player nothing at all (the old hard
// cutoff) left a huge dead zone of pure guessing. Capped at 55° so even a very
// distant fix still narrows things down to "roughly that side of the map"
// rather than being useless, and floored at 5° so it doesn't read as fake
// precision once you're close enough that the real fix would be tight anyway.
const SURVEY_JITTER_MIN_DEG = 5;
const SURVEY_JITTER_MAX_DEG = 55;
const SURVEY_JITTER_MILES_TO_DEG = 0.08;
// Prominence (see computeElevationAdvantage/SURVEY_FIX_MIN_PROMINENCE) also
// tightens the reading, ceteris paribus — the higher you stand above your
// surroundings, the better the fix, up to a point. PROMINENCE_MAX_BENEFIT is
// the advantage value at which this bonus maxes out (well above the bare
// SURVEY_FIX_MIN_PROMINENCE needed to get a fix at all); PROMINENCE_MIN_FACTOR
// is the floor — even a towering vantage doesn't fully eliminate the jitter,
// distance still matters.
const PROMINENCE_MAX_BENEFIT = 0.20;
const PROMINENCE_MIN_FACTOR = 0.4;

// Seeded by the player's (bucketed) position and the target's location, so
// re-surveying from about the same spot gives the same reading (can't just
// spam-survey and average away the noise) but the reading shifts once you've
// actually traveled somewhere new.
function jitteredBearingDeg(trueDeg: number, miles: number, prominence: number, fromTileX: number, fromTileY: number, targetTileX: number, targetTileY: number): number {
  const baseJitterDeg = Math.min(SURVEY_JITTER_MAX_DEG, Math.max(SURVEY_JITTER_MIN_DEG, miles * SURVEY_JITTER_MILES_TO_DEG));
  const prominenceT = Math.min(1, Math.max(0,
    (prominence - SURVEY_FIX_MIN_PROMINENCE) / (PROMINENCE_MAX_BENEFIT - SURVEY_FIX_MIN_PROMINENCE)));
  const prominenceFactor = 1 - prominenceT * (1 - PROMINENCE_MIN_FACTOR);
  const jitterDeg = baseJitterDeg * prominenceFactor;
  const BUCKET_TILES = 20; // ~1 mile — stable across small movements, shifts once you've actually gone somewhere
  const bx = Math.round(fromTileX / BUCKET_TILES);
  const by = Math.round(fromTileY / BUCKET_TILES);
  const seed = bx * 374761393 + by * 668265263 + targetTileX * 2654435761 + targetTileY * 2246822519;
  const rand = pseudoRandom01(seed) * 2 - 1; // [-1, 1)
  return trueDeg + rand * jitterDeg;
}

// Shared by the lodestone and the on-survey fix: the nearest known
// destination — the capital once unlocked, otherwise the nearest nameless
// ruin pin — as an approximate bearing/distance from the given tile. Returns
// null if there's nothing to report yet (no ruins revealed). The lodestone
// (jitter=false) is always exactly accurate at any distance — that's its
// whole advantage, and what it costs pelts for. Survey (jitter=true) instead
// always gives a reading, but a distance-scaled random one (see
// jitteredBearingDeg) rather than a hard range cutoff.
function nearestRuinOrCapitalClue(fromTileX: number, fromTileY: number, jitter: boolean, prominence = 0): string | null {
  if (capitalUnlocked) {
    const dx = capitalTileX - fromTileX, dy = capitalTileY - fromTileY;
    const trueDeg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
    const miles = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
    const deg = jitter ? jitteredBearingDeg(trueDeg, miles, prominence, fromTileX, fromTileY, capitalTileX, capitalTileY) : trueDeg;
    return `Capital is ${lowerLeadingAbout(approxBearingText(miles, deg))}`;
  }
  const pins = mapPins.getAll();
  let bestDist = Infinity, bestTileX = 0, bestTileY = 0, found = false;
  for (const p of pins) {
    if (!p.id.startsWith("ruins_") || p.name !== "Nameless ruins") continue;
    const dx = p.tileX - fromTileX, dy = p.tileY - fromTileY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) { bestDist = dist; bestTileX = p.tileX; bestTileY = p.tileY; found = true; }
  }
  if (!found) return null;
  const dx = bestTileX - fromTileX, dy = bestTileY - fromTileY;
  const trueDeg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
  const miles = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
  const deg = jitter ? jitteredBearingDeg(trueDeg, miles, prominence, fromTileX, fromTileY, bestTileX, bestTileY) : trueDeg;
  return `Ruins are ${lowerLeadingAbout(approxBearingText(miles, deg))}`;
}

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
    capitalHint = `The capital lies ${formatApproxLocation(distMi, deg)}.`;
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
    const nDist = Math.sqrt(ndx * ndx + ndy * ndy) * MILES_PER_TILE;
    paragraphs.push(`Another clue can be found at nameless ruins ${formatApproxLocation(nDist, ndeg)} of your starting location.`);
  } else {
    paragraphs.push(capitalHint);
  }

  return paragraphs;
}

// Finds a non-water tile within CONE_HALF_DEG of forwardBearingDeg, at a
// distance randomized around targetMiles (±15%) — shared by the up-front
// ruins-chain computation and (via an injected rng) reused deterministically
// there. bearingDeg follows the same "compass degrees, 0=north" convention as
// the rest of the ruins/capital placement code: sin(rad) → tileX offset,
// -cos(rad) → tileY offset.
function findRuinsTileInCone(
  fromTileX: number,
  fromTileY: number,
  forwardBearingDeg: number,
  targetMiles: number,
  rng: () => number,
): { tileX: number; tileY: number } {
  const RUINS_MIN_MILES = targetMiles * 0.85;
  const RUINS_MAX_MILES = targetMiles * 1.15;
  const CONE_HALF_DEG = 30;
  const WATER_BIOMES = new Set(['deep_water', 'shallow_water']);

  let rtx = fromTileX, rty = fromTileY;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const bearingDeg = forwardBearingDeg + (rng() * CONE_HALF_DEG * 2 - CONE_HALF_DEG);
    const bearingRad = (bearingDeg * Math.PI) / 180;
    const dist = (RUINS_MIN_MILES + rng() * (RUINS_MAX_MILES - RUINS_MIN_MILES)) / MILES_PER_TILE;
    const cx = Math.round(fromTileX + Math.sin(bearingRad) * dist);
    const cy = Math.round(fromTileY - Math.cos(bearingRad) * dist);
    const re = sampleElevation(cx, cy, elevation);
    const rm = sampleMoisture(cx, cy, moisture);
    const rr = sampleRiver(cx, cy, river);
    const rl = sampleLake(cx, cy, river);
    if (!WATER_BIOMES.has(getBiome(re, rm, rr, rl))) { rtx = cx; rty = cy; break; }
  }
  return { tileX: rtx, tileY: rty };
}

// Freezes the simulation (see effectiveDelta in tick()) while any full-screen
// modal — quest complete, artifact reveal, clue, race intro — is open. A
// counter rather than a boolean since these can chain (e.g. clue -> artifact
// popup fires from the quest-complete screen's own dismiss callback).
let modalOpenCount = 0;

function showCluePopup(paragraphs: string[], onDismiss?: () => void): void {
  modalOpenCount++;
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
  const dismiss = () => { modalOpenCount--; overlay.remove(); onDismiss?.(); };
  btn.addEventListener('click', dismiss);
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)'; btn.style.color = '#d0d0d0'; });
  box.appendChild(btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
}

function showRaceIntro(parties: RivalParty[]): void {
  modalOpenCount++;
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
  btn.addEventListener('click', () => { modalOpenCount--; overlay.remove(); });
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)'; btn.style.color = '#d0d0d0'; });
  box.append(title, p1, p2, rivalsDiv, btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// Rolls one artifact the player doesn't already own and applies its effect.
// Returns null (no reward) once every artifact in the registry is owned.
function awardRandomArtifact() {
  const owned = new Set(stats.artifacts);
  const available = ARTIFACTS.filter(a => !owned.has(a.id));
  if (available.length === 0) return null;
  const picked = available[Math.floor(Math.random() * available.length)];
  stats.artifacts.push(picked.id);
  if (picked.id === 'robot_companion') {
    robotCompanion.grant(Math.floor(player.tileX), Math.floor(player.tileY));
  } else if (picked.id === 'shrieking_coil') {
    stats.shriekingCoil = 1;
  } else if (picked.id === 'night_boots') {
    stats.nightBoots = 1;
  } else if (picked.id === 'worklight_lantern') {
    stats.worklightLantern = 1;
  }
  return picked;
}

const quests = new QuestManager({
  onComplete: (q) => {
    if (q.type !== 'find_and_name') return;

    const completedPin = mapPins.findById(q.data.pinId as string);
    const curX = completedPin?.tileX ?? lastRuinsTileX;
    const curY = completedPin?.tileY ?? lastRuinsTileY;

    const m = q.id.match(/^quest_ruins_(\d+)$/);
    const completedIndex = m ? parseInt(m[1]) : -1;

    let nextRuinsX: number | undefined;
    let nextRuinsY: number | undefined;

    if (completedIndex >= 0 && completedIndex < RIVAL_TOTAL_RUINS - 1) {
      // Reveal the next ruins quest immediately — not gated on screen
      // dismissal. Its location was already computed up front (see
      // ruinsChainTiles), so this just surfaces it; no rolling here.
      const next = ruinsChainTiles[ruinsQuestCount];
      revealRuinsQuest(next.tileX, next.tileY, ruinsQuestCount++);
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
    const artifact = completedIndex >= 0 ? awardRandomArtifact() : null;

    showQuestComplete(q, pendingCityName || completedPin?.name || 'the ruins', () => {
      const revealArtifact = () => { if (artifact) showArtifactPopup(artifact); };
      if (clue) showCluePopup(clue, revealArtifact);
      else revealArtifact();
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
    return { text: `${formatApproxLocationCompact(distanceMi, angleDeg)} of your starting camp.` };
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
    robotCompanion.getSaveData() ?? undefined,
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
    robotCompanion.getSaveData() ?? undefined,
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
    structures.restore(s.tileX, s.tileY, s.type, s.progressDays, s.complete, s.burnProgress, s.burnDurationDays);
  for (const c of save.droppedCanoes ?? [])
    droppedCanoes.drop(c.tileX, c.tileY);
  for (const p of save.timberPiles ?? [])
    timberPiles.restorePile(p.tileX, p.tileY, p.amount);
  if (save.mapPins !== undefined) {
    mapPins.restore(save.mapPins.map(p =>
      p.id.startsWith('ruins_') && p.name === 'Nameless ruins'
        ? { ...p, suggestName: randomRuinName }
        : p.id === 'capital' && !p.fixed
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
  robotCompanion.restore(save.robotCompanion);
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

// Debug tool: warp the player near whatever the next quest milestone is — the
// pin for the currently active find_and_name quest (a ruins site, or the
// capital once its own quest is placed), or the capital tile itself if it's
// unlocked but the player hasn't gotten close enough yet to spawn its pin.
function warpToNextMilestone(): void {
  let targetX: number, targetY: number;
  const activeQuest = quests.getAll().find(q => q.status === 'active' && q.type === 'find_and_name');
  if (activeQuest) {
    const pin = mapPins.findById(activeQuest.data.pinId as string);
    if (!pin) { hud.flash('Debug warp: active quest pin not found.'); return; }
    targetX = pin.tileX;
    targetY = pin.tileY;
  } else if (capitalUnlocked && mapPins.findById('capital') === undefined) {
    targetX = capitalTileX;
    targetY = capitalTileY;
  } else {
    hud.flash('Debug warp: no active quest milestone.');
    return;
  }

  const OFFSET_TILES = 10;
  const WATER_BIOMES_WARP = new Set(["deep_water", "shallow_water"]);
  let wx = targetX, wy = targetY;
  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const cx = Math.round(targetX + Math.cos(angle) * OFFSET_TILES);
    const cy = Math.round(targetY + Math.sin(angle) * OFFSET_TILES);
    const b = getBiome(
      sampleElevation(cx, cy, elevation),
      sampleMoisture(cx, cy, moisture),
      sampleRiver(cx, cy, river),
      sampleLake(cx, cy, river),
    );
    wx = cx; wy = cy;
    if (!WATER_BIOMES_WARP.has(b)) break;
  }
  player.teleport(wx, wy);
  hud.flash(`Debug warp: landed near (${targetX}, ${targetY})`);
}
const debugPanel = createDebugPanel(warpToNextMilestone);

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

// Full ruins chain, computed up front so the capital (see "Capital tile"
// block) can be anchored to the chain's actual final heading instead of
// guessing off the first ruin alone — the chain can drift up to 30° per leg
// (see findRuinsTileInCone), so a guess anchored only to leg 1 could point
// well outside the direction three more legs of random drift actually ended
// up taking the player, forcing a long backtrack to reach the capital.
// ruinsChainTiles[i] is the location of ruins_i; all deterministic per world
// seed. Quests/pins for ruins_1.. are still only revealed one at a time as
// the player completes the previous one (see quests.onComplete and
// revealRuinsQuest below) — only the underlying geometry is computed early.
const ruinsChainTiles: { tileX: number; tileY: number }[] = [];
let finalChainBearingDeg = 0;

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

  const RUINS_MIN_MILES = 25 * 0.85;
  const RUINS_MAX_MILES = 25 * 1.15;
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
  ruinsChainTiles.push({ tileX: rtx, tileY: rty });

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
    const rBearing = approxBearingCompactText(rMiles, rAngle);
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

  // Continue the chain deterministically for ruins 1..N-1. Prefer whatever a
  // restored save already placed (so already-revealed ruins keep their exact
  // stored locations) and roll the rest with a dedicated seeded generator —
  // distinct from the ruin-0 one above — so a fresh game is fully
  // reproducible from the world seed alone.
  let chainSeed = 0;
  for (let i = 0; i < currentSeed.length; i++)
    chainSeed = (chainSeed * 31 + currentSeed.charCodeAt(i) + 0x5eed) >>> 0;
  const chainRng = () => {
    chainSeed ^= chainSeed << 13;
    chainSeed ^= chainSeed >>> 17;
    chainSeed ^= chainSeed << 5;
    return (chainSeed >>> 0) / 0x100000000;
  };

  // Leg distances ruin-to-ruin (ruin 0 -> 1 -> 2 -> 3) — cumulative from start
  // this puts ruins at 25/150/300/500 mi, then the capital (see
  // CAPITAL_LEG_MILES below) at ~1000 mi. Kept in sync with
  // RUIN_MILE_THRESHOLDS/CAPITAL_LEG_MILES in rivalParties.ts.
  const RUINS_LEG_MILES = [125, 150, 200];
  let curX = rtx, curY = rty;
  let bearingDeg = ((Math.atan2(curX - startTileX, -(curY - startTileY)) * 180 / Math.PI) + 360) % 360;
  for (let idx = 1; idx < RIVAL_TOTAL_RUINS; idx++) {
    const existingPin = mapPins.findById(`ruins_${idx}`);
    let nextX: number, nextY: number;
    if (existingPin) {
      nextX = existingPin.tileX;
      nextY = existingPin.tileY;
    } else {
      const targetMiles = RUINS_LEG_MILES[idx - 1];
      const t = findRuinsTileInCone(curX, curY, bearingDeg, targetMiles, chainRng);
      nextX = t.tileX;
      nextY = t.tileY;
    }
    ruinsChainTiles.push({ tileX: nextX, tileY: nextY });
    bearingDeg = ((Math.atan2(nextX - curX, -(nextY - curY)) * 180 / Math.PI) + 360) % 360;
    curX = nextX;
    curY = nextY;
  }
  finalChainBearingDeg = bearingDeg;
}

// --- Capital tile ---
// Seeded from world seed. Treated as the 5th leg of the ruins chain — 500
// miles from the last ruin, same escalating-leg pattern as the others —
// putting the capital at a cumulative ~1000 mi from start (25+125+150+200+500).
// Always deterministic. Kept in sync with CAPITAL_LEG_MILES in rivalParties.ts.
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
  const CAPITAL_LEG_MILES = 500;
  const CAPITAL_MIN_MILES = CAPITAL_LEG_MILES * 0.85;
  const CAPITAL_MAX_MILES = CAPITAL_LEG_MILES * 1.15;
  // Keep the capital within a cone of the ruins chain's actual final heading
  // (ruin 3 -> ruin 4) so the chain generally leads the player toward it
  // instead of away from it — same cone width as the other legs (see
  // CONE_HALF_DEG above) now that this leg is just as long as theirs; a much
  // wider cone would let a 500 mi leg drift far enough to blow past the
  // ~1000 mi total the whole chain is tuned for.
  const CAPITAL_CONE_HALF_DEG = 30;
  const WATER_BIOMES_CAP = new Set(["deep_water", "shallow_water"]);
  // Keep clear of settlements/villages: comfortably past the capital's own
  // 15-tile sprite spread plus a town's ~3-tile building spread.
  const CAPITAL_SETTLEMENT_BUFFER_TILES = 30;
  const lastRuin = ruinsChainTiles[RIVAL_TOTAL_RUINS - 1];
  const anchorX = lastRuin.tileX, anchorY = lastRuin.tileY;
  const capDist = (CAPITAL_MIN_MILES + capRng() * (CAPITAL_MAX_MILES - CAPITAL_MIN_MILES)) / MILES_PER_TILE;
  const capBearingDeg = finalChainBearingDeg + (capRng() * 2 - 1) * CAPITAL_CONE_HALF_DEG;
  const capBearingRad = (capBearingDeg * Math.PI) / 180;
  capitalTileX = Math.round(anchorX + Math.sin(capBearingRad) * capDist);
  capitalTileY = Math.round(anchorY - Math.cos(capBearingRad) * capDist);
  // Nudge off water and away from settlements/villages if needed
  for (let attempt = 0; attempt < 200; attempt++) {
    const cb = getBiome(
      sampleElevation(capitalTileX, capitalTileY, elevation),
      sampleMoisture(capitalTileX, capitalTileY, moisture),
      sampleRiver(capitalTileX, capitalTileY, river),
      sampleLake(capitalTileX, capitalTileY, river),
    );
    const nearSettlement = isNearSettlementSite(
      currentSeed, capitalTileX, capitalTileY, startTileX, startTileY,
      elevation, moisture, river, CAPITAL_SETTLEMENT_BUFFER_TILES,
    );
    if (!WATER_BIOMES_CAP.has(cb) && !nearSettlement) break;
    const aDeg = finalChainBearingDeg + (capRng() * 2 - 1) * CAPITAL_CONE_HALF_DEG;
    const aRad = (aDeg * Math.PI) / 180;
    capitalTileX = Math.round(anchorX + Math.sin(aRad) * capDist);
    capitalTileY = Math.round(anchorY - Math.cos(aRad) * capDist);
  }

  // Ruined capital: a nameless-ruins site, but 5x the footprint count and spread,
  // reflecting the scale of a lost capital city. Placed unconditionally every load
  // (like the nameless ruins sprites) since it's purely derived from the world seed.
  const capitalSpriteCount = 5 * (3 + Math.floor(capRng() * 4));
  ruinSprites.scatter(capitalTileX, capitalTileY, capitalSpriteCount, capRng, 5 * 3);
}

const CAPITAL_REVEAL_RADIUS_TILES = 40;

// Places the capital map pin the first time the player gets close enough to
// see it. If a rival party got there first, the pin comes pre-named and
// locked (fixed: true) — otherwise it behaves like a ruins pin: nameable,
// with a "name it" quest that completes on rename.
function maybeRevealCapitalPin(playerTileX: number, playerTileY: number): void {
  if (mapPins.findById('capital') !== undefined) return;
  const dx = capitalTileX - playerTileX, dy = capitalTileY - playerTileY;
  if (Math.hypot(dx, dy) > CAPITAL_REVEAL_RADIUS_TILES) return;

  const claimant = rivalParties.find(p => p.reachedCapital);
  const ce = sampleElevation(capitalTileX, capitalTileY, elevation);
  const cm = sampleMoisture(capitalTileX, capitalTileY, moisture);
  const cr = sampleRiver(capitalTileX, capitalTileY, river);
  const cl = sampleLake(capitalTileX, capitalTileY, river);
  const cb = getBiome(ce, cm, cr, cl);
  const cElevFt = Math.round(Math.max(0, ((ce - 0.42) / 0.58) * 14400));
  const cdx = capitalTileX - startTileX, cdy = capitalTileY - startTileY;
  const cMiles = Math.sqrt(cdx * cdx + cdy * cdy) * MILES_PER_TILE;
  const cAngle = ((Math.atan2(cdx, -cdy) * 180) / Math.PI + 360) % 360;
  const cBearing = approxBearingCompactText(cMiles, cAngle);

  mapPins.add({
    id: 'capital',
    tileX: capitalTileX,
    tileY: capitalTileY,
    name: claimant ? randomRuinName() : 'Nameless capital',
    color: '#c9a227',
    fixed: !!claimant,
    dayPlaced: Math.floor(stats.daysTraveled),
    elevationFt: cElevFt,
    biome: cb,
    distanceMiles: cMiles,
    bearing: cBearing,
    notes: '',
    suggestName: claimant ? undefined : randomRuinName,
  });

  if (!claimant) {
    quests.add({
      id: 'quest_capital',
      type: 'find_and_name',
      title: 'Name the ancient capital',
      description: `${cBearing} of starting location`,
      status: 'active',
      data: { pinId: 'capital' },
    });
  }

  hud.flash(claimant
    ? `You've found the ancient capital — ${claimant.name} already named it.`
    : "You've discovered the ancient capital!");
}

// --- Ruins quest chain ---
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

// Reveals the ruins pin/quest at a location already computed up front (see
// ruinsChainTiles) — no rolling here; this just surfaces the next leg of the
// chain once the player completes the previous one.
function revealRuinsQuest(tileX: number, tileY: number, questIndex: number) {
  const spriteCount = 3 + Math.floor(Math.random() * 4);
  ruinSprites.scatter(tileX, tileY, spriteCount, Math.random);

  const re = sampleElevation(tileX, tileY, elevation);
  const rm = sampleMoisture(tileX, tileY, moisture);
  const rr = sampleRiver(tileX, tileY, river);
  const rl = sampleLake(tileX, tileY, river);
  const rb = getBiome(re, rm, rr, rl);
  const reElevFt = Math.round(Math.max(0, ((re - 0.42) / 0.58) * 14400));
  const rdx = tileX - startTileX, rdy = tileY - startTileY;
  const rMiles = Math.sqrt(rdx * rdx + rdy * rdy) * MILES_PER_TILE;
  const rAngle = ((Math.atan2(rdx, -rdy) * 180) / Math.PI + 360) % 360;
  const rBearing = approxBearingCompactText(rMiles, rAngle);
  const pinId = `ruins_${questIndex}`;
  mapPins.add({
    id: pinId, tileX, tileY, name: 'Nameless ruins', color: '#000',
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

  lastRuinsTileX = tileX;
  lastRuinsTileY = tileY;
}

// Initialize daily recap tracking after stats are loaded.
milesAtLastMidnight       = stats.milesTraveled;
foodAtLastMidnight        = stats.foodConsumed;
waterAtLastMidnight       = stats.waterConsumed;
foodSpoiledAtLastMidnight = stats.foodSpoiled;
lastKnownDay = Math.floor(stats.daysTraveled);

// --- Rival parties init ---
if (rivalParties.length === 0) {
  rivalParties = createRivalParties(currentSeed);
}
// Saves from before rivals switched to pure-mileage progress won't have
// capitalDistanceMiles — backfill it with the same ~500 mi final-leg target
// createRivalParties itself uses.
for (const p of rivalParties) {
  if (typeof p.capitalDistanceMiles !== 'number' || Number.isNaN(p.capitalDistanceMiles)) {
    p.capitalDistanceMiles = RIVAL_CAPITAL_LEG_MILES * (0.85 + Math.random() * 0.30);
  }
  // Same vintage of save can also have ruinsFound already at 4 (reached under
  // the old position-based system) but no milesAtRuinsComplete, since that
  // field only ever gets set at the 3->4 transition — which, for these
  // parties, already happened before the field existed. Without this, the
  // "?? milesTraveled" fallback in tickRivalParties recomputes fresh every
  // tick instead of once, permanently pinning progress at exactly 0. Give
  // them a fresh baseline now rather than leave them stuck forever.
  if (p.ruinsFound >= RIVAL_TOTAL_RUINS && typeof p.milesAtRuinsComplete !== 'number') {
    p.milesAtRuinsComplete = p.milesTraveled;
    p.dayRuinsComplete = Math.floor(stats.daysTraveled);
  }
}
// Also derive capitalUnlocked from quest state in case it wasn't saved
if (!capitalUnlocked) {
  capitalUnlocked = quests.getAll().some(q => q.id === `quest_ruins_${RIVAL_TOTAL_RUINS - 1}` && q.status === 'complete');
}
// Catch-up fixup: a rival could already have reachedCapital = true from a
// save predating the "rival claims the pin" fix below (see the 'arrived:'
// handling further down) — that event only fires on the reachedCapital
// false->true transition, which already happened for these, so it won't
// fire again on load. Claim the pin now instead of leaving it dangling.
{
  const capitalPin = mapPins.findById('capital');
  if (capitalPin && !capitalPin.fixed && rivalParties.some(p => p.reachedCapital)) {
    mapPins.claimPin('capital', randomRuinName());
    quests.remove('quest_capital');
  }
}
// Re-place standees for any rival parties that had already reached the capital
// in a restored save.
rivalSprites.sync(rivalParties, capitalTileX, capitalTileY, playerFrontIdleUrl);

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
// The LD only ever reflects the last survey taken — it does not track the
// player's live position — plus how long ago that survey was, so a stale
// reading reads as stale (see formatElapsedGameTime).
function distanceFromStart(): string {
  if (!stats.hasSurveyed) return "at start";
  const elapsed = formatElapsedGameTime(stats.daysTraveled - stats.lastSurveyDaysTraveled);
  const elapsedSuffix = elapsed === "moments ago" ? elapsed : `${elapsed} old`;
  const location = formatApproxLocationCompact(stats.lastSurveyMiles, stats.lastSurveyBearingDeg);
  return `${location} of start (${elapsedSuffix})`;
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

// Campfire build time: 15 minutes under ideal conditions (clear/overcast/fog
// weather, plenty of standing timber in the local biome), scaled up by
// weather and scarce timber. The two multipliers stack (rain + scarce timber
// is worse than either alone) — WeatherEvent only ever has one active type,
// so the worst case is rain × scarce-timber (×4 × ×2.5 = ×10 → 150 min),
// never rain AND blizzard together.
const CAMPFIRE_BASE_DAYS = 15 / 60 / 24;
// Timber availability is read straight off the tile's biome (BIOMES[x].baseResources.timber,
// 0–9) rather than tracked timber piles — piles are for canoe/shelter material,
// not fun to manage as a fire-starting gate. Below 1 (water/beach/desert),
// there's nothing to burn at all. At/above 9 (forest, the richest biome),
// timber isn't a limiting factor.
const CAMPFIRE_MIN_TIMBER = 1;
const CAMPFIRE_IDEAL_TIMBER = 9;
// Campfire building is a standalone, optional step (see Build > Campfire) —
// it no longer knows whether the player is about to rest, let alone for how
// long, so its lifetime is just "long enough to be worth it": 4 hours, or
// until dawn + a 2-hour buffer, whichever is longer.
const CAMPFIRE_MIN_BURN_HOURS = 4;
const CAMPFIRE_DAWN_BURN_BUFFER_HOURS = 2;

// Below this, warmth reads as "Freezing" (see getWarmthLabel's WARMTH_LEVELS) —
// an unsheltered rest that reaches this wakes the player up early.
const FREEZING_WARMTH_THRESHOLD = 21;

// Game hours until the next dawn (6 AM) — shared by "Rest Until Dawn" (how
// long the rest itself takes) and computeCampfireBurnHours (how long a fire
// built now should last to plausibly still be going at dawn).
function hoursUntilNextDawn(): number {
  const frac = stats.daysTraveled % 1;
  const morning = 6 / 24;
  const toNextDawnDays = frac < morning ? morning - frac : 1 + morning - frac;
  return toNextDawnDays * 24;
}

function computeCampfireBurnHours(): number {
  return Math.max(CAMPFIRE_MIN_BURN_HOURS, hoursUntilNextDawn() + CAMPFIRE_DAWN_BURN_BUFFER_HOURS);
}

// Returns null if the biome has nothing to burn at all; otherwise a
// multiplier from 2.5x (barely enough) down to 1x (plenty).
function campfireTimberMultiplier(biomeTimber: number): number | null {
  if (biomeTimber < CAMPFIRE_MIN_TIMBER) return null;
  if (biomeTimber >= CAMPFIRE_IDEAL_TIMBER) return 1;
  const t = (biomeTimber - CAMPFIRE_MIN_TIMBER) / (CAMPFIRE_IDEAL_TIMBER - CAMPFIRE_MIN_TIMBER);
  return 2.5 - t * 1.5;
}

// Scaled by intensity (1=light, 3=heavy) — light rain barely slows things
// down; heavy rain is the full ×4 called out in the spec. Thunderstorms use
// the same curve as rain (both are heavy rain at their core); blizzards get
// their own, lighter curve topping out at ×3.
const CAMPFIRE_RAIN_MULT_BY_INTENSITY     = [1.3, 2.2, 4] as const;
const CAMPFIRE_BLIZZARD_MULT_BY_INTENSITY = [1.2, 2,   3] as const;
function campfireWeatherMultiplier(resolvedType: string, intensity: 1 | 2 | 3): number {
  const i = intensity - 1;
  if (resolvedType === "blizzard") return CAMPFIRE_BLIZZARD_MULT_BY_INTENSITY[i];
  if (resolvedType === "rain" || resolvedType === "thunderstorm") return CAMPFIRE_RAIN_MULT_BY_INTENSITY[i];
  return 1;
}

// Null return means "impossible" (biome has no timber at all, e.g. desert/
// beach/water) — caller decides how to handle that rather than this function
// silently picking a fallback.
function computeCampfireBuildDays(tx: number, ty: number): number | null {
  const biome = getBiome(
    sampleElevation(tx, ty, elevation),
    sampleMoisture(tx, ty, moisture),
    sampleRiver(tx, ty, river),
    sampleLake(tx, ty, river),
  );
  const timberMult = campfireTimberMultiplier(BIOMES[biome].baseResources.timber);
  if (timberMult === null) return null;
  const event = weatherSystem.getCurrentEvent(stats.daysTraveled);
  const resolved = resolveWeatherForTemp(event, ambientTempAt(tx, ty));
  const weatherMult = campfireWeatherMultiplier(resolved.type, resolved.intensity);
  return CAMPFIRE_BASE_DAYS * timberMult * weatherMult;
}

// Starts a timed campfire build at (tx, ty) — the structure lands on the
// nearest free adjacent tile (same placement rule as canoe/shelter), but the
// player must stay on (tx, ty) itself for the build to continue (see the
// buildTileX/Y check in tick()). burnHours is how long the fire stays lit
// once built (fixed at start, not tracked via timber piles or fuel) — see
// computeCampfireBurnHours. Campfire-building is a standalone Build-menu
// action now, independent of Rest; it doesn't chain into anything.
function startCampfireBuild(tx: number, ty: number, burnHours: number): boolean {
  const days = computeCampfireBuildDays(tx, ty);
  if (days === null) return false;
  const tile = findAdjacentLandTile(tx, ty) ?? { tileX: tx + 1, tileY: ty };
  const idx = structures.add(tile.tileX, tile.tileY, "campfire");
  stats.activeAction = {
    id: "build_campfire",
    label: "Building campfire",
    durationDays: days,
    progressDays: 0,
    structureIndex: idx,
    buildTileX: tx,
    buildTileY: ty,
    campfireBurnHours: burnHours,
  };
  return true;
}

// Shared by "Rest Until Dawn" and "Rest (2 hrs)". Building a campfire is now
// a separate, optional step the player takes beforehand (Build > Campfire) —
// Rest itself never builds one. sleepingInTent (tent sprite + 25% time
// slowdown) only applies to "Rest Until Dawn" (isUntilDawn), and only if a
// campfire happens to already be lit nearby.
function beginRest(tx: number, ty: number, durationDays: number, inShelter: boolean, isUntilDawn: boolean) {
  autoDropCanoe(tx, ty);
  const sleepingInTent = isUntilDawn && !inShelter && structures.isWarmed(tx, ty);
  stats.activeAction = {
    id: "rest",
    label: "Resting",
    durationDays,
    progressDays: 0,
    energyMultiplier: inShelter ? 8 : 1.5,
    sleepingInTent,
  };
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
  // Deep water is impassable on foot regardless of waders — always needs a canoe.
  const b = getBiomeAt(tx, ty);
  if (b === 'deep_water') return false;
  // Shallow water can always be waded on foot now, at any distance from
  // shore — see DEEP_WADE_SPEED_MULT in the speed calc for the consequences
  // of doing so beyond the "safe" radius (hip waders extend that radius to 3
  // tiles; without them it's 1).
  return true;
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

// --- Tent sprite overlay (shown while sleepingInTent, see beginRest) ---
const tentEl = document.createElement("div");
tentEl.textContent = "⛺";
tentEl.style.cssText = `
  position: fixed;
  font-size: 24px;
  line-height: 1;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 600;
  display: none;
`;
document.body.appendChild(tentEl);

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

// --- Musket reload indicator ---
// A small progress bar above the player's head, shown only while reloading
// after a shot (see reloadRemaining/reloadDuration and the fire handler).
const reloadBarEl = document.createElement("div");
reloadBarEl.style.cssText = `
  position: fixed;
  width: 40px;
  height: 8px;
  border: 1px solid rgba(255,255,255,0.7);
  border-radius: 3px;
  background: rgba(0,0,0,0.5);
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 601;
  display: none;
  overflow: hidden;
`;
const reloadBarFillEl = document.createElement("div");
reloadBarFillEl.style.cssText = `
  height: 100%;
  width: 0%;
  background: rgba(255, 220, 120, 0.95);
`;
reloadBarEl.appendChild(reloadBarFillEl);
document.body.appendChild(reloadBarEl);

// --- Survey mode ---
let surveyOffsetX = 0;
let surveyOffsetY = 0;
let surveyMaxRange = 0;
let forecastDepth = 1;
// Absolute floor for a ruin/capital fix while surveying — well below "hills"
// (0.55), just enough to rule out swamps/beaches/water; prominence (below)
// does the real gatekeeping so a modest rise above flat surroundings counts,
// not just raw altitude.
const SURVEY_FIX_MIN_ELEV = 0.45;
// Minimum prominence — how much higher the player is than the average of a
// ring of points 20 tiles out — required for a fix. Same "advantage" measure
// computeSurveyRange already uses to widen visibility, on the same 0–1 scale
// (it's multiplied by 500 there to turn a ~0.03–0.08 value into extra tiles
// of range, so this threshold sits in that band).
const SURVEY_FIX_MIN_PROMINENCE = 0.04;

// How much higher (tx,ty) is than the average of a ring of points sampled
// 20 tiles out — i.e. local prominence, not just absolute elevation. Shared
// by computeSurveyRange (widens visibility) and the ruins/capital fix gate
// (requires standing somewhere that actually rises above its surroundings).
function computeElevationAdvantage(tx: number, ty: number, playerElev: number): number {
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
  return Math.max(0, playerElev - horizonElev * 0.5);
}

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
  const advantage = computeElevationAdvantage(tx, ty, playerElev);
  // Base scales with own elevation so higher ground is intrinsically better.
  // Cap at what fits within the survey chunk radius to avoid black edges.
  const maxPossible = SURVEY_CHUNK_RADIUS * CHUNK_WIDTH - 24;
  return Math.round(Math.min(24 + playerElev * 48 + advantage * 500, maxPossible) * visMult);
}

function enterSurvey() {
  forecastDepth = 2;
  const tx = Math.floor(player.tileX);
  const ty = Math.floor(player.tileY);
  // Snapshot the LD's distance/bearing from start here — it only ever
  // updates when a survey is taken, not on every frame of movement.
  stats.hasSurveyed = true;
  const homeDx = tx - startTileX;
  const homeDy = ty - startTileY;
  stats.lastSurveyMiles = Math.sqrt(homeDx * homeDx + homeDy * homeDy) * MILES_PER_TILE;
  stats.lastSurveyBearingDeg = ((Math.atan2(homeDx, -homeDy) * 180) / Math.PI + 360) % 360;
  stats.lastSurveyDaysTraveled = stats.daysTraveled;
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
  // Surveying also gives a fix on the nearest known landmark (capital once
  // unlocked, otherwise the nearest revealed nameless ruin), same as the
  // lodestone — but doesn't require owning one. Folded into the same label
  // as the range readout (rather than a separate hud.flash) so the two
  // don't compete for the banner and one doesn't get clobbered by the other.
  // Requires standing somewhere that actually rises above its surroundings
  // (prominence), plus a low absolute floor to rule out swamps/beaches/water
  // that could otherwise register as "prominent" from noise alone.
  const playerElev = sampleElevation(tx, ty, elevation);
  const prominence = computeElevationAdvantage(tx, ty, playerElev);
  const hasVantage = playerElev >= SURVEY_FIX_MIN_ELEV && prominence >= SURVEY_FIX_MIN_PROMINENCE;
  const clue = hasVantage
    ? nearestRuinOrCapitalClue(tx, ty, true, prominence)
    : "Too low to locate ruins. Find higher ground.";
  const clueSuffix = clue ? ` · ${clue}` : "";
  stats.activeAction = {
    id: "survey",
    label: `Surveying (${rangeStr} mi range)${clueSuffix}`,
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
function showQuestComplete(
  quest: { title: string },
  cityName: string,
  onDismiss: () => void,
) {
  modalOpenCount++;
  const homeDx = player.tileX - startTileX, homeDy = player.tileY - startTileY;
  const milesFromHome = Math.sqrt(homeDx * homeDx + homeDy * homeDy) * MILES_PER_TILE;
  const homeAngle = ((Math.atan2(homeDx, -homeDy) * 180 / Math.PI) + 360) % 360;
  const homeBearing = milesFromHome < 0.1 ? 'at start'
    : `${formatApproxLocation(milesFromHome, homeAngle)} of start`;

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
  cityLine.style.cssText = 'font-size: 15px; color: #e8d8a0; letter-spacing: 0.03em; margin-bottom: 28px;';

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
    padding: 10px 28px; cursor: pointer; margin-top: 32px;
  `;
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)'; btn.style.color = '#d0d0d0'; });
  const dismiss = () => { modalOpenCount--; overlay.remove(); onDismiss(); };
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

// Second congratulations screen, shown after the clue (if any) — reveals the
// ruin artifact just awarded with an evocative description and how it works.
function showArtifactPopup(artifact: ArtifactDef, onDismiss?: () => void): void {
  modalOpenCount++;
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

  const artTitle = document.createElement('div');
  artTitle.textContent = '✦ Artifact Discovered ✦';
  artTitle.style.cssText = 'font-size: 20px; color: #c8a84a; margin-bottom: 18px; letter-spacing: 0.06em;';

  const artEmoji = document.createElement('div');
  artEmoji.textContent = artifact.emoji;
  artEmoji.style.cssText = 'font-size: 48px; margin-bottom: 12px; line-height: 1;';

  const artName = document.createElement('div');
  artName.textContent = artifact.name;
  artName.style.cssText = 'font-size: 17px; color: #e8d8a0; font-weight: bold; margin-bottom: 16px; letter-spacing: 0.03em;';

  const artFlavor = document.createElement('div');
  artFlavor.textContent = artifact.flavor;
  artFlavor.style.cssText = 'font-size: 13px; color: #bbb; font-style: italic; line-height: 1.7; text-align: center; margin-bottom: 20px;';

  const divider = document.createElement('hr');
  divider.style.cssText = 'border:none; border-top:1px solid rgba(255,255,255,0.07); margin:8px 0; width: 100%;';

  const artHowLabel = document.createElement('div');
  artHowLabel.textContent = 'HOW IT WORKS';
  artHowLabel.style.cssText = 'font-size: 10px; color: #888; letter-spacing: 0.12em; margin-bottom: 8px; align-self: flex-start;';

  const artInstructions = document.createElement('div');
  artInstructions.textContent = artifact.instructions;
  artInstructions.style.cssText = 'font-size: 13px; color: #ddd; line-height: 1.6; margin-bottom: 8px;';

  const btn = document.createElement('button');
  btn.textContent = 'Continue';
  btn.style.cssText = `
    background: rgba(40,40,40,0.9); border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px; color: #d0d0d0; font: 13px monospace;
    padding: 10px 28px; cursor: pointer; margin-top: 32px;
  `;
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(70,70,70,0.95)'; btn.style.color = '#fff'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(40,40,40,0.9)'; btn.style.color = '#d0d0d0'; });
  const dismiss = () => { modalOpenCount--; overlay.remove(); onDismiss?.(); };
  requestAnimationFrame(() => {
    btn.addEventListener('click', dismiss);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') dismiss(); });
    btn.focus();
  });

  box.append(artTitle, artEmoji, artName, artFlavor, divider, artHowLabel, artInstructions, btn);
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

  // doSave() (interval timer, sleep completion, tab close) bails out once
  // gameOver is true — set synchronously the instant health hits 0, before any
  // of those can fire again — so the auto-save on disk is guaranteed to still
  // be the last pre-death snapshot. A plain reload (no deleteSave) resumes it.
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "Continue from last save";
  continueBtn.style.cssText = `
    background: rgba(40,70,40,0.9);
    border: 1px solid rgba(140,220,140,0.4);
    border-radius: 6px;
    color: #a0e0a0;
    font: 13px monospace;
    padding: 10px 28px;
    cursor: pointer;
    display: block;
    width: 100%;
    margin-bottom: 10px;
  `;
  continueBtn.addEventListener("mouseenter", () => {
    continueBtn.style.background = "rgba(60,120,60,0.95)";
    continueBtn.style.color = "#d0ffd0";
  });
  continueBtn.addEventListener("mouseleave", () => {
    continueBtn.style.background = "rgba(40,70,40,0.9)";
    continueBtn.style.color = "#a0e0a0";
  });
  continueBtn.addEventListener("click", () => {
    localStorage.removeItem("manualPaused");
    window.location.reload();
  });

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

  box.append(title, sub, continueBtn, btn);

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
// True while Cmd has been held continuously since its last keydown without any
// non-arrow key having been pressed in between — only a "clean" Cmd+Arrow combo
// may engage auto-walk.
let cmdSequenceClean = false;

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
  const effectiveDelta = isPaused || radialMenu.isOpen() || traders.isTradingPaused() || modalOpenCount > 0 ? 0 : delta;

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
  const nightBootsMult = stats.nightBoots > 0 && !isDaylight(stats.daysTraveled) && !usingCanoe ? 1.5 : 1;

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

  // Wading beyond the "safe" radius (1 tile from shore normally, 3 with hip
  // waders) is still allowed on foot — see canEnterTile — but crossing a
  // wide stretch of shallow water this way is slow going, not a free option.
  const wadeRadius = stats.hipWaders > 0 ? 3 : 1;
  const deepWading =
    inWater && !usingCanoe && currentBiome === 'shallow_water' &&
    !canWadeShallowWater(wadeRadius, (ddx, ddy) => isWaterBiome(tx + ddx, ty + ddy));
  const DEEP_WADE_SPEED_MULT = 0.20;
  const deepWadeMult = deepWading ? DEEP_WADE_SPEED_MULT : 1;

  const effectiveSpeed =
    (usingCanoe
      ? 1.5
      : biomeProps.speedMultiplier * (carryingCanoe ? 0.45 : 1)) *
    getWeightMultiplier(stats) *
    weatherEffects.moveMult *
    moraleMult *
    cramponsMult *
    nightBootsMult *
    slopeMult *
    deepWadeMult;

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
      speedNightBoots: nightBootsMult,
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
      rivals: rivalParties.map(p => ({
        name: p.name,
        status: p.status,
        reachedCapital: p.reachedCapital ?? false,
        ruinsFound: p.ruinsFound,
        milesTraveled: p.milesTraveled,
        capitalDistanceMiles: p.capitalDistanceMiles,
        milesAtRuinsComplete: p.milesAtRuinsComplete,
        dayRuinsComplete: p.dayRuinsComplete,
        restDaysRemaining: p.restDaysRemaining,
      })),
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

  // autoWalkDx/Dy is a fixed intended heading — only changed by explicit
  // engage/redirect/cancel events in the keydown handler above, never by
  // incidental movement outcomes (e.g. wall-sliding). While auto-walking, any
  // arrow(s) currently held take over movement directly (a temporary manual
  // detour — e.g. tapping Right while heading south moves due east until
  // released); with nothing held, it resumes the heading. Reversing the
  // heading outright is instead caught as a cancel in the keydown handler, so
  // by the time we get here autoWalkMode is already off for that case.
  const anyArrowHeld = input.up || input.down || input.left || input.right;
  const playerInput = isSurveying
    ? { up: false, down: false, left: false, right: false }
    : (autoWalkMode && (autoWalkDx !== 0 || autoWalkDy !== 0))
      ? anyArrowHeld
        ? input
        : { up: autoWalkDy < 0, down: autoWalkDy > 0, left: autoWalkDx < 0, right: autoWalkDx > 0 }
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
    const sleepingInTent = stats.activeAction?.id === "rest" && !!stats.activeAction.sleepingInTent;
    if (sleepingInTent) {
      playerEl.style.display = "none";
      canoeEl.style.display = "none";
      tentEl.style.display = "block";
    } else if (usingCanoe) {
      playerEl.style.display = "none";
      canoeEl.style.display = "block";
      tentEl.style.display = "none";
      const newCanoeSrc =
        lastCanoeDir === "left" ? canoeLeftUrl : canoeRightUrl;
      if (canoeEl.src !== newCanoeSrc) canoeEl.src = newCanoeSrc;
    } else {
      canoeEl.style.display = "none";
      tentEl.style.display = "none";
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
  const restProgressBefore = prevAction?.id === "rest" ? prevAction.progressDays : -1;
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

  // Wake early if the player starts freezing mid-rest — sheltered rest never
  // gets this cold (warmth is floored well above the Freezing threshold, see
  // below), so this only ever fires for unsheltered rest: no campfire, one
  // that was never enough, or one that's since burned out.
  if (stats.activeAction?.id === "rest" && !inShelter && stats.warmth < FREEZING_WARMTH_THRESHOLD) {
    stats.activeAction = null;
    showHudMessage("Too cold to sleep — you wake up freezing.");
  }

  // Heavy coat makes ambient temp feel 10°F warmer for warmth drain calculation.
  const effectiveTemp = currentTemp + (stats.heavyCoat > 0 ? 10 : 0);
  const unprotectedInWater = inWater && !usingCanoe && stats.hipWaders <= 0;
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
    resolvedWeather,
    unprotectedInWater,
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
    clouds.update(effectiveDelta, tx, ty, resolvedWeather);
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

  // Robot companion: forages once per in-game hour crossed while resting (mirrors
  // the timber-per-crossed-hour pattern above); follows/hides the rest of the time.
  let robotForageHourTick = false;
  if (restProgressBefore >= 0) {
    const restProgressAfter = stats.activeAction?.id === "rest"
      ? stats.activeAction.progressDays
      : prevAction!.durationDays; // rest completed this frame — treat as reaching full duration
    robotForageHourTick = Math.floor(restProgressAfter * 24) > Math.floor(restProgressBefore * 24);
  }
  robotCompanion.update(
    effectiveDelta,
    player.visualX,
    player.visualY,
    stats.activeAction?.id === "rest",
    robotForageHourTick,
    usingCanoe,
    (rtx, rty) => BIOMES[getBiomeAt(rtx, rty) as Biome],
  );

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
      structures.complete(
        prevAction.structureIndex,
        stats,
        prevAction.id === "build_campfire" ? (prevAction.campfireBurnHours ?? CAMPFIRE_MIN_BURN_HOURS) / 24 : undefined,
      );
    } else {
      // Cancelled (night, player moved off tile) — save progress for resumption
      structures.setProgress(
        prevAction.structureIndex,
        prevAction.progressDays,
      );
    }
  }

  // Campfire build finished: it's already lit and given its fixed lifetime
  // (see the structures.complete() call above — warmth then follows
  // automatically via structures.isWarmed()/the generic warmth snap in
  // updateStats). Campfire-building is a standalone Build-menu action now —
  // it doesn't chain into Rest.
  if (prevAction?.id === "build_campfire" && !stats.activeAction &&
      prevAction.progressDays >= prevAction.durationDays) {
    showHudMessage("Campfire lit.");
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
      const freshness = bestIsLive ? "Fresh tracks" : "Old tracks";
      showHudMessage(`${freshness} — ${bestQuest.manEaterName} is ${formatApproxLocation(miles, deg)}`);
    }
  }

  // Campfire burnout and trap checks share the same elapsed-time window.
  const gameDaysElapsed = stats.daysTraveled - prevDaysTraveled;
  if (gameDaysElapsed > 0) {
    for (const index of structures.tickCampfires(gameDaysElapsed)) {
      structures.burnOut(index);
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
      const avgMilesPerDay = stats.milesTraveled / (lastKnownDay + 1);
      activityLog.addEntry(
        `Day ${lastKnownDay + 1}: ${dayMiles.toFixed(1)} mi · ate ${dayFood.toFixed(1)} lbs · drank ${dayWater.toFixed(1)} gal${spoiledStr} · avg ${avgMilesPerDay.toFixed(1)} mi/day`,
      );
    }
    milesAtLastMidnight       = stats.milesTraveled;
    foodAtLastMidnight        = stats.foodConsumed;
    waterAtLastMidnight       = stats.waterConsumed;
    foodSpoiledAtLastMidnight = stats.foodSpoiled;

    // Advance rival parties for each day that passed
    const daysPassed = currentDay - lastKnownDay;
    const lostMsgs = tickRivalParties(rivalParties, daysPassed, lastKnownDay);
    for (const msg of lostMsgs) {
      if (msg.startsWith('lost:')) {
        const partyName = msg.slice(5);
        activityLog.addEntry(`${partyName} has not been heard from in many weeks. Feared lost.`);
      } else if (msg.startsWith('resting:')) {
        const partyName = msg.slice(8);
        activityLog.addEntry(`${partyName} is reported to have made camp — building a canoe or tending to the injured.`);
      } else if (msg.startsWith('arrived:')) {
        const partyName = msg.slice(8);
        // If the capital's pin already exists (the player found/revealed it)
        // but hasn't renamed it yet, this rival claims it now — mirrors the
        // existing "rival got there first" handling in maybeRevealCapitalPin,
        // which only covered the case where the pin didn't exist yet at all.
        const capitalPin = mapPins.findById('capital');
        if (capitalPin && !capitalPin.fixed) {
          const claimedName = randomRuinName();
          mapPins.claimPin('capital', claimedName);
          quests.remove('quest_capital');
          activityLog.addEntry(`${partyName} has reached the ancient capital and named it ${claimedName} before you could.`);
        } else {
          activityLog.addEntry(`${partyName} is reported to have reached the ancient capital.`);
        }
      }
    }
    rivalSprites.sync(rivalParties, capitalTileX, capitalTileY, playerFrontIdleUrl);

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
  updateWorklightOverlay();
  tileInspector.update();
  structures.update();
  droppedCanoes.update();
  timberPiles.update();
  traps.update();
  ruinSprites.update();
  rivalSprites.update();
  maybeRevealCapitalPin(tx, ty);
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
    stats.worklightOn,
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
    if (stats.activeAction?.id === "rest" && stats.activeAction.sleepingInTent) {
      tentEl.style.left     = `${pos.x}px`;
      tentEl.style.top      = `${pos.y}px`;
      tentEl.style.fontSize = `${playerPx}px`;
    } else if (usingCanoe) {
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

    // Musket reload progress bar, just above the status indicator row.
    if (reloadRemaining > 0) {
      const pct = Math.min(100, Math.round((1 - reloadRemaining / reloadDuration) * 100));
      reloadBarFillEl.style.width = `${pct}%`;
      reloadBarEl.style.left = `${pos.x}px`;
      reloadBarEl.style.top  = `${pos.y - 30}px`;
      reloadBarEl.style.display = "block";
    } else {
      reloadBarEl.style.display = "none";
    }
  }

  // Musket reload cooldown — real seconds, frozen while paused (effectiveDelta is 0 then).
  if (reloadRemaining > 0) reloadRemaining = Math.max(0, reloadRemaining - effectiveDelta);

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
