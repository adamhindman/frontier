import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export function createNoiseGenerators(seed: string) {
  const elevation = createNoise2D(mulberry32(hashString(seed + '_e')));
  const moisture  = createNoise2D(mulberry32(hashString(seed + '_m')));
  return { elevation, moisture };
}

// Returns a value in [0, 1] using layered octaves for realistic large-scale terrain.
export function sampleElevation(wx: number, wy: number, noise: NoiseFunction2D): number {
  let v = 0;
  v += noise(wx / 900, wy / 900) * 0.55;  // continental scale
  v += noise(wx / 300, wy / 300) * 0.25;  // regional (mountain ranges, valleys)
  v += noise(wx / 80,  wy / 80)  * 0.12;  // local hills
  v += noise(wx / 25,  wy / 25)  * 0.08;  // surface detail
  return (v + 1) / 2;
}

export function sampleMoisture(wx: number, wy: number, noise: NoiseFunction2D): number {
  let v = 0;
  v += noise(wx / 700, wy / 700) * 0.6;
  v += noise(wx / 200, wy / 200) * 0.3;
  v += noise(wx / 60,  wy / 60)  * 0.1;
  return (v + 1) / 2;
}
