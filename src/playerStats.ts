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
}

export interface PlayerStats {
  health: number; // 0–100
  food: number; // lbs
  water: number; // lbs
  morale: number; // 0–100 (displayed as adjective)
  energy: number; // 0–100
  milesTraveled: number;
  daysTraveled: number;
  daysTraveledSinceRest: number; // resets when a ≥1-day rest completes
  statusConditions: StatusCondition[];
  activeAction: ActiveAction | null;
}

export const SECONDS_PER_DAY = 60;
export const MILES_PER_TILE = 0.1;
export const FOOD_CAPACITY_LBS = 30; // bar maximum
export const WATER_CAPACITY_LBS = 10; // bar maximum

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
    food: 20, // lbs
    water: 6, // lbs
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

// Returns true if game time advanced this frame (used to drive the clock indicator).
export function updateStats(
  stats: PlayerStats,
  delta: number,
  tilesMoved: number,
  biome: BiomeProperties,
): boolean {
  const isMoving = tilesMoved > MOVE_THRESHOLD;
  const timeTicking = isMoving || stats.activeAction !== null;

  stats.milesTraveled += tilesMoved * MILES_PER_TILE;

  if (isMoving) {
    stats.food = Math.max(0, stats.food - tilesMoved * biome.foodDrainPerTile);
    stats.water = Math.max(
      0,
      stats.water - tilesMoved * biome.waterDrainPerTile,
    );
    stats.energy = Math.max(
      0,
      stats.energy - tilesMoved * biome.energyDrainPerTile,
    );
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

      if (stats.activeAction.id === "rest") {
        stats.food = Math.max(
          0,
          stats.food - gameDays * REST_FOOD_DRAIN_PER_DAY,
        );
        stats.water = Math.max(
          0,
          stats.water - gameDays * REST_WATER_DRAIN_PER_DAY,
        );
        stats.energy = Math.min(
          100,
          stats.energy + gameDays * REST_ENERGY_GAIN_PER_DAY,
        );
      }

      if (stats.activeAction.progressDays >= stats.activeAction.durationDays) {
        if (
          stats.activeAction.id === "rest" &&
          stats.activeAction.durationDays >= 1
        ) {
          stats.daysTraveledSinceRest = 0;
          stats.morale = stepMoraleUp(stats.morale);
        }
        stats.activeAction = null;
      }
    }
  }

  return timeTicking;
}
