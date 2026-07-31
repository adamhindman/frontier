import type { BiomeProperties } from "./biomes";
import type { WeatherEffects, WeatherEvent } from "./weather";
export type { WeatherEffects } from "./weather";

export interface StatusCondition {
  id: string;
  label: string;
}

export interface Trophy {
  questId:      string;
  manEaterName: string;
  animalName:   string;
}

// Represents a time-consuming activity performed while stationary.
// Set stats.activeAction to start one; updateStats advances it and clears it on completion.
export interface ActiveAction {
  id: string;
  label: string; // shown in HUD
  durationDays: number; // how long it takes in game days
  progressDays: number; // how much has elapsed (mutated by updateStats)
  structureIndex?: number; // for build actions: index into StructureManager
  timberPerHour?: number;  // for build actions: timber deducted per in-game hour
  buildTileX?: number;     // tile where the player must stay (if different from structure tile)
  buildTileY?: number;
  energyMultiplier?: number; // multiplier on energy gain/drain for this action (default 1)
  sheltered?: boolean;       // treat as inside a shelter (warmth protection, shelter rest bonus)
  campfireBurnHours?: number;      // build_campfire only: how long the fire stays lit once complete
  sleepingInTent?: boolean; // rest only: player sprite swaps to a tent + time passes 25% slower (see beginRest)
}

export interface PlayerStats {
  health: number; // 0–100
  food: number; // lbs
  water: number; // lbs
  minerals: number; // units
  canoes: number; // completed canoes in inventory
  morale: number; // 0–100 (displayed as emoji face)
  energy: number; // 0–100
  warmth: number; // 0–100; drops in cold, restored by campfire/shelter
  milesTraveled: number;
  milesOverland: number;    // on foot, no canoe carried
  milesPortaging: number;   // on foot, carrying a canoe
  milesByCanoe: number;     // paddling on water
  foodConsumed: number;  // cumulative lbs eaten; diff at midnight for daily total
  waterConsumed: number; // cumulative gal drunk
  foodSpoiled: number;   // cumulative lbs lost to spoilage
  daysTraveled: number;
  daysTraveledSinceRest: number; // resets when a ≥1-day rest completes
  statusConditions: StatusCondition[];
  activeAction: ActiveAction | null;
  rifleAmmo: number; // rounds remaining; starts at 50
  pelts: number;     // fur pelts collected; no hard cap but adds to carry weight
  heavyCoat: number; // count owned; each adds +10°F to effective ambient temp for warmth drain
  hipWaders: number; // count owned; allows wading 3 tiles from shore instead of 1
  liquor: number;         // consumable count; restores morale + warmth on use
  medicine: number;       // consumable count; restores health on use
  precisionRifle: number; // 1 when owned; increases range +2, wobble ×0.75, jitter ×0.5
  lodestone: number;      // 1 when owned; click to get bearing to nearest nameless ruin
  shriekingCoil: number;  // 1 when owned; click to scare aggressive creatures within range
  nightBoots: number;     // 1 when owned; +50% travel speed at night
  tools: number;          // 1 when owned; halves canoe and shelter build time
  crampons: number;       // 1 when owned; +50% speed in mountains and hills
  trophies: Trophy[];     // man-eater kills ready to claim as quest rewards
  bleeding: boolean;     // true after an animal attack; drains 5 hp/hour until treated
  artifacts: string[];   // ids of ruin artifacts found (see artifacts.ts); one per ruin, no duplicates
  worklightLantern: number; // 1 when owned; toggle lets you build/harvest/survey/track at night
  worklightOn: boolean;     // current toggle state; false on load regardless of saved value
  hasSurveyed: boolean;     // true once the player has entered survey mode at least once
  lastSurveyMiles: number;      // distance from start at the moment of the last survey
  lastSurveyBearingDeg: number; // bearing from start (0=N) at the moment of the last survey
  lastSurveyDaysTraveled: number; // stats.daysTraveled at the moment of the last survey
  wetPenalty: number;      // 0 when dry; else degrees subtracted from perceived ambient temp (10, or 20 in a blizzard)
  wetHoursExposure: number; // consecutive hours walking in heavy rain/thunderstorm; resets when exposure stops
}

export const SECONDS_PER_DAY    = 120;
export const MILES_PER_TILE     = 0.05;
export const FOOD_CAPACITY_LBS  = 20;
export const WATER_CAPACITY_GAL = 10;
export const MINERALS_CAPACITY  = 50;

export const SUNRISE = 5  / 24; // 5 AM as a day fraction
export const SUNSET  = 20 / 24; // 8 PM as a day fraction

export function isDaylight(daysTraveled: number): boolean {
  const t = daysTraveled % 1;
  return t >= SUNRISE && t < SUNSET;
}

// Passive gather: probability per tile per resource unit of triggering a find
const PASSIVE_GATHER_PROB          = 0.0004;
const PASSIVE_FOOD_AMOUNT_PER_RES  = 0.10;  // lbs per resource unit (0-10 scale)
const PASSIVE_WATER_AMOUNT_PER_RES = 0.07;

const PASSIVE_FOOD_EMOJIS = ['🌿', '🫐', '🌰', '🍓'] as const;

// Active forage: ticks happen FORAGE_TICKS_PER_HOUR times per in-game hour;
// per-tick amounts are divided by the same constant so hourly totals stay identical.
const FORAGE_TICKS_PER_HOUR = 4; // tick every 15 game-minutes (~1.25 real seconds)
// Fish via adjacent water tile — rate set here; plant food and water use per-biome fields.
const FORAGE_FISH_FACTOR    = 0.375 / FORAGE_TICKS_PER_HOUR;
const HARVEST_TIMBER_FACTOR = 0.80 / FORAGE_TICKS_PER_HOUR;

export type ForageEvent = { emoji: string; timber?: number };

const BACKGROUND_FOOD_DRAIN_PER_DAY  = 0.9;  // lbs/day — always-on metabolic baseline
const BACKGROUND_WATER_DRAIN_PER_DAY = 0.5;  // gal/day
const SPOILAGE_RATE_PER_DAY = 0.10; // 10% of current stock per day
const SPOILAGE_MIN_PER_DAY  = 1.0;  // floor: always lose at least this much if food > 0

const REST_FOOD_DRAIN_PER_DAY   = 0.85; // lbs/day (on top of background → ~1.75 total); reduced 75% from 3.4
const REST_WATER_DRAIN_PER_DAY  = 1.0;  // gal/day (on top of background → ~1.5 total)
const REST_ENERGY_GAIN_PER_DAY  = 75;

const FORAGE_FOOD_DRAIN_PER_DAY    = 2.7; // lbs/day (on top of background → ~3.6 total)
const FORAGE_WATER_DRAIN_PER_DAY   = 0.5; // gal/day (on top of background → ~1.0 total)
const FORAGE_ENERGY_GAIN_PER_DAY   = 8;   // /day — lighter than rest (25/day) but still restorative

const MORALE_LEVELS = [
  { min: 0,  emoji: '😭', label: 'Despair'  },
  { min: 21, emoji: '😔', label: 'Ruined'   },
  { min: 41, emoji: '😐', label: 'Weary'    },
  { min: 61, emoji: '🙂', label: 'Resolute' },
  { min: 81, emoji: '😄', label: 'Elated'   },
] as const;

const WARMTH_LEVELS = [
  { min: 0,  label: 'Freezing'    },
  { min: 21, label: 'Cold'        },
  { min: 41, label: 'Chilled'     },
  { min: 61, label: 'Comfy' },
  { min: 81, label: 'Warm'        },
] as const;

export function getWarmthLabel(warmth: number): string {
  for (let i = WARMTH_LEVELS.length - 1; i >= 0; i--) {
    if (warmth >= WARMTH_LEVELS[i].min) return WARMTH_LEVELS[i].label;
  }
  return WARMTH_LEVELS[0].label;
}

export function getMoraleLabel(morale: number): string {
  for (let i = MORALE_LEVELS.length - 1; i >= 0; i--) {
    if (morale >= MORALE_LEVELS[i].min) return MORALE_LEVELS[i].label;
  }
  return MORALE_LEVELS[0].label;
}

export function getMoraleEmoji(morale: number): string {
  for (let i = MORALE_LEVELS.length - 1; i >= 0; i--) {
    if (morale >= MORALE_LEVELS[i].min) return MORALE_LEVELS[i].emoji;
  }
  return MORALE_LEVELS[0].emoji;
}

function stepMoraleUp(morale: number): number {
  for (let i = 0; i < MORALE_LEVELS.length - 1; i++) {
    if (morale < MORALE_LEVELS[i + 1].min) return MORALE_LEVELS[i + 1].min;
  }
  return morale; // already Elated
}

const BLEED_HEALTH_DRAIN_PER_DAY = 120; // 5 hp/hour; ~20 hours to die if untreated
const HEALTH_DRAIN_NO_FOOD_PER_DAY = 20; // ~5 days to die
const HEALTH_DRAIN_NO_WATER_PER_DAY = 50; // ~2 days to die
const HEALTH_DRAIN_NO_MORALE_PER_DAY = 5; // slow, more a debuff
const HEALTH_DRAIN_NO_ENERGY_PER_DAY = 10; // ~10 days to die

// Max regen rates when conditions are ideal (food, water, energy all > 0)
const HEALTH_REGEN_PER_DAY_MAX = 12;  // at morale 100 — scales linearly with morale
const MORALE_REGEN_PER_DAY_MAX = 40; // at health 100 — scales linearly with health

// Threshold below which tilesMoved is treated as zero (handles fp noise at boundaries)
const MOVE_THRESHOLD = 1e-4;

export function createStats(): PlayerStats {
  return {
    health: 100,
    food: 20,
    water: 6,
    minerals: 0,
    canoes: 1,
    morale: 100,
    energy: 100,
    warmth: 100,
    milesTraveled: 0,
    milesOverland: 0,
    milesPortaging: 0,
    milesByCanoe: 0,
    foodConsumed: 0,
    waterConsumed: 0,
    foodSpoiled: 0,
    daysTraveled: 9 / 24,
    daysTraveledSinceRest: 0,
    statusConditions: [],
    activeAction: null,
    rifleAmmo: 50,
    pelts: 0,
    heavyCoat: 0,
    hipWaders: 0,
    liquor: 0,
    medicine: 0,
    precisionRifle: 0,
    lodestone: 0,
    shriekingCoil: 0,
    nightBoots: 0,
    tools: 0,
    crampons: 0,
    trophies: [],
    bleeding: false,
    artifacts: [],
    worklightLantern: 0,
    worklightOn: false,
    hasSurveyed: false,
    lastSurveyMiles: 0,
    lastSurveyBearingDeg: 0,
    lastSurveyDaysTraveled: 0,
    wetPenalty: 0,
    wetHoursExposure: 0,
  };
}

// Speed penalty from carried food, water, and pelts. 1.0 = unencumbered, floors at 0.5.
export function getWeightMultiplier(stats: PlayerStats): number {
  const totalLbs = stats.food + stats.water + stats.pelts * 0.3;
  return Math.max(0.5, 1 - totalLbs * 0.01);
}

// Returns time-tick flag and any forage events that fired this frame.
const WARMTH_DRAIN_PER_DAY_MAX    = 450;
const WARMTH_RESTORE_PER_DAY_MAX  = 60;
const WARMTH_COMFORT_F            = 65;
const WARMTH_HEALTH_DRAIN_PER_DAY = 400;

// --- Wet condition ---
// Gained by walking 2+ hours in heavy rain (intensity 3) or a thunderstorm, or
// by standing in water without hip waders/a canoe. Subtracts from perceived
// ambient temperature (not the air itself — you just feel colder).
const WET_WALK_EXPOSURE_HOURS = 2;
const WET_PENALTY_DEFAULT  = 10; // °F, normal wet penalty
const WET_PENALTY_BLIZZARD = 20; // °F, pinned while a blizzard is active and you're wet
const WET_DRY_DECAY_PER_HOUR_F = 2.5; // dry weather: gradual, ~4 hours from 10
const WET_FIRE_DRY_HOURS = 1; // campfire/shelter: full dry from the worst case (20) in ~1 hour, regardless of outside weather

export function updateStats(
  stats: PlayerStats,
  delta: number,
  tilesMoved: number,
  biome: BiomeProperties,
  fishBiome?: BiomeProperties,
  inCanoe = false,
  ambientTempF = 70,
  warming: 'campfire' | 'shelter' | false = false,
  weatherEffects?: WeatherEffects,
  portaging = false,
  resolvedWeather?: WeatherEvent,
  unprotectedInWater = false,
): { timeTicking: boolean; forageEvents: ForageEvent[] } {
  // Hard guard: if the game is paused (delta=0) and the player isn't moving,
  // skip all stat mutations entirely. Belt-and-suspenders on top of effectiveDelta=0.
  if (delta <= 0 && tilesMoved <= MOVE_THRESHOLD) {
    return { timeTicking: false, forageEvents: [] };
  }
  const isMoving = tilesMoved > MOVE_THRESHOLD;
  const timeTicking = true; // clock runs continuously; callers pass delta=0 to pause
  const forageEvents: ForageEvent[] = [];

  const milesThisTick = tilesMoved * MILES_PER_TILE;
  stats.milesTraveled += milesThisTick;
  if (inCanoe)        stats.milesByCanoe   += milesThisTick;
  else if (portaging) stats.milesPortaging += milesThisTick;
  else                stats.milesOverland  += milesThisTick;

  if (isMoving) {
    const foodBefore = stats.food, waterBefore = stats.water;
    stats.food   = Math.max(0, stats.food   - tilesMoved * biome.foodDrainPerTile);
    stats.water  = Math.max(0, stats.water  - tilesMoved * biome.waterDrainPerTile);
    stats.foodConsumed  += foodBefore  - stats.food;
    stats.waterConsumed += waterBefore - stats.water;
    stats.energy = Math.max(0, stats.energy - tilesMoved * biome.energyDrainPerTile * (portaging ? 2.0 : 1.0));

    // Opportunistic passive gathering: occasional burst based on terrain richness.
    // Suppressed while paddling a canoe — no foraging on open water.
    if (!inCanoe) {
      if (stats.food < FOOD_CAPACITY_LBS && biome.baseResources.plants > 0 &&
          Math.random() < tilesMoved * biome.baseResources.plants * PASSIVE_GATHER_PROB) {
        stats.food = Math.min(FOOD_CAPACITY_LBS, stats.food + biome.baseResources.plants * PASSIVE_FOOD_AMOUNT_PER_RES);
        forageEvents.push({ emoji: PASSIVE_FOOD_EMOJIS[Math.floor(Math.random() * PASSIVE_FOOD_EMOJIS.length)] });
      }
      if (stats.water < WATER_CAPACITY_GAL && biome.baseResources.water > 0 &&
          Math.random() < tilesMoved * biome.baseResources.water * PASSIVE_GATHER_PROB) {
        stats.water = Math.min(WATER_CAPACITY_GAL, stats.water + biome.baseResources.water * PASSIVE_WATER_AMOUNT_PER_RES);
        forageEvents.push({ emoji: '💧' });
      }
    }
  }

  if (timeTicking) {
    // Survey is passive observation — no time passes, no stats change.
    if (stats.activeAction?.id === 'survey') return { timeTicking: false, forageEvents };

    let gameDays = delta / SECONDS_PER_DAY;

    if (stats.activeAction?.id === "rest") {
      // Speed time up so rest completes in roughly max(min(durationDays, 5), 1) real seconds,
      // at a constant linear rate regardless of warmth (cold still drains health separately below).
      const totalDays = stats.activeAction.durationDays;
      const realSecs = Math.max(Math.min(totalDays, 5), 1) * 1.5;
      gameDays = (delta * totalDays) / realSecs;
      // Sleeping in the tent (post-campfire "Rest Until Dawn") passes time
      // 25% slower than a normal rest — a cozier, less rushed night.
      if (stats.activeAction.sleepingInTent) gameDays *= 0.75;
    } else if (stats.activeAction?.id === 'build_canoe') {
      gameDays *= 4;
    }

    // Background metabolic drain — applies regardless of activity.
    { const f = stats.food, w = stats.water;
      stats.food  = Math.max(0, stats.food  - gameDays * BACKGROUND_FOOD_DRAIN_PER_DAY);
      stats.water = Math.max(0, stats.water - gameDays * BACKGROUND_WATER_DRAIN_PER_DAY);
      stats.foodConsumed  += f - stats.food;
      stats.waterConsumed += w - stats.water; }

    // Food spoilage — percentage-based with a 1 lb/day floor.
    if (stats.food > 0) {
      const before = stats.food;
      const rate = Math.max(SPOILAGE_MIN_PER_DAY, stats.food * SPOILAGE_RATE_PER_DAY);
      stats.food = Math.max(0, stats.food - gameDays * rate);
      stats.foodSpoiled += before - stats.food;
    }

    // Wet condition: gained from heavy rain/thunderstorm exposure while
    // walking, or from standing in water unprotected; makes the world feel
    // colder than it is (see effectiveAmbientTempF below) until it dries off.
    {
      const isHeavyRainOrStorm =
        !!resolvedWeather &&
        ((resolvedWeather.type === 'rain' && resolvedWeather.intensity === 3) ||
          resolvedWeather.type === 'thunderstorm');
      if (isMoving && isHeavyRainOrStorm) {
        stats.wetHoursExposure += gameDays * 24;
        if (stats.wetHoursExposure >= WET_WALK_EXPOSURE_HOURS) {
          stats.wetPenalty = Math.max(stats.wetPenalty, WET_PENALTY_DEFAULT);
        }
      } else {
        stats.wetHoursExposure = 0;
      }
      if (unprotectedInWater) {
        stats.wetPenalty = Math.max(stats.wetPenalty, WET_PENALTY_DEFAULT);
      }
      if (stats.wetPenalty > 0) {
        const isBlizzard = resolvedWeather?.type === 'blizzard';
        const isRaining =
          !!resolvedWeather && (resolvedWeather.type === 'rain' || resolvedWeather.type === 'thunderstorm');
        if (warming === 'campfire' || warming === 'shelter') {
          // Fire/shelter dries you out regardless of what's happening outside.
          stats.wetPenalty = Math.max(0, stats.wetPenalty - gameDays * 24 * (WET_PENALTY_BLIZZARD / WET_FIRE_DRY_HOURS));
        } else if (isBlizzard) {
          // Can't dry off in a blizzard — and it re-soaks you to the worst level.
          stats.wetPenalty = WET_PENALTY_BLIZZARD;
        } else if (isRaining) {
          // Can't dry off in the rain either — frozen at the current penalty.
        } else {
          stats.wetPenalty = Math.max(0, stats.wetPenalty - gameDays * 24 * WET_DRY_DECAY_PER_HOUR_F);
        }
      }
    }
    // Not the air itself changing — you just experience it as colder while wet.
    const effectiveAmbientTempF = ambientTempF - stats.wetPenalty;

    // Warmth changes only while the clock is ticking.
    if (warming === 'campfire') {
      // Fire adds warmth but cold air and weather still drain — severe cold/blizzard overwhelms a campfire
      const coldFactor = effectiveAmbientTempF < WARMTH_COMFORT_F
        ? (WARMTH_COMFORT_F - effectiveAmbientTempF) / WARMTH_COMFORT_F
        : 0;
      const drain = gameDays * coldFactor * WARMTH_DRAIN_PER_DAY_MAX * (weatherEffects?.warmthDrainMult ?? 1);
      const gain  = gameDays * WARMTH_RESTORE_PER_DAY_MAX * 10; // campfire provides strong boost
      // A lit fire warms you instantly rather than drifting up — snap straight into the Warm range.
      stats.warmth = Math.min(90, Math.max(81, Math.max(0, stats.warmth - drain + gain)));
    } else if (warming === 'shelter') {
      // Shelter blocks all outside cold and warms you instantly — snap straight into the Warm range.
      stats.warmth = Math.min(82, Math.max(81, stats.warmth + gameDays * WARMTH_RESTORE_PER_DAY_MAX * 4));
    } else if (effectiveAmbientTempF < WARMTH_COMFORT_F) {
      const coldFactor = (WARMTH_COMFORT_F - effectiveAmbientTempF) / WARMTH_COMFORT_F;
      const drainMult  = weatherEffects?.warmthDrainMult ?? 1;
      stats.warmth = Math.max(0, stats.warmth - gameDays * coldFactor * WARMTH_DRAIN_PER_DAY_MAX * drainMult);
    } else {
      const warmFactor = Math.min(1, (effectiveAmbientTempF - WARMTH_COMFORT_F) / 35);
      stats.warmth = Math.min(100, stats.warmth + gameDays * warmFactor * WARMTH_RESTORE_PER_DAY_MAX);
    }
    // Shelter protects from cold health drain — warmth recovers at its own pace inside.
    // (Health drain itself is applied below, combined with hunger/thirst.)
    const coldHealthDrainRate =
      stats.warmth < 50 && warming !== 'shelter'
        ? ((50 - stats.warmth) / 50) * WARMTH_HEALTH_DRAIN_PER_DAY
        : 0;

    stats.daysTraveled += gameDays;

    // Track travel fatigue (game-days spent moving without a full rest)
    if (isMoving) stats.daysTraveledSinceRest += gameDays;

    // Morale drains from poor conditions; recovers naturally when well-supplied.
    // Conditions use thresholds so they kick in before stats hit 0.
    let moraleDrainPerDay = 0;
    if (isMoving) moraleDrainPerDay += 4;  // baseline travel grind
    if (stats.food < 5) moraleDrainPerDay += 18;  // nearly out of food
    if (stats.water < 1) moraleDrainPerDay += 25; // nearly out of water
    // Health below 100 continuously drains morale, scaling with severity
    moraleDrainPerDay += (1 - stats.health / 100) * 20;
    if (stats.energy < 30) moraleDrainPerDay += 14; // exhausted
    // Travel fatigue: ramps up after 1 day without rest, caps at +24/day
    if (stats.daysTraveledSinceRest > 1) {
      moraleDrainPerDay += Math.min((stats.daysTraveledSinceRest - 1) * 16, 24);
    }
    // Exhaustion energy drain: kicks in after 12 hours without rest, not during rest itself
    if (stats.daysTraveledSinceRest > 0.5 && stats.activeAction?.id !== 'rest') {
      const exhaustionDrain = Math.min((stats.daysTraveledSinceRest - 0.5) * 60, 60);
      stats.energy = Math.max(0, stats.energy - gameDays * exhaustionDrain);
    }
    if (warming !== 'shelter') moraleDrainPerDay += weatherEffects?.moraleDrainPerDay ?? 0;
    stats.morale = Math.max(0, stats.morale - gameDays * moraleDrainPerDay);

    // Cold, hunger, and thirst are all "environmental" health threats — being
    // simultaneously freezing, starving, and dehydrated shouldn't kill 3x
    // faster than any one alone, so take the worst of the three rather than
    // summing them. Morale/energy/bleeding are separate, additive drains.
    const foodHealthDrainRate  = stats.food  <= 0 ? HEALTH_DRAIN_NO_FOOD_PER_DAY  : 0;
    const waterHealthDrainRate = stats.water <= 0 ? HEALTH_DRAIN_NO_WATER_PER_DAY : 0;
    const environmentalHealthDrainRate = Math.max(coldHealthDrainRate, foodHealthDrainRate, waterHealthDrainRate);
    stats.health = Math.max(0, stats.health - gameDays * environmentalHealthDrainRate);
    if (stats.morale <= 0)
      stats.health = Math.max(
        0,
        stats.health - gameDays * HEALTH_DRAIN_NO_MORALE_PER_DAY,
      );
    if (stats.energy <= 0)
      stats.health = Math.max(
        0,
        stats.health - gameDays * HEALTH_DRAIN_NO_ENERGY_PER_DAY,
      );
    if (stats.bleeding)
      stats.health = Math.max(0, stats.health - gameDays * BLEED_HEALTH_DRAIN_PER_DAY);

    // Regeneration when well-supplied: health recovers proportional to morale,
    // morale recovers proportional to health. Shelter while resting multiplies both.
    const effectivelySheltered = warming === 'shelter' || stats.activeAction?.sheltered === true;
    const shelterRestBonus = (effectivelySheltered && stats.activeAction?.id === 'rest') ? 3 : 1;
    if (stats.food > 0 && stats.water > 0 && stats.energy > 0 && stats.health > 0) {
      if (stats.health < 100)
        stats.health = Math.min(100, stats.health + gameDays * HEALTH_REGEN_PER_DAY_MAX * shelterRestBonus);
      if (stats.morale < 100)
        stats.morale = Math.min(100, stats.morale + gameDays * (0.2 + 0.8 * stats.health / 100) * MORALE_REGEN_PER_DAY_MAX * shelterRestBonus);
    }

    if (stats.activeAction) {
      stats.activeAction.progressDays += gameDays;

      if (stats.activeAction.id === 'rest') {
        { const f = stats.food, w = stats.water;
          stats.food  = Math.max(0, stats.food  - gameDays * REST_FOOD_DRAIN_PER_DAY);
          stats.water = Math.max(0, stats.water - gameDays * REST_WATER_DRAIN_PER_DAY);
          stats.foodConsumed  += f - stats.food;
          stats.waterConsumed += w - stats.water; }
        stats.energy = Math.min(100, stats.energy + gameDays * REST_ENERGY_GAIN_PER_DAY * (stats.activeAction.energyMultiplier ?? 1));

        if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
          stats.daysTraveledSinceRest = 0; // any completed rest clears fatigue
          if (stats.activeAction.durationDays >= 1) {
            stats.morale = stepMoraleUp(stats.morale); // morale bonus only for full rest
          }
          stats.activeAction = null;
        }
      } else if (stats.activeAction.id === 'forage') {
        // Foraging can continue after dark; drains food/water but slowly restores energy (lighter work than resting)
        { const f = stats.food, w = stats.water;
          stats.food  = Math.max(0, stats.food  - gameDays * FORAGE_FOOD_DRAIN_PER_DAY);
          stats.water = Math.max(0, stats.water - gameDays * FORAGE_WATER_DRAIN_PER_DAY);
          stats.foodConsumed  += f - stats.food;
          stats.waterConsumed += w - stats.water; }
        stats.energy = Math.min(100, stats.energy + gameDays * FORAGE_ENERGY_GAIN_PER_DAY);

        // Roll FORAGE_TICKS_PER_HOUR times per in-game hour
        const hoursBefore = Math.floor((stats.activeAction.progressDays - gameDays) * 24 * FORAGE_TICKS_PER_HOUR);
        const hoursNow    = Math.floor(stats.activeAction.progressDays * 24 * FORAGE_TICKS_PER_HOUR);
        if (hoursNow > hoursBefore) {
          const waterRatio = stats.water / WATER_CAPACITY_GAL;
          const foodRatio  = stats.food  / FOOD_CAPACITY_LBS;
          const needWater  = stats.water < WATER_CAPACITY_GAL;
          const needFood   = stats.food  < FOOD_CAPACITY_LBS;

          // Gather the most-needed resource first; gather both if both needed
          const forageMult = weatherEffects?.forageMult ?? 1;
          const gatherFood = () => {
            if (!needFood) return;
            if (fishBiome) {
              stats.food = Math.min(FOOD_CAPACITY_LBS, stats.food + Math.random() * fishBiome.baseResources.game * FORAGE_FISH_FACTOR * forageMult);
              forageEvents.push({ emoji: '🐟' });
            } else if (biome.forageYieldLbsPerHour > 0) {
              stats.food = Math.min(FOOD_CAPACITY_LBS, stats.food + Math.random() * 2 * biome.forageYieldLbsPerHour / FORAGE_TICKS_PER_HOUR * forageMult);
              forageEvents.push({ emoji: '🌿' });
            }
          };
          const waterBiome = fishBiome ?? biome;
          const gatherWater = () => {
            if (!needWater) return;
            stats.water = Math.min(WATER_CAPACITY_GAL, stats.water + Math.random() * 2 * waterBiome.forageWaterGalPerHour / FORAGE_TICKS_PER_HOUR * forageMult);
            forageEvents.push({ emoji: '💧' });
          };

          if (waterRatio < foodRatio) {
            gatherWater();
            gatherFood();
          } else {
            gatherFood();
            gatherWater();
          }
        }
      } else if (stats.activeAction.id === 'build_canoe' || stats.activeAction.id === 'build_shelter') {
        if (!isDaylight(stats.daysTraveled) && !stats.worklightOn) {
          stats.activeAction = null;
        } else {
          { const f = stats.food, w = stats.water;
            stats.food  = Math.max(0, stats.food  - gameDays * FORAGE_FOOD_DRAIN_PER_DAY);
            stats.water = Math.max(0, stats.water - gameDays * FORAGE_WATER_DRAIN_PER_DAY);
            stats.foodConsumed  += f - stats.food;
            stats.waterConsumed += w - stats.water; }
          if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
            stats.activeAction = null;
          }
        }
      } else if (stats.activeAction.id === 'build_campfire') {
        // Campfire can be built at night.
        { const f = stats.food, w = stats.water;
          stats.food  = Math.max(0, stats.food  - gameDays * FORAGE_FOOD_DRAIN_PER_DAY);
          stats.water = Math.max(0, stats.water - gameDays * FORAGE_WATER_DRAIN_PER_DAY);
          stats.foodConsumed  += f - stats.food;
          stats.waterConsumed += w - stats.water; }
        if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
          stats.activeAction = null;
        }
      } else if (stats.activeAction.id === 'build_deadfall') {
        if (!isDaylight(stats.daysTraveled) && !stats.worklightOn) {
          stats.activeAction = null;
        } else {
          { const f = stats.food, w = stats.water;
            stats.food  = Math.max(0, stats.food  - gameDays * FORAGE_FOOD_DRAIN_PER_DAY);
            stats.water = Math.max(0, stats.water - gameDays * FORAGE_WATER_DRAIN_PER_DAY);
            stats.foodConsumed  += f - stats.food;
            stats.waterConsumed += w - stats.water; }
          if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
            stats.activeAction = null;
          }
        }
      } else if (stats.activeAction.id === 'track_maneater') {
        if (!isDaylight(stats.daysTraveled) && !stats.worklightOn) {
          stats.activeAction = null;
        } else {
          { const f = stats.food, w = stats.water;
            stats.food  = Math.max(0, stats.food  - gameDays * FORAGE_FOOD_DRAIN_PER_DAY);
            stats.water = Math.max(0, stats.water - gameDays * FORAGE_WATER_DRAIN_PER_DAY);
            stats.foodConsumed  += f - stats.food;
            stats.waterConsumed += w - stats.water; }
          if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
            stats.activeAction = null;
          }
        }
      } else if (stats.activeAction.id === 'treat_wound') {
        if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
          stats.activeAction = null;
        }
      } else if (stats.activeAction.id === 'harvest_timber') {
        // Timber can be chopped at night.
        const hoursBefore = Math.floor((stats.activeAction.progressDays - gameDays) * 24 * FORAGE_TICKS_PER_HOUR);
        const hoursNow    = Math.floor(stats.activeAction.progressDays * 24 * FORAGE_TICKS_PER_HOUR);
        if (hoursNow > hoursBefore) {
          const gained = Math.random() * biome.baseResources.timber * HARVEST_TIMBER_FACTOR;
          forageEvents.push({ emoji: '🪵', timber: gained });
        }
      }
    }
  }

  return { timeTicking, forageEvents };
}
