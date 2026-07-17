import { MILES_PER_TILE } from './playerStats';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManEaterQuest {
  id:            string;
  villageId:     string;
  villageName:   string;
  animalEmoji:   string;
  animalName:    string;
  manEaterName:  string;
  verb:          string;
  locationName:  string;
  biome:         string;
  reward:        number;  // pelts
  spawnTileX:    number;
  spawnTileY:    number;
  spawnMiles:    number;  // distance from village to spawn
  spawnBearing:  string;  // compass direction from village to spawn
  acceptedDay:   number | null; // game day when accepted; null = not yet accepted
  spawned:       boolean;       // true once animal spawned into the world
  completed:     boolean;
}

export interface Trophy {
  questId:       string;
  manEaterName:  string;
  animalName:    string;
}

// ── Lookup tables ─────────────────────────────────────────────────────────────

const MANEATER_NAMES = [
  // Original 20
  'One Eye', 'Scarback', 'Three Claws', 'The Shadow', 'Widow-Maker',
  'Old Grey', 'Blackmane', 'Ironhide', 'Splitear', 'Bonecrusher',
  'Redfang', 'Nightwalker', 'Dustjaw', 'Coldsnout', 'Grimtooth',
  'The Pale One', 'Razorback', 'Stonehide', 'Longclaw', 'Duskfang',
  // Added
  'Snaggletooth', 'Old Fury', 'Redear', 'Crooked', 'The Limper',
  'Notchback', 'Greymantle', 'Mudfoot', 'Silvertip', 'Halfjaw',
  'Yellowtooth', 'Brokenclaw', 'The Wanderer', 'Ashen', 'Darkpelt',
  'Flatnose', 'Stormchaser', 'Roughhide', 'Emberglow', 'Hoarfrost',
  'The Hungry One', 'Knifetooth', 'Sorrowing', 'Old Malice', 'Thornback',
  'Rampager', 'Swiftcurse', 'Greyfall', 'Mireback', 'Cinderfoot',
];

const ATTACK_VERBS: Record<string, string> = {
  'Boar':         'charging',
  'Bison':        'charging',
  'Wolf':         'stalking',
  'Snow Leopard': 'stalking',
  'Eagle':        'harassing',
  'Bear':         'attacking',
  'Crocodile':    'ambushing',
  'Lion':         'hunting',
  'Dragon':       'terrorizing',
  'T-Rex':        'terrorizing',
  'Troll':        'menacing',
};

export const MANEATER_REWARD: Record<string, number> = {
  'Boar':          3,
  'Eagle':         3,
  'Bison':         4,
  'Wolf':          4,
  'Crocodile':     4,
  'Bear':          5,
  'Snow Leopard':  7,
  'Lion':          7,
  'Troll':         9,
  'T-Rex':         9,
  'Dragon':       11,
};

// Animals eligible to be man-eaters per biome
const BIOME_MANEATERS: Partial<Record<string, string[]>> = {
  forest:    ['Bear', 'Wolf', 'Boar', 'Troll', 'T-Rex'],
  hills:     ['Bear', 'Wolf', 'Eagle'],
  mountains: ['Bear', 'Wolf', 'Snow Leopard', 'Dragon', 'Eagle'],
  snow:      ['Wolf', 'Snow Leopard', 'Dragon'],
  plains:    ['Wolf', 'Lion', 'Bison'],
  desert:    ['Lion'],
  swamp:     ['Crocodile', 'T-Rex'],
};

const BIOME_LOCATION: Record<string, string> = {
  forest:    'the forest',
  hills:     'the hills',
  mountains: 'the mountains',
  snow:      'the snowfields',
  plains:    'the plains',
  desert:    'the desert',
  swamp:     'the swamp',
};

export const MANEATER_EMOJI: Record<string, string> = {
  'Bear':         '🐻',
  'Wolf':         '🐺',
  'Boar':         '🐗',
  'Bison':        '🦬',
  'Crocodile':    '🐊',
  'Snow Leopard': '🐆',
  'Lion':         '🦁',
  'Eagle':        '🦅',
  'Dragon':       '🐉',
  'T-Rex':        '🦖',
  'Troll':        '👹',
};

// ── Quest generation ──────────────────────────────────────────────────────────

export function generateManEaterQuests(
  villageId:    string,
  villageName:  string,
  centerTileX:  number,
  centerTileY:  number,
  biome:        string,
  rng:          () => number,
): ManEaterQuest[] {
  const eligible = BIOME_MANEATERS[biome] ?? [];
  if (eligible.length === 0) return [];

  const count = Math.floor(rng() * 4); // 0–3
  if (count === 0) return [];

  const quests: ManEaterQuest[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    const animalName = eligible[Math.floor(rng() * eligible.length)];

    // Pick a unique name from the pool
    let manEaterName = MANEATER_NAMES[Math.floor(rng() * MANEATER_NAMES.length)];
    if (usedNames.has(manEaterName)) {
      for (let t = 0; t < 8; t++) {
        const c = MANEATER_NAMES[Math.floor(rng() * MANEATER_NAMES.length)];
        if (!usedNames.has(c)) { manEaterName = c; break; }
      }
    }
    usedNames.add(manEaterName);

    // Spawn point 2–6 miles from village center
    const minTiles = Math.round(2 / MILES_PER_TILE);
    const maxTiles = Math.round(6 / MILES_PER_TILE);
    const angle = rng() * Math.PI * 2;
    const dist  = minTiles + rng() * (maxTiles - minTiles);
    const spawnTileX = Math.floor(centerTileX + Math.cos(angle) * dist);
    const spawnTileY = Math.floor(centerTileY + Math.sin(angle) * dist);

    const sdx = spawnTileX - centerTileX, sdy = spawnTileY - centerTileY;
    const spawnMiles = Math.round(Math.sqrt(sdx*sdx + sdy*sdy) * MILES_PER_TILE);
    const bearingDeg = ((Math.atan2(sdx, -sdy) * 180 / Math.PI) + 360) % 360;
    const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const spawnBearing = DIRS[Math.round(bearingDeg / 22.5) % 16];

    quests.push({
      id:           `maneater_${villageId}_${i}`,
      villageId,
      villageName,
      animalEmoji:  MANEATER_EMOJI[animalName] ?? '🐾',
      animalName,
      manEaterName,
      verb:         ATTACK_VERBS[animalName] ?? 'attacking',
      locationName: BIOME_LOCATION[biome] ?? 'the wilderness',
      biome,
      reward:       MANEATER_REWARD[animalName] ?? 8,
      spawnTileX,
      spawnTileY,
      spawnMiles,
      spawnBearing,
      acceptedDay:  null,
      spawned:      false,
      completed:    false,
    });
  }

  return quests;
}

export function questDescription(q: ManEaterQuest): string {
  const article = /^[AEIOU]/i.test(q.animalName) ? 'An' : 'A';
  return `${article} ${q.animalName.toLowerCase()} named ${q.manEaterName} that's been ${q.verb} anyone who enters ${q.locationName}.`;
}

export const MANEATER_QUEST_EXPIRE_DAYS = 20;
