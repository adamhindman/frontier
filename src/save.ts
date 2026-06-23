import type { PlayerStats } from './playerStats';
import type { StructureType } from './structures';

const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  stats: PlayerStats;
  playerTileX: number;
  playerTileY: number;
  structures: { tileX: number; tileY: number; type: StructureType; progressDays: number; complete: boolean }[];
  droppedCanoes: { tileX: number; tileY: number }[];
  timberPiles: { tileX: number; tileY: number; amount: number }[];
}

function saveKey(seed: string): string {
  return `frontier_${seed}`;
}

export function saveGame(
  seed: string,
  stats: PlayerStats,
  playerTileX: number,
  playerTileY: number,
  structures: SaveData['structures'],
  droppedCanoes: SaveData['droppedCanoes'],
  timberPiles: SaveData['timberPiles'],
): void {
  const data: SaveData = {
    version: SAVE_VERSION,
    stats: { ...stats, activeAction: null }, // don't restore mid-action
    playerTileX,
    playerTileY,
    structures,
    droppedCanoes,
    timberPiles,
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
    return data;
  } catch {
    return null;
  }
}

export function deleteSave(seed: string): void {
  localStorage.removeItem(saveKey(seed));
}
