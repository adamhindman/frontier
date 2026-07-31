import type { PlayerStats } from './playerStats';
import type { StructureType } from './structures';
import type { MapPin } from './mapPins';
import type { Quest } from './quests';
import type { TrapSaveEntry } from './traps';
import type { ManEaterQuest } from './manEaterQuests';
import type { ManEaterSave } from './animals';
import type { RivalParty } from './rivalParties';
import type { RobotCompanionSaveData } from './robotCompanion';

export interface RaceState {
  rivalParties: RivalParty[];
  capitalUnlocked: boolean;
}

const SAVE_VERSION = 3;

const AUTO_KEY   = 'frontier_autosave';
const MANUAL_KEY = 'frontier_manualsave';

export interface SaveData {
  version: number;
  seed: string;
  weatherSeed: number;
  stats: PlayerStats;
  playerTileX: number;
  playerTileY: number;
  startTileX: number;
  startTileY: number;
  structures: { tileX: number; tileY: number; type: StructureType; progressDays: number; complete: boolean; burnProgress?: number; burnDurationDays?: number }[];
  droppedCanoes: { tileX: number; tileY: number }[];
  timberPiles: { tileX: number; tileY: number; amount: number }[];
  mapPins?: MapPin[];
  quests?:  Quest[];
  traps?:   TrapSaveEntry[];
  manEaterQuests?: { siteId: string; quests: ManEaterQuest[] }[];
  activeManEaters?: ManEaterSave[];
  visitedLocations?: { name: string; type: string; tileX: number; tileY: number }[];
  raceState?: RaceState;
  robotCompanion?: RobotCompanionSaveData;
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
  visitedLocations?: SaveData['visitedLocations'],
  raceState?: SaveData['raceState'],
  robotCompanion?: SaveData['robotCompanion'],
): void {
  const data: SaveData = {
    version: SAVE_VERSION,
    seed,
    weatherSeed,
    stats: { ...stats, activeAction: null, worklightOn: false }, // don't restore mid-action or mid-toggle
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
    visitedLocations,
    raceState,
    robotCompanion,
  };
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
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
    data.stats.shriekingCoil   ??= 0;
    data.stats.nightBoots      ??= 0;
    data.stats.tools           ??= 0;
    data.stats.crampons        ??= 0;
    data.stats.trophies        ??= [];
    data.stats.bleeding        ??= false;
    data.stats.artifacts       ??= [];
    data.stats.worklightLantern ??= 0;
    data.stats.worklightOn      ??= false;
    data.stats.hasSurveyed      ??= false;
    data.stats.lastSurveyMiles       ??= 0;
    data.stats.lastSurveyBearingDeg  ??= 0;
    data.stats.lastSurveyDaysTraveled ??= data.stats.daysTraveled;
    data.stats.wetPenalty      ??= 0;
    data.stats.wetHoursExposure ??= 0;
    return data;
  } catch {
    return null;
  }
}

export function deleteSave(): void {
  localStorage.removeItem(AUTO_KEY);
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
  visitedLocations?: SaveData['visitedLocations'],
  raceState?: SaveData['raceState'],
  robotCompanion?: SaveData['robotCompanion'],
): void {
  const data: SaveData = {
    version: SAVE_VERSION,
    seed,
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
    visitedLocations,
    raceState,
    robotCompanion,
  };
  try {
    localStorage.setItem(MANUAL_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

export function loadManualGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(MANUAL_KEY);
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
    data.stats.shriekingCoil  ??= 0;
    data.stats.nightBoots     ??= 0;
    data.stats.tools          ??= 0;
    data.stats.crampons       ??= 0;
    data.stats.trophies       ??= [];
    data.stats.bleeding       ??= false;
    data.stats.artifacts      ??= [];
    data.stats.hasSurveyed    ??= false;
    data.stats.lastSurveyMiles       ??= 0;
    data.stats.lastSurveyBearingDeg  ??= 0;
    data.stats.lastSurveyDaysTraveled ??= data.stats.daysTraveled;
    data.stats.wetPenalty      ??= 0;
    data.stats.wetHoursExposure ??= 0;
    return data;
  } catch {
    return null;
  }
}

export function hasManualSave(): boolean {
  return localStorage.getItem(MANUAL_KEY) !== null;
}

export function promoteManualToAuto(): string | null {
  const raw = localStorage.getItem(MANUAL_KEY);
  if (!raw) return null;
  try {
    localStorage.setItem(AUTO_KEY, raw);
    const data = JSON.parse(raw) as SaveData;
    return data.seed ?? null;
  } catch {
    return null;
  }
}

/** Remove any legacy per-seed save keys left from the old save format. */
export function cleanLegacySaves(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('frontier_') && k !== AUTO_KEY && k !== MANUAL_KEY) {
      toRemove.push(k);
    }
  }
  for (const k of toRemove) localStorage.removeItem(k);
}
