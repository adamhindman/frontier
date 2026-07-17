import { describe, it, expect } from 'vitest';
import { computeAmbientTemp, canWadeShallowWater } from './worldQueries';

// ─── computeAmbientTemp ───────────────────────────────────────────────────────

describe('computeAmbientTemp', () => {
  const NOON     = 0.5;  // dayFrac = 0.5 → timeMod = +22 (warmest)
  const MIDNIGHT = 0.0;  // dayFrac = 0.0 → timeMod = -22 (coldest)
  const MID_ELEV = 0.5;  // elevMod = 0

  it('noon is warmer than midnight for all biomes', () => {
    for (const biome of ['plains', 'forest', 'hills', 'desert', 'snow', 'beach', 'deep_water']) {
      expect(computeAmbientTemp(biome, MID_ELEV, NOON))
        .toBeGreaterThan(computeAmbientTemp(biome, MID_ELEV, MIDNIGHT));
    }
  });

  it('noon-to-midnight delta is exactly 44°F', () => {
    const diff = computeAmbientTemp('plains', MID_ELEV, NOON)
               - computeAmbientTemp('plains', MID_ELEV, MIDNIGHT);
    expect(diff).toBeCloseTo(44, 5);
  });

  // ── Special biome base temperatures ─────────────────────────────────────────

  it('desert base temp is 88°F (110 at noon, mid-elevation)', () => {
    // 88 + 22 timeMod + 0 elevMod = 110
    expect(computeAmbientTemp('desert', MID_ELEV, NOON)).toBeCloseTo(110, 5);
  });

  it('beach base temp is 60°F (82 at noon, mid-elevation)', () => {
    expect(computeAmbientTemp('beach', MID_ELEV, NOON)).toBeCloseTo(82, 5);
  });

  it('swamp base temp is 50°F (72 at noon, mid-elevation)', () => {
    expect(computeAmbientTemp('swamp', MID_ELEV, NOON)).toBeCloseTo(72, 5);
  });

  it('deep_water base temp is 40°F (62 at noon, mid-elevation)', () => {
    expect(computeAmbientTemp('deep_water', MID_ELEV, NOON)).toBeCloseTo(62, 5);
  });

  it('shallow_water base temp is 44°F (66 at noon, mid-elevation)', () => {
    expect(computeAmbientTemp('shallow_water', MID_ELEV, NOON)).toBeCloseTo(66, 5);
  });

  // ── Elevation curve for land biomes ─────────────────────────────────────────

  it('higher elevation is colder for non-special biomes', () => {
    expect(computeAmbientTemp('plains', 0.8, NOON))
      .toBeLessThan(computeAmbientTemp('plains', 0.4, NOON));
  });

  it('plains at noon mid-elevation: 62 - (0.5-0.38)*70 + 22 = 75.6°F', () => {
    // base = 62 - 0.12*70 = 53.6; timeMod = +22; elevMod = 0
    expect(computeAmbientTemp('plains', 0.5, NOON)).toBeCloseTo(75.6, 5);
  });

  it('snow at high elevation is below freezing even at noon', () => {
    // base = 62 - (0.9-0.38)*70 = 25.6; timeMod = +22; elevMod = -(0.9-0.5)*45 = -18 → 29.6
    expect(computeAmbientTemp('snow', 0.9, NOON)).toBeCloseTo(29.6, 5);
  });

  it('unknown biome falls through to elevation curve', () => {
    // 'hills' uses the plain elevation formula
    const base = 62 - Math.max(0, MID_ELEV - 0.38) * 70;
    expect(computeAmbientTemp('hills', MID_ELEV, NOON)).toBeCloseTo(base + 22, 5);
  });
});

// ─── canWadeShallowWater ─────────────────────────────────────────────────────

describe('canWadeShallowWater', () => {
  it('returns false when all neighbors within radius are water', () => {
    expect(canWadeShallowWater(1, () => true)).toBe(false);
  });

  it('returns true when at least one immediate neighbor is land', () => {
    const isWater = (ddx: number, ddy: number) => !(ddx === 1 && ddy === 0);
    expect(canWadeShallowWater(1, isWater)).toBe(true);
  });

  it('returns false with radius 1 when land is 2 tiles away', () => {
    // Chebyshev distance ≤ 1 is all water; land only at distance 2+
    const isWater = (ddx: number, ddy: number) => Math.max(Math.abs(ddx), Math.abs(ddy)) <= 1;
    expect(canWadeShallowWater(1, isWater)).toBe(false);
  });

  it('returns true with radius 3 when land is 2 tiles away', () => {
    // Hip-wader extension: reaches land at distance 2
    const isWater = (ddx: number, ddy: number) => Math.max(Math.abs(ddx), Math.abs(ddy)) <= 1;
    expect(canWadeShallowWater(3, isWater)).toBe(true);
  });

  it('returns false with radius 3 when all neighbors within 3 tiles are water', () => {
    expect(canWadeShallowWater(3, () => true)).toBe(false);
  });

  it('skips the center tile (0,0) in the search', () => {
    // The callback returns false only for (0,0) — if center were checked, it would return true
    const isWater = (ddx: number, ddy: number) => !(ddx === 0 && ddy === 0);
    expect(canWadeShallowWater(1, isWater)).toBe(false);
  });
});
