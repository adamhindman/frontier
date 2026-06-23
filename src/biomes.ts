export type Biome =
  | 'deep_water'
  | 'shallow_water'
  | 'beach'
  | 'swamp'
  | 'plains'
  | 'forest'
  | 'desert'
  | 'hills'
  | 'mountains'
  | 'snow';

export interface TileResources {
  plants:   number; // edible vegetation
  game:     number; // huntable wildlife
  water:    number; // accessible fresh water
  timber:   number; // harvestable wood
  minerals: number; // stone, ore, etc.
}

export interface BiomeProperties {
  color: string;
  elevMin: number; // elevation range for this biome (used for shade stepping)
  elevMax: number;
  speedMultiplier: number; // fraction of PLAYER_SPEED; 1.0 = unimpeded
  baseResources: TileResources;
  foodDrainPerTile:   number; // food lost per tile traveled
  waterDrainPerTile:  number; // water lost per tile traveled
  energyDrainPerTile: number; // energy lost per tile traveled
  baseTemp: number; // °F midday reference temperature for this biome
}

// Resource values are 0–10 base amounts before any modifiers are applied.
// foodDrainPerTile / waterDrainPerTile are in pounds per tile traveled.
// energyDrainPerTile is on the 0–100 abstract scale.
export const BIOMES: Record<Biome, BiomeProperties> = {
  //               color      elevMin  elevMax  speed   resources                                              food     water    energy   baseTemp
  // Water family: all blue, deep→shallow gets lighter
  deep_water:    { color: '#1e4d7a', elevMin: 0.00, elevMax: 0.28, speedMultiplier: 0.10, baseResources: { plants: 1, game: 3, water: 9, timber: 0, minerals: 1 }, foodDrainPerTile: 0.011, waterDrainPerTile: 0.0030, energyDrainPerTile: 0.22, baseTemp: 50 },
  shallow_water: { color: '#3d80b8', elevMin: 0.28, elevMax: 0.38, speedMultiplier: 0.35, baseResources: { plants: 3, game: 4, water: 9, timber: 0, minerals: 1 }, foodDrainPerTile: 0.007, waterDrainPerTile: 0.0025, energyDrainPerTile: 0.14, baseTemp: 55 },
  // Coastal land: warm sand, clearly not water
  beach:         { color: '#c8a86e', elevMin: 0.38, elevMax: 0.42, speedMultiplier: 0.85, baseResources: { plants: 2, game: 2, water: 4, timber: 0, minerals: 3 }, foodDrainPerTile: 0.007, waterDrainPerTile: 0.0038, energyDrainPerTile: 0.09, baseTemp: 72 },
  // Land biomes
  plains:        { color: '#6aaa38', elevMin: 0.42, elevMax: 0.55, speedMultiplier: 1.00, baseResources: { plants: 6, game: 5, water: 3, timber: 2, minerals: 2 }, foodDrainPerTile: 0.007, waterDrainPerTile: 0.0030, energyDrainPerTile: 0.075, baseTemp: 65 },
  forest:        { color: '#2d6b1e', elevMin: 0.42, elevMax: 0.68, speedMultiplier: 0.70, baseResources: { plants: 8, game: 7, water: 5, timber: 9, minerals: 2 }, foodDrainPerTile: 0.006, waterDrainPerTile: 0.0025, energyDrainPerTile: 0.10, baseTemp: 58 },
  swamp:         { color: '#4a6b3a', elevMin: 0.42, elevMax: 0.48, speedMultiplier: 0.40, baseResources: { plants: 7, game: 5, water: 8, timber: 5, minerals: 1 }, foodDrainPerTile: 0.010, waterDrainPerTile: 0.0030, energyDrainPerTile: 0.16, baseTemp: 62 },
  desert:        { color: '#c8a035', elevMin: 0.42, elevMax: 0.55, speedMultiplier: 0.75, baseResources: { plants: 1, game: 1, water: 0, timber: 0, minerals: 6 }, foodDrainPerTile: 0.014, waterDrainPerTile: 0.0075, energyDrainPerTile: 0.13, baseTemp: 95 },
  hills:         { color: '#8a7048', elevMin: 0.55, elevMax: 0.68, speedMultiplier: 0.55, baseResources: { plants: 4, game: 4, water: 3, timber: 3, minerals: 6 }, foodDrainPerTile: 0.010, waterDrainPerTile: 0.0038, energyDrainPerTile: 0.14, baseTemp: 52 },
  // High altitude: grey→white family
  mountains:     { color: '#7a7a7a', elevMin: 0.68, elevMax: 0.82, speedMultiplier: 0.25, baseResources: { plants: 1, game: 2, water: 4, timber: 1, minerals: 9 }, foodDrainPerTile: 0.014, waterDrainPerTile: 0.0045, energyDrainPerTile: 0.20, baseTemp: 35 },
  snow:          { color: '#d8e0e8', elevMin: 0.82, elevMax: 1.00, speedMultiplier: 0.45, baseResources: { plants: 1, game: 2, water: 6, timber: 2, minerals: 4 }, foodDrainPerTile: 0.012, waterDrainPerTile: 0.0025, energyDrainPerTile: 0.15, baseTemp: 18 },
};

export function getTileResources(biome: Biome): TileResources {
  const { baseResources } = BIOMES[biome];
  return { ...baseResources };
}

export function getBiome(
  elevation: number,
  moisture: number,
  riverVal?: number,
  lakeVal?: number,
): Biome {
  // Rivers: narrow domain-warped channels through land
  if (riverVal !== undefined && riverVal < 0.07 && elevation >= 0.40 && elevation < 0.65) {
    return 'shallow_water';
  }
  // Lakes: low-frequency blobs in flat lowlands
  if (lakeVal !== undefined && lakeVal > 0.78 && elevation >= 0.42 && elevation < 0.52) {
    return 'shallow_water';
  }

  if (elevation < 0.28) return 'deep_water';
  if (elevation < 0.38) return 'shallow_water';
  if (elevation < 0.42) return 'beach';
  if (elevation > 0.82) return 'snow';
  if (elevation > 0.68) return 'mountains';

  if (elevation > 0.55) {
    return moisture > 0.55 ? 'forest' : 'hills';
  }

  if (moisture < 0.22) return 'desert';
  if (moisture > 0.72 && elevation < 0.48) return 'swamp';
  if (moisture > 0.52) return 'forest';
  return 'plains';
}
