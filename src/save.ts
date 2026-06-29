import type { PlayerStats } from './playerStats';
import type { StructureType } from './structures';
import type { MapPin } from './mapPins';
import type { Quest } from './quests';

const SAVE_VERSION = 3;

export interface SaveData {
  version: number;
  weatherSeed: number;
  stats: PlayerStats;
  playerTileX: number;
  playerTileY: number;
  startTileX: number;
  startTileY: number;
  structures: { tileX: number; tileY: number; type: StructureType; progressDays: number; complete: boolean }[];
  droppedCanoes: { tileX: number; tileY: number }[];
  timberPiles: { tileX: number; tileY: number; amount: number }[];
  mapPins?: MapPin[];
  quests?:  Quest[];
}

function saveKey(seed: string): string {
  return `frontier_${seed}`;
}

export function saveGame(
  seed: string,
  weatherSeed: number,
  stats: PlayerStats,
  playerTileX: number,
  playerTileY: number,
  startTileX: number,
  startTileY: number,
  structures: SaveData['structures'],
  droppedCanoes: SaveData['droppedCanoes'],
  timberPiles: SaveData['timberPiles'],
  mapPins: SaveData['mapPins'],
  quests:  SaveData['quests'],
): void {
  const data: SaveData = {
    version: SAVE_VERSION,
    weatherSeed,
    stats: { ...stats, activeAction: null }, // don't restore mid-action
    playerTileX,
    playerTileY,
    startTileX,
    startTileY,
    structures,
    droppedCanoes,
    timberPiles,
    mapPins,
    quests,
  };
  try {
    localStorage.setItem(saveKey(seed), JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

export function loadGame(seed: string): SaveData | null {
  try {
    const raw = localStorage.getItem(saveKey(seed));
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION) return null;
    data.stats.foodConsumed  ??= 0;
    data.stats.waterConsumed ??= 0;
    return data;
  } catch {
    return null;
  }
}

export function deleteSave(seed: string): void {
  localStorage.removeItem(saveKey(seed));
}
