import { describe, it, expect } from 'vitest';
import { getBiome } from './biomes';

// ─── Elevation thresholds ────────────────────────────────────────────────────

describe('getBiome elevation thresholds', () => {
  const midMoisture = 0.5; // neutral moisture — avoids desert/forest/swamp edges

  it('returns deep_water below 0.28', () => {
    expect(getBiome(0.00, midMoisture)).toBe('deep_water');
    expect(getBiome(0.27, midMoisture)).toBe('deep_water');
  });

  it('returns shallow_water from 0.28 to 0.38', () => {
    expect(getBiome(0.28, midMoisture)).toBe('shallow_water');
    expect(getBiome(0.37, midMoisture)).toBe('shallow_water');
  });

  it('returns beach from 0.38 to 0.42', () => {
    expect(getBiome(0.38, midMoisture)).toBe('beach');
    expect(getBiome(0.41, midMoisture)).toBe('beach');
  });

  it('returns mountains from elevation > 0.68 to 0.82', () => {
    // getBiome uses strict >, so 0.68 itself is still hills
    expect(getBiome(0.69, midMoisture)).toBe('mountains');
    expect(getBiome(0.81, midMoisture)).toBe('mountains');
  });

  it('returns snow above elevation > 0.82', () => {
    // 0.82 itself is still mountains
    expect(getBiome(0.83, midMoisture)).toBe('snow');
    expect(getBiome(1.00, midMoisture)).toBe('snow');
  });
});

// ─── Moisture-driven land biomes ─────────────────────────────────────────────

describe('getBiome moisture thresholds (mid-elevation)', () => {
  const midElev = 0.50; // inside plains/forest/desert range

  it('returns desert at very low moisture', () => {
    expect(getBiome(midElev, 0.10)).toBe('desert');
    expect(getBiome(midElev, 0.21)).toBe('desert');
  });

  it('returns plains at moderate moisture', () => {
    expect(getBiome(midElev, 0.35)).toBe('plains');
    expect(getBiome(midElev, 0.50)).toBe('plains');
  });

  it('returns forest at high moisture', () => {
    expect(getBiome(midElev, 0.55)).toBe('forest');
    expect(getBiome(midElev, 0.90)).toBe('forest');
  });

  it('returns swamp at very high moisture and low elevation', () => {
    expect(getBiome(0.45, 0.80)).toBe('swamp');
  });

  it('returns hills at mid-high elevation with low moisture', () => {
    expect(getBiome(0.60, 0.30)).toBe('hills');
  });

  it('returns forest at mid-high elevation with high moisture', () => {
    expect(getBiome(0.60, 0.60)).toBe('forest');
  });
});

// ─── River / lake overrides ───────────────────────────────────────────────────

describe('getBiome river and lake overrides', () => {
  it('returns shallow_water for a river tile in land elevation range', () => {
    // River: riverVal < 0.07, elev in [0.40, 0.65)
    expect(getBiome(0.50, 0.50, 0.05, undefined)).toBe('shallow_water');
  });

  it('does not override if elevation is out of river range', () => {
    expect(getBiome(0.70, 0.50, 0.05, undefined)).not.toBe('shallow_water');
  });

  it('does not override if riverVal is above threshold', () => {
    const biome = getBiome(0.50, 0.50, 0.10, undefined);
    expect(biome).not.toBe('shallow_water'); // should be plains
  });

  it('returns shallow_water for a lake tile in flat lowlands', () => {
    // Lake: lakeVal > 0.78, elev in [0.42, 0.52)
    expect(getBiome(0.46, 0.50, 1.0, 0.85)).toBe('shallow_water');
  });

  it('does not apply lake override if elevation is too high', () => {
    expect(getBiome(0.55, 0.50, 1.0, 0.85)).not.toBe('shallow_water');
  });

  it('river check takes priority over lake check', () => {
    // Both conditions met — river fires first
    expect(getBiome(0.46, 0.50, 0.05, 0.85)).toBe('shallow_water');
  });
});

// ─── Water detection (used by canEnterTile) ──────────────────────────────────

describe('water biome detection', () => {
  function isWater(biome: ReturnType<typeof getBiome>): boolean {
    return biome === 'deep_water' || biome === 'shallow_water';
  }

  it('ocean is water', () => {
    expect(isWater(getBiome(0.10, 0.50))).toBe(true);
  });

  it('coast is water', () => {
    expect(isWater(getBiome(0.30, 0.50))).toBe(true);
  });

  it('beach is not water', () => {
    expect(isWater(getBiome(0.40, 0.50))).toBe(false);
  });

  it('plains is not water', () => {
    expect(isWater(getBiome(0.50, 0.50))).toBe(false);
  });

  it('river tile is water', () => {
    expect(isWater(getBiome(0.50, 0.50, 0.05))).toBe(true);
  });
});
