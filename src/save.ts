import type { PlayerStats } from './playerStats';
import type { StructureType } from './structures';
import type { MapPin } from './mapPins';
import type { Quest } from './quests';
import type { TrapSaveEntry } from './traps';
import type { ManEaterQuest } from './manEaterQuests';
import type { ManEaterSave } from './animals';

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
  traps?:   TrapSaveEntry[];
  manEaterQuests?: { siteId: string; quests: ManEaterQuest[] }[];
  activeManEaters?: ManEaterSave[];
}

function saveKey(seed: string): string {
  return `frontier_${seed}`;
}

function manualSaveKey(seed: string): string {
  return `frontier_manual_${seed}`;
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
  traps:   SaveData['traps'],
  manEaterQuests?: SaveData['manEaterQuests'],
  activeManEaters?: SaveData['activeManEaters'],
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
    traps,
    manEaterQuests,
    activeManEaters,
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
    data.stats.foodSpoiled   ??= 0;
    data.stats.milesOverland  ??= 0;
    data.stats.milesPortaging ??= 0;
    data.stats.milesByCanoe   ??= 0;
    data.stats.heavyCoat       ??= 0;
    data.stats.hipWaders       ??= 0;
    data.stats.liquor          ??= 0;
    data.stats.medicine        ??= 0;
    data.stats.precisionRifle  ??= 0;
    data.stats.lodestone       ??= 0;
    data.stats.tools           ??= 0;
    data.stats.crampons        ??= 0;
    data.stats.trophies        ??= [];
    return data;
  } catch {
    return null;
  }
}

export function deleteSave(seed: string): void {
  localStorage.removeItem(saveKey(seed));
}

export function saveManualGame(
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
  quests: SaveData['quests'],
  traps:  SaveData['traps'],
  manEaterQuests?: SaveData['manEaterQuests'],
  activeManEaters?: SaveData['activeManEaters'],
): void {
  const data: SaveData = {
    version: SAVE_VERSION,
    weatherSeed,
    stats: { ...stats, activeAction: null },
    playerTileX,
    playerTileY,
    startTileX,
    startTileY,
    structures,
    droppedCanoes,
    timberPiles,
    mapPins,
    quests,
    traps,
    manEaterQuests,
    activeManEaters,
  };
  try {
    localStorage.setItem(manualSaveKey(seed), JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

export function loadManualGame(seed: string): SaveData | null {
  try {
    const raw = localStorage.getItem(manualSaveKey(seed));
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION) return null;
    data.stats.foodConsumed  ??= 0;
    data.stats.waterConsumed ??= 0;
    data.stats.foodSpoiled   ??= 0;
    data.stats.milesOverland  ??= 0;
    data.stats.milesPortaging ??= 0;
    data.stats.milesByCanoe   ??= 0;
    data.stats.heavyCoat      ??= 0;
    data.stats.hipWaders      ??= 0;
    data.stats.liquor         ??= 0;
    data.stats.medicine       ??= 0;
    data.stats.precisionRifle ??= 0;
    data.stats.lodestone      ??= 0;
    data.stats.tools          ??= 0;
    data.stats.crampons       ??= 0;
    data.stats.trophies       ??= [];
    return data;
  } catch {
    return null;
  }
}

export function hasManualSave(seed: string): boolean {
  return localStorage.getItem(manualSaveKey(seed)) !== null;
}
