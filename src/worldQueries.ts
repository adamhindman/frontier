import { type NoiseFunction2D } from 'simplex-noise';
import { sampleElevation, sampleMoisture, sampleRiver, sampleLake } from './noise';
import { getBiome, BIOMES, type BiomeProperties } from './biomes';

// ── World sampler factory ─────────────────────────────────────────────────────

// Creates tile-sampling helpers bound to a specific set of noise generators.
// Returns getBiomeAt, isWaterBiome, and adjacentWaterBiome — suitable for
// destructuring in main.ts or passing as callbacks to other managers.
export function createWorldQueries(
  elevation: NoiseFunction2D,
  moisture: NoiseFunction2D,
  river: NoiseFunction2D,
) {
  function getBiomeAt(tx: number, ty: number): string {
    return getBiome(
      sampleElevation(tx, ty, elevation),
      sampleMoisture(tx, ty, moisture),
      sampleRiver(tx, ty, river),
      sampleLake(tx, ty, river),
    );
  }

  function isWaterBiome(tx: number, ty: number): boolean {
    const b = getBiomeAt(tx, ty);
    return b === 'deep_water' || b === 'shallow_water';
  }

  function adjacentWaterBiome(tx: number, ty: number): BiomeProperties | null {
    for (let ddx = -1; ddx <= 1; ddx++) {
      for (let ddy = -1; ddy <= 1; ddy++) {
        if (ddx === 0 && ddy === 0) continue;
        const b = getBiomeAt(tx + ddx, ty + ddy);
        if (b === 'deep_water' || b === 'shallow_water') return BIOMES[b];
      }
    }
    return null;
  }

  return { getBiomeAt, isWaterBiome, adjacentWaterBiome };
}

// ── Pure logic ────────────────────────────────────────────────────────────────

// ── Temperature ───────────────────────────────────────────────────────────────

// Returns ambient °F given a pre-sampled biome, elevation, and fractional day.
// Coldest at midnight (dayFrac=0), warmest at noon (dayFrac=0.5).
export function computeAmbientTemp(biome: string, elev: number, dayFrac: number): number {
  const timeMod = -Math.cos(dayFrac * Math.PI * 2) * 22; // -22 at midnight, +22 at noon
  const elevMod = -(elev - 0.5) * 45;                    // -22.5 at peaks, +22.5 in valleys

  let baseTemp: number;
  if      (biome === 'desert')        baseTemp = 88;
  else if (biome === 'beach')         baseTemp = 60;
  else if (biome === 'swamp')         baseTemp = 50;
  else if (biome === 'deep_water')    baseTemp = 40;
  else if (biome === 'shallow_water') baseTemp = 44;
  else baseTemp = 62 - Math.max(0, elev - 0.38) * 70; // plains → hills → mountains → snow

  return baseTemp + timeMod + elevMod;
}

// ── Wading ────────────────────────────────────────────────────────────────────

// Returns true if the current tile (shallow water) is close enough to shore to wade.
// wadeRadius: 1 (default) or 3 (hip waders).
// isNeighborWater: callback returning true when the offset tile IS water.
export function canWadeShallowWater(
  wadeRadius: number,
  isNeighborWater: (ddx: number, ddy: number) => boolean,
): boolean {
  for (let ddx = -wadeRadius; ddx <= wadeRadius; ddx++) {
    for (let ddy = -wadeRadius; ddy <= wadeRadius; ddy++) {
      if (ddx === 0 && ddy === 0) continue;
      if (!isNeighborWater(ddx, ddy)) return true;
    }
  }
  return false;
}
