import type { BiomeProperties } from "./biomes";

export interface StatusCondition {
  id: string;
  label: string;
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
}

export interface PlayerStats {
  health: number; // 0–100
  food: number; // lbs
  water: number; // lbs
  timber: number; // units
  minerals: number; // units
  canoes: number; // completed canoes in inventory
  morale: number; // 0–100 (displayed as adjective)
  energy: number; // 0–100
  milesTraveled: number;
  daysTraveled: number;
  daysTraveledSinceRest: number; // resets when a ≥1-day rest completes
  statusConditions: StatusCondition[];
  activeAction: ActiveAction | null;
}

export const SECONDS_PER_DAY    = 60;
export const MILES_PER_TILE     = 0.1;
export const FOOD_CAPACITY_LBS  = 30;
export const WATER_CAPACITY_GAL = 10;
export const TIMBER_CAPACITY    = 50;
export const MINERALS_CAPACITY  = 50;

export const SUNRISE = 6  / 24; // 6 AM as a day fraction
export const SUNSET  = 20 / 24; // 8 PM as a day fraction

export function isDaylight(daysTraveled: number): boolean {
  const t = daysTraveled % 1;
  return t >= SUNRISE && t < SUNSET;
}

// Passive gather: probability per tile per resource unit of triggering a find
const PASSIVE_GATHER_PROB          = 0.002;
const PASSIVE_FOOD_AMOUNT_PER_RES  = 0.25; // lbs per resource unit (0-10 scale)
const PASSIVE_WATER_AMOUNT_PER_RES = 0.20;

const PASSIVE_FOOD_EMOJIS = ['🌿', '🫐', '🌰', '🍓'] as const;

// Active forage: per resource unit per in-game hour rolled
const FORAGE_PLANTS_FACTOR  = 0.30;
const FORAGE_WATER_FACTOR   = 0.40;
const FORAGE_GAME_FACTOR    = 0.50;
const HARVEST_TIMBER_FACTOR   = 0.80;
const HARVEST_MINERALS_FACTOR = 0.60;

export type ForageEvent = { emoji: string };

const REST_FOOD_DRAIN_PER_DAY = 6; // lbs/day
const REST_WATER_DRAIN_PER_DAY = 4; // lbs/day
const REST_ENERGY_GAIN_PER_DAY = 25;

const MORALE_LEVELS = [
  { min: 0, label: "Despair" },
  { min: 21, label: "Dejected" },
  { min: 41, label: "Weary" },
  { min: 61, label: "Resolute" },
  { min: 81, label: "Elated" },
] as const;

export function getMoraleLabel(morale: number): string {
  for (let i = MORALE_LEVELS.length - 1; i >= 0; i--) {
    if (morale >= MORALE_LEVELS[i].min) return MORALE_LEVELS[i].label;
  }
  return MORALE_LEVELS[0].label;
}

function stepMoraleUp(morale: number): number {
  for (let i = 0; i < MORALE_LEVELS.length - 1; i++) {
    if (morale < MORALE_LEVELS[i + 1].min) return MORALE_LEVELS[i + 1].min;
  }
  return morale; // already Elated
}

const HEALTH_DRAIN_NO_FOOD_PER_DAY = 20; // ~5 days to die
const HEALTH_DRAIN_NO_WATER_PER_DAY = 50; // ~2 days to die
const HEALTH_DRAIN_NO_MORALE_PER_DAY = 5; // slow, more a debuff
const HEALTH_DRAIN_NO_ENERGY_PER_DAY = 10; // ~10 days to die

// Threshold below which tilesMoved is treated as zero (handles fp noise at boundaries)
const MOVE_THRESHOLD = 1e-4;

export function createStats(): PlayerStats {
  return {
    health: 100,
    food: 20,
    water: 6,
    timber: 0,
    minerals: 0,
    canoes: 1,
    morale: 100,
    energy: 100,
    milesTraveled: 0,
    daysTraveled: 9 / 24,
    daysTraveledSinceRest: 0,
    statusConditions: [],
    activeAction: null,
  };
}

// Speed penalty from carried food + water weight. 1.0 = unencumbered, floors at 0.5.
export function getWeightMultiplier(stats: PlayerStats): number {
  const totalLbs = stats.food + stats.water;
  return Math.max(0.5, 1 - totalLbs * 0.01);
}

// Returns time-tick flag and any forage events that fired this frame.
export function updateStats(
  stats: PlayerStats,
  delta: number,
  tilesMoved: number,
  biome: BiomeProperties,
): { timeTicking: boolean; forageEvents: ForageEvent[] } {
  const isMoving = tilesMoved > MOVE_THRESHOLD;
  const timeTicking = isMoving || stats.activeAction !== null;
  const forageEvents: ForageEvent[] = [];

  stats.milesTraveled += tilesMoved * MILES_PER_TILE;

  if (isMoving) {
    stats.food   = Math.max(0, stats.food   - tilesMoved * biome.foodDrainPerTile);
    stats.water  = Math.max(0, stats.water  - tilesMoved * biome.waterDrainPerTile);
    stats.energy = Math.max(0, stats.energy - tilesMoved * biome.energyDrainPerTile);

    // Opportunistic passive gathering: occasional burst based on terrain richness
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

  if (timeTicking) {
    let gameDays = delta / SECONDS_PER_DAY;

    if (stats.activeAction?.id === "rest") {
      // Speed time up so rest completes in roughly max(min(durationDays, 5), 1) real seconds.
      const totalDays = stats.activeAction.durationDays;
      const realSecs = Math.max(Math.min(totalDays, 5), 1) * 1.5;
      gameDays = (delta * totalDays) / realSecs;
    }

    stats.daysTraveled += gameDays;

    // Track travel fatigue (game-days spent moving without a full rest)
    if (isMoving) stats.daysTraveledSinceRest += gameDays;

    // Morale drains from poor conditions; only resting restores it.
    // Conditions use thresholds so they kick in before stats hit 0.
    let moraleDrainPerDay = 0;
    if (isMoving) moraleDrainPerDay += 2; // baseline travel grind
    if (stats.food < 5) moraleDrainPerDay += 10; // nearly out of food
    if (stats.water < 1) moraleDrainPerDay += 15; // nearly out of water
    if (stats.health < 50) moraleDrainPerDay += 6; // injured
    if (stats.energy < 30) moraleDrainPerDay += 8; // exhausted
    // Travel fatigue: ramps up after 0.5 days without a full rest (caps at +8/day)
    if (stats.daysTraveledSinceRest > 0.5) {
      moraleDrainPerDay += Math.min((stats.daysTraveledSinceRest - 0.5) * 2, 8);
    }
    stats.morale = Math.max(0, stats.morale - gameDays * moraleDrainPerDay);

    // Health drains when any critical stat is depleted
    if (stats.food <= 0)
      stats.health = Math.max(
        0,
        stats.health - gameDays * HEALTH_DRAIN_NO_FOOD_PER_DAY,
      );
    if (stats.water <= 0)
      stats.health = Math.max(
        0,
        stats.health - gameDays * HEALTH_DRAIN_NO_WATER_PER_DAY,
      );
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

    if (stats.activeAction) {
      stats.activeAction.progressDays += gameDays;

      if (stats.activeAction.id === 'rest') {
        stats.food   = Math.max(0,   stats.food   - gameDays * REST_FOOD_DRAIN_PER_DAY);
        stats.water  = Math.max(0,   stats.water  - gameDays * REST_WATER_DRAIN_PER_DAY);
        stats.energy = Math.min(100, stats.energy + gameDays * REST_ENERGY_GAIN_PER_DAY);

        if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
          if (stats.activeAction.durationDays >= 1) {
            stats.daysTraveledSinceRest = 0;
            stats.morale = stepMoraleUp(stats.morale);
          }
          stats.activeAction = null;
        }
      } else if (stats.activeAction.id === 'forage' || stats.activeAction.id === 'hunt') {
        // Auto-stop at sunset
        if (!isDaylight(stats.daysTraveled)) {
          stats.activeAction = null;
        } else {
          // Roll once per elapsed in-game hour
          const hoursBefore = Math.floor((stats.activeAction.progressDays - gameDays) * 24);
          const hoursNow    = Math.floor(stats.activeAction.progressDays * 24);
          if (hoursNow > hoursBefore) {
            if (stats.activeAction.id === 'forage') {
              if (stats.food < FOOD_CAPACITY_LBS) {
                stats.food = Math.min(FOOD_CAPACITY_LBS, stats.food + Math.random() * biome.baseResources.plants * FORAGE_PLANTS_FACTOR);
                forageEvents.push({ emoji: '🌿' });
              }
              if (stats.water < WATER_CAPACITY_GAL) {
                stats.water = Math.min(WATER_CAPACITY_GAL, stats.water + Math.random() * biome.baseResources.water * FORAGE_WATER_FACTOR);
                forageEvents.push({ emoji: '💧' });
              }
            } else if (stats.activeAction.id === 'hunt' && stats.food < FOOD_CAPACITY_LBS) {
              stats.food = Math.min(FOOD_CAPACITY_LBS, stats.food + Math.random() * biome.baseResources.game * FORAGE_GAME_FACTOR);
              forageEvents.push({ emoji: '🍖' });
            }
          }
        }
      } else if (stats.activeAction.id === 'build_canoe' || stats.activeAction.id === 'build_shelter') {
        if (!isDaylight(stats.daysTraveled)) {
          stats.activeAction = null;
        } else {
          if (stats.activeAction.timberPerHour) {
            const hoursBefore = Math.floor((stats.activeAction.progressDays - gameDays) * 24);
            const hoursNow    = Math.floor(stats.activeAction.progressDays * 24);
            if (hoursNow > hoursBefore) {
              stats.timber = Math.max(0, stats.timber - stats.activeAction.timberPerHour);
            }
          }
          if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
            stats.activeAction = null; // completion side-effect handled by caller via prevAction
          }
        }
      } else if (stats.activeAction.id === 'harvest_timber' || stats.activeAction.id === 'harvest_minerals') {
        if (!isDaylight(stats.daysTraveled)) {
          stats.activeAction = null;
        } else {
          const hoursBefore = Math.floor((stats.activeAction.progressDays - gameDays) * 24);
          const hoursNow    = Math.floor(stats.activeAction.progressDays * 24);
          if (hoursNow > hoursBefore) {
            if (stats.activeAction.id === 'harvest_timber' && stats.timber < TIMBER_CAPACITY) {
              stats.timber = Math.min(TIMBER_CAPACITY, stats.timber + Math.random() * biome.baseResources.timber * HARVEST_TIMBER_FACTOR);
              forageEvents.push({ emoji: '🪵' });
            } else if (stats.activeAction.id === 'harvest_minerals' && stats.minerals < MINERALS_CAPACITY) {
              stats.minerals = Math.min(MINERALS_CAPACITY, stats.minerals + Math.random() * biome.baseResources.minerals * HARVEST_MINERALS_FACTOR);
              forageEvents.push({ emoji: '🪨' });
            }
          }
        }
      }
    }
  }

  return { timeTicking, forageEvents };
}
