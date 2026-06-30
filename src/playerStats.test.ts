import { describe, it, expect } from 'vitest';
import type { BiomeProperties } from './biomes';
import {
  getMoraleLabel, getWeightMultiplier, createStats, updateStats,
  FOOD_CAPACITY_LBS, WATER_CAPACITY_GAL, MINERALS_CAPACITY,
  SECONDS_PER_DAY,
} from './playerStats';

// Minimal biome for use in updateStats tests
const plainsBiome: BiomeProperties = {
  color: '#6aaa38', elevMin: 0.42, elevMax: 0.55, speedMultiplier: 1.0,
  baseResources: { plants: 6, game: 5, water: 3, timber: 2, minerals: 2 },
  foodDrainPerTile: 0.06, waterDrainPerTile: 0.006, energyDrainPerTile: 0.3,
  baseTemp: 65, surveyVisibilityMult: 1.0,
  forageYieldLbsPerHour: 0.075, forageWaterGalPerHour: 0.40,
};

// Zero-resource biome: passive gather never triggers, safe for floor tests
const barrenBiome: BiomeProperties = {
  ...plainsBiome,
  baseResources: { plants: 0, game: 0, water: 0, timber: 0, minerals: 0 },
};

// ─── getMoraleLabel ──────────────────────────────────────────────────────────

describe('getMoraleLabel', () => {
  it('returns Despair for 0',   () => expect(getMoraleLabel(0)).toBe('Despair'));
  it('returns Despair for 20',  () => expect(getMoraleLabel(20)).toBe('Despair'));
  it('returns Ruined for 21',   () => expect(getMoraleLabel(21)).toBe('Ruined'));
  it('returns Ruined for 40',   () => expect(getMoraleLabel(40)).toBe('Ruined'));
  it('returns Weary for 41',    () => expect(getMoraleLabel(41)).toBe('Weary'));
  it('returns Weary for 60',    () => expect(getMoraleLabel(60)).toBe('Weary'));
  it('returns Resolute for 61', () => expect(getMoraleLabel(61)).toBe('Resolute'));
  it('returns Resolute for 80', () => expect(getMoraleLabel(80)).toBe('Resolute'));
  it('returns Elated for 81',   () => expect(getMoraleLabel(81)).toBe('Elated'));
  it('returns Elated for 100',  () => expect(getMoraleLabel(100)).toBe('Elated'));
});

// ─── getWeightMultiplier ─────────────────────────────────────────────────────

describe('getWeightMultiplier', () => {
  it('is 1.0 when carrying nothing', () => {
    const stats = createStats();
    stats.food = 0; stats.water = 0;
    expect(getWeightMultiplier(stats)).toBe(1.0);
  });

  it('decreases as food + water weight increases', () => {
    const stats = createStats();
    stats.food = 20; stats.water = 6; // 26 total → 1 - 0.26 = 0.74
    expect(getWeightMultiplier(stats)).toBeCloseTo(0.74);
  });

  it('floors at 0.5', () => {
    const stats = createStats();
    stats.food = 100; stats.water = 100;
    expect(getWeightMultiplier(stats)).toBe(0.5);
  });

  it('is unaffected by minerals', () => {
    const stats = createStats();
    stats.food = 0; stats.water = 0;
    stats.minerals = MINERALS_CAPACITY;
    expect(getWeightMultiplier(stats)).toBe(1.0);
  });
});

// ─── createStats ─────────────────────────────────────────────────────────────

describe('createStats', () => {
  it('initializes all resource fields', () => {
    const stats = createStats();
    expect(stats.minerals).toBe(0);
    expect(stats.health).toBe(100);
    expect(stats.energy).toBe(100);
    expect(stats.morale).toBe(100);
  });

  it('starts with no active action or status conditions', () => {
    const stats = createStats();
    expect(stats.activeAction).toBeNull();
    expect(stats.statusConditions).toHaveLength(0);
  });

  it('starts at 9 AM (daysTraveled = 9/24)', () => {
    const stats = createStats();
    expect(stats.daysTraveled).toBeCloseTo(9 / 24);
  });
});

// ─── updateStats — movement drain ────────────────────────────────────────────

describe('updateStats movement drain', () => {
  it('drains food and water proportional to tiles moved', () => {
    const stats = createStats();
    stats.food = 20; stats.water = 6;
    // Move 10 tiles, no active action, daytime
    stats.daysTraveled = 12 / 24; // noon
    updateStats(stats, 0, 10, plainsBiome);
    expect(stats.food).toBeCloseTo(20 - 10 * plainsBiome.foodDrainPerTile, 5);
    expect(stats.water).toBeCloseTo(6 - 10 * plainsBiome.waterDrainPerTile, 5);
  });

  it('does not drain below zero', () => {
    const stats = createStats();
    stats.food = 0; stats.water = 0;
    stats.daysTraveled = 12 / 24;
    // Use barrenBiome so passive gather never refills food/water
    updateStats(stats, 0, 100, barrenBiome);
    expect(stats.food).toBe(0);
    expect(stats.water).toBe(0);
  });
});

// ─── updateStats — build action ───────────────────────────────────────────────

describe('updateStats build action', () => {
  it('advances progressDays while building', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24; // noon (daylight)
    stats.activeAction = {
      id: 'build_canoe',
      label: 'Building canoe',
      durationDays: 1,
      progressDays: 0,
      structureIndex: 0,
      timberPerHour: 10 / 24,
    };

    const oneHourDelta = SECONDS_PER_DAY / 24;
    updateStats(stats, oneHourDelta, 0, plainsBiome);

    // build_canoe runs 4× accelerated, so 1/24 real game-day → 4/24 progress
    expect(stats.activeAction?.progressDays).toBeCloseTo(4 / 24, 4);
  });

  it('nulls the action when progressDays reaches durationDays', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.activeAction = {
      id: 'build_canoe',
      label: 'Building canoe',
      durationDays: 1 / 24, // 1 game-hour total
      progressDays: 0,
      structureIndex: 0,
      timberPerHour: 10 / 24,
    };

    updateStats(stats, SECONDS_PER_DAY / 24 + 0.1, 0, plainsBiome);

    expect(stats.activeAction).toBeNull();
  });

  it('stops the build action at night', () => {
    const stats = createStats();
    stats.daysTraveled = 20 / 24; // 8 PM — just at sunset
    stats.activeAction = {
      id: 'build_shelter',
      label: 'Building shelter',
      durationDays: 8 / 24,
      progressDays: 0,
      structureIndex: 0,
      timberPerHour: 25 / 8,
    };

    updateStats(stats, 0.016, 0, plainsBiome); // one frame at sunset

    expect(stats.activeAction).toBeNull();
  });

  it('drains food and water while building', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 20; stats.water = 5;
    stats.activeAction = {
      id: 'build_canoe',
      label: 'Building canoe',
      durationDays: 1,
      progressDays: 0,
      structureIndex: 0,
      timberPerHour: 10 / 24,
    };

    // Use 1/8 day (~3 hours) so we stay well before sunset
    updateStats(stats, SECONDS_PER_DAY / 8, 0, barrenBiome);

    expect(stats.food).toBeLessThan(20);
    expect(stats.water).toBeLessThan(5);
  });
});

// ─── updateStats — forage action ─────────────────────────────────────────────

describe('updateStats forage action', () => {
  it('stops at sunset', () => {
    const stats = createStats();
    stats.daysTraveled = 20 / 24; // 8 PM — sunset
    stats.activeAction = { id: 'forage', label: 'Foraging', durationDays: Infinity, progressDays: 0 };

    updateStats(stats, 0.016, 0, barrenBiome);

    expect(stats.activeAction).toBeNull();
  });

  it('drains food and water continuously while foraging', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 20; stats.water = 5;
    stats.activeAction = { id: 'forage', label: 'Foraging', durationDays: Infinity, progressDays: 0 };

    updateStats(stats, SECONDS_PER_DAY / 4, 0, barrenBiome); // 6 game-hours

    expect(stats.food).toBeLessThan(20);
    expect(stats.water).toBeLessThan(5);
  });

  it('gains food per hour from plant resources', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 0;
    stats.activeAction = { id: 'forage', label: 'Foraging', durationDays: Infinity, progressDays: 0 };

    // Advance past one full in-game hour so the hourly roll fires
    updateStats(stats, SECONDS_PER_DAY / 24 + 0.1, 0, plainsBiome);

    expect(stats.food).toBeGreaterThan(0);
  });

  it('fishes when a water biome is adjacent (fishBiome provided)', () => {
    const waterBiome: BiomeProperties = {
      ...plainsBiome,
      baseResources: { plants: 0, game: 5, water: 9, timber: 0, minerals: 0 },
    };
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 0;
    stats.activeAction = { id: 'forage', label: 'Foraging', durationDays: Infinity, progressDays: 0 };

    // barrenBiome as land tile, waterBiome as adjacent water
    updateStats(stats, SECONDS_PER_DAY / 24 + 0.1, 0, barrenBiome, waterBiome);

    expect(stats.food).toBeGreaterThan(0);
  });
});

// ─── createStats — new fields ────────────────────────────────────────────────

describe('createStats new fields', () => {
  it('initializes rifleAmmo to 999', () => {
    expect(createStats().rifleAmmo).toBe(999);
  });

  it('initializes pelts to 0', () => {
    expect(createStats().pelts).toBe(0);
  });

  it('initializes all mileage breakdown fields to 0', () => {
    const stats = createStats();
    expect(stats.milesOverland).toBe(0);
    expect(stats.milesPortaging).toBe(0);
    expect(stats.milesByCanoe).toBe(0);
  });

  it('initializes foodSpoiled to 0', () => {
    expect(createStats().foodSpoiled).toBe(0);
  });
});

// ─── updateStats — food spoilage ─────────────────────────────────────────────

describe('updateStats food spoilage', () => {
  it('reduces food each time-tick', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 10;

    updateStats(stats, SECONDS_PER_DAY / 4, 0, barrenBiome); // 0.25 days

    expect(stats.food).toBeLessThan(10);
  });

  it('accumulates foodSpoiled', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 10;
    stats.foodSpoiled = 0;

    updateStats(stats, SECONDS_PER_DAY / 4, 0, barrenBiome);

    expect(stats.foodSpoiled).toBeGreaterThan(0);
  });

  it('applies 10% rate when food is high enough for rate to exceed 1 lb/day floor', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 20; // 10% = 2 lb/day — above the 1 lb floor

    updateStats(stats, SECONDS_PER_DAY, 0, barrenBiome); // 1 full game-day

    // Expected spoilage: 10% of 20 = 2 lb — but food also drains from background metabolic,
    // so just verify spoiled is in the 10%-ish range (not at the 1 lb floor)
    expect(stats.foodSpoiled).toBeGreaterThan(1.5);
  });

  it('applies 1 lb/day floor when food is too low for 10% to exceed it', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 5; // 10% = 0.5 lb/day — below the 1 lb floor

    // Use 0.5 days so expected floor spoilage is ~0.5 lb
    updateStats(stats, SECONDS_PER_DAY / 2, 0, barrenBiome);

    expect(stats.foodSpoiled).toBeGreaterThan(0.3); // well above zero (floor was applied)
  });

  it('does not spoil food when food is 0', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.food = 0;
    stats.foodSpoiled = 0;

    updateStats(stats, SECONDS_PER_DAY, 0, barrenBiome);

    expect(stats.foodSpoiled).toBe(0);
  });
});

// ─── updateStats — mileage breakdown ─────────────────────────────────────────

describe('updateStats mileage breakdown', () => {
  it('counts overland miles when not in canoe and not portaging', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    const before = stats.milesOverland;

    updateStats(stats, 0, 10, barrenBiome, undefined, false, 70, false, undefined, false);

    expect(stats.milesOverland).toBeGreaterThan(before);
    expect(stats.milesPortaging).toBe(0);
    expect(stats.milesByCanoe).toBe(0);
  });

  it('counts portaging miles when portaging flag is true', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;

    updateStats(stats, 0, 10, barrenBiome, undefined, false, 70, false, undefined, true);

    expect(stats.milesPortaging).toBeGreaterThan(0);
    expect(stats.milesOverland).toBe(0);
    expect(stats.milesByCanoe).toBe(0);
  });

  it('counts canoe miles when inCanoe is true', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;

    updateStats(stats, 0, 10, barrenBiome, undefined, true, 70, false, undefined, false);

    expect(stats.milesByCanoe).toBeGreaterThan(0);
    expect(stats.milesOverland).toBe(0);
    expect(stats.milesPortaging).toBe(0);
  });

  it('total milesTraveled equals sum of breakdown fields', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;

    updateStats(stats, 0, 5, barrenBiome, undefined, false);   // overland
    updateStats(stats, 0, 3, barrenBiome, undefined, true);    // canoe
    updateStats(stats, 0, 2, barrenBiome, undefined, false, 70, false, undefined, true); // portaging

    expect(stats.milesTraveled).toBeCloseTo(
      stats.milesOverland + stats.milesPortaging + stats.milesByCanoe, 5
    );
  });
});

// ─── updateStats — warmth during rest ────────────────────────────────────────

describe('updateStats warmth during rest', () => {
  it('restores warmth to near 82 after resting in a shelter (warmth ≥ 50 so rest is time-accelerated)', () => {
    const stats = createStats();
    stats.daysTraveled = 20 / 24; // 8 PM
    stats.warmth = 60; // Warm enough for rest-time acceleration
    // Half-day rest: accelerated; realSecs = max(min(0.5,5),1)*1.5 = 1.5s
    // So delta=1.5s → gameDays = (1.5 * 0.5) / 1.5 = 0.5 days
    stats.activeAction = { id: 'rest', label: 'Resting', durationDays: 0.5, progressDays: 0 };

    updateStats(stats, 1.5, 0, barrenBiome, undefined, false, 28, 'shelter');

    expect(stats.warmth).toBeCloseTo(82, 0);
  });

  it('still loses warmth in the cold when resting without shelter or fire', () => {
    const stats = createStats();
    stats.daysTraveled = 20 / 24;
    stats.warmth = 80;
    stats.activeAction = { id: 'rest', label: 'Resting', durationDays: 0.5, progressDays: 0 };

    updateStats(stats, 1.5, 0, barrenBiome, undefined, false, 28, false);

    expect(stats.warmth).toBeLessThan(80);
  });
});

// ─── updateStats — health and morale regeneration ────────────────────────────

describe('updateStats regeneration', () => {
  // Regen runs inside the timeTicking block, so movement is needed to advance time.
  const slowMove = 0.01; // above MOVE_THRESHOLD (1e-4), negligible drain on barrenBiome

  it('heals health when food, water, and energy are all above 0', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.health = 50; stats.morale = 100;
    stats.food = 15; stats.water = 3; stats.energy = 80;

    updateStats(stats, SECONDS_PER_DAY / 4, slowMove, barrenBiome);

    expect(stats.health).toBeGreaterThan(50);
  });

  it('does not heal when food is 0', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.health = 80;
    stats.food = 0; stats.water = 3; stats.energy = 80;

    updateStats(stats, SECONDS_PER_DAY / 4, slowMove, barrenBiome);

    expect(stats.health).toBeLessThan(80); // health drains due to no food
  });

  it('increases morale when food, water, and energy are all above 0', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.morale = 40; stats.health = 100;
    stats.food = 15; stats.water = 3; stats.energy = 80;

    updateStats(stats, SECONDS_PER_DAY / 4, slowMove, barrenBiome);

    expect(stats.morale).toBeGreaterThan(40);
  });

  it('does not increase morale when water is 0', () => {
    const stats = createStats();
    stats.daysTraveled = 12 / 24;
    stats.morale = 40;
    stats.food = 15; stats.water = 0; stats.energy = 80;

    updateStats(stats, SECONDS_PER_DAY / 4, slowMove, barrenBiome);

    expect(stats.morale).toBeLessThanOrEqual(40);
  });
});
