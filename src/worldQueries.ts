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

// ── Compass / approximate location ─────────────────────────────────────────────

export const COMPASS_DIRS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

// 16-point compass label for a bearing in degrees (0 = north, clockwise).
export function compassLabel(bearingDeg: number): string {
  const norm = ((bearingDeg % 360) + 360) % 360;
  return COMPASS_DIRS[Math.round(norm / 22.5) % 16];
}

// Degree figures are hidden from all location readouts for now (compass point
// alone reads cleaner) but the computation is kept intact behind this flag so
// it's a one-line flip to bring them back.
const SHOW_DEGREES = false;

// Every in-world location clue (ruins, capital, man-eater tracks, named survey
// pins, the lodestone, ...) reports distance and bearing as an estimate rather
// than precise surveying data: miles rounded to the nearest whole mile,
// bearing rounded to the nearest 5°. e.g. (94.7, 16) -> "About 95 mi 15° NNE".
export function formatApproxLocation(miles: number, bearingDeg: number): string {
  const roundedMiles = Math.round(miles);
  const norm = ((bearingDeg % 360) + 360) % 360;
  const roundedDeg = Math.round(norm / 5) * 5 % 360;
  const degPart = SHOW_DEGREES ? `${roundedDeg}° ` : "";
  return `About ${roundedMiles} mi ${degPart}${compassLabel(roundedDeg)}`;
}

// Same rounding as formatApproxLocation, but for the Location Display: compass
// direction leads with degrees parenthesized after. e.g. (2.6, 34) -> "About 3 mi NE (35°)".
export function formatApproxLocationCompact(miles: number, bearingDeg: number): string {
  const roundedMiles = Math.round(miles);
  const norm = ((bearingDeg % 360) + 360) % 360;
  const roundedDeg = Math.round(norm / 5) * 5 % 360;
  const degPart = SHOW_DEGREES ? ` (${roundedDeg}°)` : "";
  return `About ${roundedMiles} mi ${compassLabel(roundedDeg)}${degPart}`;
}

// How long ago (in in-game hours/days) a survey snapshot was taken, for the
// Location Display's "(N hours)" / "(N days)" staleness suffix. Rounds to the
// nearest whole unit; anything under half an hour reads as "moments ago"
// rather than "0 hours".
export function formatElapsedGameTime(daysElapsed: number): string {
  const totalHours = daysElapsed * 24;
  if (totalHours < 0.5) return "moments ago";
  if (totalHours < 24) {
    const h = Math.round(totalHours);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(totalHours / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

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
