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
  speedMultiplier: number; // fraction of PLAYER_SPEED; 1.0 = unimpeded
  baseResources: TileResources;
  foodDrainPerTile:   number; // food lost per tile traveled
  waterDrainPerTile:  number; // water lost per tile traveled
  energyDrainPerTile: number; // energy lost per tile traveled
}

// Resource values are 0–10 base amounts before any modifiers are applied.
// foodDrainPerTile / waterDrainPerTile are in pounds per tile traveled.
// energyDrainPerTile is on the 0–100 abstract scale.
export const BIOMES: Record<Biome, BiomeProperties> = {
  //               color      speed   resources                                              food    water   energy
  plains:        { color: '#78b847', speedMultiplier: 1.00, baseResources: { plants: 6, game: 5, water: 3, timber: 2, minerals: 2 }, foodDrainPerTile: 0.060, waterDrainPerTile: 0.050, energyDrainPerTile: 0.30 },
  beach:         { color: '#e0cc96', speedMultiplier: 0.85, baseResources: { plants: 2, game: 2, water: 4, timber: 0, minerals: 3 }, foodDrainPerTile: 0.060, waterDrainPerTile: 0.060, energyDrainPerTile: 0.35 },
  forest:        { color: '#2d6b1e', speedMultiplier: 0.70, baseResources: { plants: 8, game: 7, water: 5, timber: 9, minerals: 2 }, foodDrainPerTile: 0.050, waterDrainPerTile: 0.040, energyDrainPerTile: 0.40 },
  desert:        { color: '#c8a84b', speedMultiplier: 0.75, baseResources: { plants: 1, game: 1, water: 0, timber: 0, minerals: 6 }, foodDrainPerTile: 0.120, waterDrainPerTile: 0.125, energyDrainPerTile: 0.50 },
  hills:         { color: '#917a52', speedMultiplier: 0.55, baseResources: { plants: 4, game: 4, water: 3, timber: 3, minerals: 6 }, foodDrainPerTile: 0.080, waterDrainPerTile: 0.060, energyDrainPerTile: 0.55 },
  swamp:         { color: '#4a6b3a', speedMultiplier: 0.40, baseResources: { plants: 7, game: 5, water: 8, timber: 5, minerals: 1 }, foodDrainPerTile: 0.080, waterDrainPerTile: 0.050, energyDrainPerTile: 0.65 },
  shallow_water: { color: '#2d6fa8', speedMultiplier: 0.35, baseResources: { plants: 3, game: 4, water: 9, timber: 0, minerals: 1 }, foodDrainPerTile: 0.060, waterDrainPerTile: 0.040, energyDrainPerTile: 0.55 },
  snow:          { color: '#efefef', speedMultiplier: 0.45, baseResources: { plants: 1, game: 2, water: 6, timber: 2, minerals: 4 }, foodDrainPerTile: 0.100, waterDrainPerTile: 0.040, energyDrainPerTile: 0.60 },
  mountains:     { color: '#7d7d7d', speedMultiplier: 0.25, baseResources: { plants: 1, game: 2, water: 4, timber: 1, minerals: 9 }, foodDrainPerTile: 0.120, waterDrainPerTile: 0.070, energyDrainPerTile: 0.80 },
  deep_water:    { color: '#1a3f6e', speedMultiplier: 0.10, baseResources: { plants: 1, game: 3, water: 9, timber: 0, minerals: 1 }, foodDrainPerTile: 0.090, waterDrainPerTile: 0.050, energyDrainPerTile: 0.90 },
};

export function getTileResources(biome: Biome): TileResources {
  const { baseResources } = BIOMES[biome];
  return { ...baseResources };
}

export function getBiome(elevation: number, moisture: number): Biome {
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
