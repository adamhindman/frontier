import { describe, it, expect } from 'vitest';
import type { NoiseFunction2D } from 'simplex-noise';
import { isNearSettlementSite } from './settlements';
import { createNoiseGenerators } from './noise';

const constant = (v: number): NoiseFunction2D => (() => v) as NoiseFunction2D;

// Forces getBiome() to always return 'plains' (elevation ~0.48, moisture ~0.35,
// river/lake values that stay clear of the water overrides) — a biome present in
// both SETTLEMENT_BIOMES and VILLAGE_BIOMES, so any rolled candidate tile qualifies.
const PLAINS_ELEV  = constant(-0.04); // sampleElevation -> (v+1)/2 = 0.48
const PLAINS_MOIST = constant(-0.30); // sampleMoisture  -> (v+1)/2 = 0.35
const PLAINS_RIVER = constant(0.50);  // sampleRiver -> abs(0.5)=0.5 (>=0.07, no river);
                                       // sampleLake  -> (0.5+1)/2=0.75 (<=0.78, no lake)

// Forces getBiome() to always return 'mountains' — absent from both biome sets, so
// no candidate can ever be placed regardless of the probability roll.
const MOUNTAIN_ELEV  = constant(0.6); // sampleElevation -> (0.6+1)/2 = 0.8 (mountains: 0.68-0.82)
const MOUNTAIN_MOIST = constant(0);
const MOUNTAIN_RIVER = constant(0.9);

describe('isNearSettlementSite', () => {
  it('is deterministic for the same inputs', () => {
    const gens = createNoiseGenerators('det-seed');
    const a = isNearSettlementSite('world-a', 1000, 1000, 0, 0, gens.elevation, gens.moisture, gens.river, 300);
    const b = isNearSettlementSite('world-a', 1000, 1000, 0, 0, gens.elevation, gens.moisture, gens.river, 300);
    expect(a).toBe(b);
  });

  it('always returns false when no biome in range qualifies as a settlement/village site', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const result = isNearSettlementSite(
        seed, 0, 0, 0, 0, MOUNTAIN_ELEV, MOUNTAIN_MOIST, MOUNTAIN_RIVER, 400,
      );
      expect(result).toBe(false);
    }
  });

  it('can return true when the whole search area is plains-eligible and spans many region cells', () => {
    // With every candidate biome-eligible, scanning a wide area (many independently
    // rolled region cells) should find at least one qualifying site for some seed.
    const seeds = Array.from({ length: 30 }, (_, i) => `seed-${i}`);
    const anyTrue = seeds.some(seed =>
      isNearSettlementSite(seed, 5000, 5000, 0, 0, PLAINS_ELEV, PLAINS_MOIST, PLAINS_RIVER, 600),
    );
    expect(anyTrue).toBe(true);
  });

  it('returns false for minDistanceTiles=0 when the exact region cell rolls fail (mountains)', () => {
    const result = isNearSettlementSite(
      'any-seed', 12345, 6789, 0, 0, MOUNTAIN_ELEV, MOUNTAIN_MOIST, MOUNTAIN_RIVER, 0,
    );
    expect(result).toBe(false);
  });

  it('returns false even with a large search radius when no biome ever qualifies', () => {
    const result = isNearSettlementSite(
      'any-seed', 12345, 6789, 0, 0, MOUNTAIN_ELEV, MOUNTAIN_MOIST, MOUNTAIN_RIVER, 1000,
    );
    expect(result).toBe(false);
  });
});
