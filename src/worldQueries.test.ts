import { describe, it, expect } from 'vitest';
import { computeAmbientTemp, canWadeShallowWater, compassLabel, formatApproxLocation, formatApproxLocationCompact, formatElapsedGameTime } from './worldQueries';

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

// ─── compassLabel ────────────────────────────────────────────────────────────

describe('compassLabel', () => {
  it('maps the 16 exact compass points', () => {
    const expected = [
      'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
    ];
    expected.forEach((label, i) => {
      expect(compassLabel(i * 22.5)).toBe(label);
    });
  });

  it('rounds to the nearest compass point', () => {
    expect(compassLabel(10)).toBe('N');
    expect(compassLabel(12)).toBe('NNE');
  });

  it('wraps negative degrees into range', () => {
    expect(compassLabel(-10)).toBe('N');
  });

  it('wraps degrees greater than 360 into range', () => {
    expect(compassLabel(370)).toBe('N');
  });

  it('wraps a value that rounds up to 360 back to N', () => {
    expect(compassLabel(359)).toBe('N');
  });
});

// ─── formatApproxLocation ────────────────────────────────────────────────────

describe('formatApproxLocation', () => {
  it('formats miles and compass direction, with degrees hidden', () => {
    // 94.7 -> 95 mi; 16 -> nearest 5 is 15 -> NNE
    expect(formatApproxLocation(94.7, 16)).toBe('About 95 mi NNE');
  });

  it('rounds miles to the nearest whole number', () => {
    expect(formatApproxLocation(12.4, 0)).toBe('About 12 mi N');
    expect(formatApproxLocation(12.5, 0)).toBe('About 13 mi N');
  });

  it('wraps a bearing that rounds up to 360 back to N', () => {
    expect(formatApproxLocation(10, 358)).toBe('About 10 mi N');
  });

  it('normalizes negative bearings', () => {
    expect(formatApproxLocation(10, -5)).toBe('About 10 mi N');
  });

  it('handles zero miles', () => {
    expect(formatApproxLocation(0, 90)).toBe('About 0 mi E');
  });
});

// ─── formatApproxLocationCompact ─────────────────────────────────────────────

describe('formatApproxLocationCompact', () => {
  it('formats direction with degrees hidden', () => {
    expect(formatApproxLocationCompact(2.6, 34)).toBe('About 3 mi NE');
  });

  it('rounds miles to the nearest whole number', () => {
    expect(formatApproxLocationCompact(12.4, 0)).toBe('About 12 mi N');
    expect(formatApproxLocationCompact(12.5, 0)).toBe('About 13 mi N');
  });

  it('wraps a bearing that rounds up to 360 back to N', () => {
    expect(formatApproxLocationCompact(10, 358)).toBe('About 10 mi N');
  });

  it('normalizes negative bearings', () => {
    expect(formatApproxLocationCompact(10, -5)).toBe('About 10 mi N');
  });
});

// ─── formatElapsedGameTime ───────────────────────────────────────────────────

describe('formatElapsedGameTime', () => {
  it('reads as "moments ago" under half an hour', () => {
    expect(formatElapsedGameTime(0)).toBe('moments ago');
    expect(formatElapsedGameTime(0.2 / 24)).toBe('moments ago');
  });

  it('formats singular vs plural hours', () => {
    expect(formatElapsedGameTime(1 / 24)).toBe('1 hour');
    expect(formatElapsedGameTime(2 / 24)).toBe('2 hours');
  });

  it('rounds hours to the nearest whole hour', () => {
    expect(formatElapsedGameTime(1.4 / 24)).toBe('1 hour');
    expect(formatElapsedGameTime(1.6 / 24)).toBe('2 hours');
  });

  it('switches to days at 24 hours', () => {
    expect(formatElapsedGameTime(1)).toBe('1 day');
    expect(formatElapsedGameTime(2)).toBe('2 days');
  });

  it('rounds days to the nearest whole day', () => {
    expect(formatElapsedGameTime(1.4)).toBe('1 day');
    expect(formatElapsedGameTime(1.6)).toBe('2 days');
  });
});
