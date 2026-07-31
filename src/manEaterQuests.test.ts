import { describe, it, expect } from 'vitest';
import {
  generateManEaterQuests,
  questDescription,
  MANEATER_QUEST_EXPIRE_DAYS,
  MANEATER_REWARD,
  type ManEaterQuest,
} from './manEaterQuests';
import { MILES_PER_TILE } from './playerStats';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('MANEATER_QUEST_EXPIRE_DAYS', () => {
  it('is 20', () => {
    expect(MANEATER_QUEST_EXPIRE_DAYS).toBe(20);
  });
});

// ─── generateManEaterQuests ───────────────────────────────────────────────────

describe('generateManEaterQuests', () => {
  it('returns empty array for biomes with no eligible animals', () => {
    expect(generateManEaterQuests('v1', 'TestVille', 0, 0, 'beach', () => 0.5)).toHaveLength(0);
    expect(generateManEaterQuests('v1', 'TestVille', 0, 0, 'deep_water', () => 0.5)).toHaveLength(0);
    expect(generateManEaterQuests('v1', 'TestVille', 0, 0, 'shallow_water', () => 0.5)).toHaveLength(0);
  });

  it('returns empty array when RNG count roll is 0', () => {
    // count = Math.floor(0 * 4) = 0
    expect(generateManEaterQuests('v1', 'TestVille', 0, 0, 'forest', () => 0)).toHaveLength(0);
  });

  it('generates between 1 and 3 quests for valid biomes when count > 0', () => {
    // count = Math.floor(0.99 * 4) = 3
    const quests = generateManEaterQuests('v1', 'TestVille', 0, 0, 'forest', () => 0.99);
    expect(quests.length).toBeGreaterThan(0);
    expect(quests.length).toBeLessThanOrEqual(3);
  });

  it('each quest spawn point is 2–6 miles from the village center', () => {
    const cx = 500, cy = 200;
    const minTiles = Math.round(2 / MILES_PER_TILE);
    const maxTiles = Math.round(6 / MILES_PER_TILE);

    for (const seed of [0.1, 0.25, 0.5, 0.75, 0.99]) {
      const quests = generateManEaterQuests('v1', 'TestVille', cx, cy, 'forest', () => seed);
      for (const q of quests) {
        const dx = q.spawnTileX - cx;
        const dy = q.spawnTileY - cy;
        const tilesDist = Math.sqrt(dx * dx + dy * dy);
        // Allow ±1 tile of floor rounding
        expect(tilesDist).toBeGreaterThanOrEqual(minTiles - 1);
        expect(tilesDist).toBeLessThanOrEqual(maxTiles + 1);
      }
    }
  });

  it('quest IDs follow the pattern maneater_<villageId>_<index>', () => {
    const quests = generateManEaterQuests('abc', 'TestVille', 0, 0, 'plains', () => 0.99);
    quests.forEach((q, i) => {
      expect(q.id).toBe(`maneater_abc_${i}`);
    });
  });

  it('all quests start unaccepted, unspawned, and uncompleted', () => {
    const quests = generateManEaterQuests('v1', 'TestVille', 0, 0, 'plains', () => 0.5);
    for (const q of quests) {
      expect(q.acceptedDay).toBeNull();
      expect(q.spawned).toBe(false);
      expect(q.completed).toBe(false);
    }
  });

  it('assigns a reward from the lookup table', () => {
    const quests = generateManEaterQuests('v1', 'TestVille', 0, 0, 'plains', () => 0.5);
    for (const q of quests) {
      expect(MANEATER_REWARD[q.animalName]).toBeDefined();
      expect(q.reward).toBe(MANEATER_REWARD[q.animalName]);
    }
  });

  it('sets villageId and villageName correctly', () => {
    const quests = generateManEaterQuests('myVillage', 'Port Mercy', 0, 0, 'forest', () => 0.5);
    for (const q of quests) {
      expect(q.villageId).toBe('myVillage');
      expect(q.villageName).toBe('Port Mercy');
    }
  });

  it('generates animals appropriate to the biome', () => {
    const forestQuests = generateManEaterQuests('v1', 'TestVille', 0, 0, 'forest', () => 0.5);
    const forestEligible = new Set(['Bear', 'Wolf', 'Boar', 'Troll', 'T-Rex']);
    for (const q of forestQuests) {
      expect(forestEligible.has(q.animalName)).toBe(true);
    }

    const snowQuests = generateManEaterQuests('v2', 'TestVille', 0, 0, 'snow', () => 0.5);
    const snowEligible = new Set(['Wolf', 'Snow Leopard', 'Dragon']);
    for (const q of snowQuests) {
      expect(snowEligible.has(q.animalName)).toBe(true);
    }
  });

  it('spawnMiles is the rounded tile distance times MILES_PER_TILE', () => {
    const cx = 0, cy = 0;
    const quests = generateManEaterQuests('v1', 'TestVille', cx, cy, 'forest', () => 0.5);
    for (const q of quests) {
      const dx = q.spawnTileX - cx;
      const dy = q.spawnTileY - cy;
      const expected = Math.round(Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE);
      expect(q.spawnMiles).toBe(expected);
    }
  });

  it('generates animals appropriate to hills, mountains, desert, and swamp biomes', () => {
    const cases: [string, string[]][] = [
      ['hills', ['Bear', 'Wolf', 'Eagle']],
      ['mountains', ['Bear', 'Wolf', 'Snow Leopard', 'Dragon', 'Eagle']],
      ['desert', ['Lion']],
      ['swamp', ['Crocodile', 'T-Rex']],
    ];
    for (const [biome, eligible] of cases) {
      const eligibleSet = new Set(eligible);
      const quests = generateManEaterQuests('v1', 'TestVille', 0, 0, biome, () => 0.5);
      for (const q of quests) {
        expect(eligibleSet.has(q.animalName)).toBe(true);
      }
    }
  });
});

// ─── spawnBearing (16-point compass) ───────────────────────────────────────────

function makeRng(sequence: number[], fallback = 0): () => number {
  let i = 0;
  return () => (i < sequence.length ? sequence[i++] : fallback);
}

describe('generateManEaterQuests spawnBearing', () => {
  // Call order per quest, after the initial count roll: eligible-animal pick,
  // man-eater-name pick, spawn angle, spawn distance. Angle 0/π/2/π along a large
  // (40-tile) radius gives clean E/S/W directions with no floor-rounding noise.
  const COUNT_ONE = 0.3; // Math.floor(0.3 * 4) === 1

  it('bearing E for a spawn point directly east of the village (angle 0)', () => {
    const rng = makeRng([COUNT_ONE, 0, 0, 0 /* angle=0 */, 0 /* dist=min */]);
    const [q] = generateManEaterQuests('v1', 'TestVille', 0, 0, 'plains', rng);
    expect(q.spawnBearing).toBe('E');
  });

  it('bearing S for a spawn point directly south of the village (angle π/2)', () => {
    const rng = makeRng([COUNT_ONE, 0, 0, 0.25 /* angle=π/2 */, 0]);
    const [q] = generateManEaterQuests('v1', 'TestVille', 0, 0, 'plains', rng);
    expect(q.spawnBearing).toBe('S');
  });

  it('bearing W for a spawn point directly west of the village (angle π)', () => {
    const rng = makeRng([COUNT_ONE, 0, 0, 0.5 /* angle=π */, 0]);
    const [q] = generateManEaterQuests('v1', 'TestVille', 0, 0, 'plains', rng);
    expect(q.spawnBearing).toBe('W');
  });

  it('always produces one of the 16 valid compass directions across many angles', () => {
    const DIRS = new Set([
      'N','NNE','NE','ENE','E','ESE','SE','SSE',
      'S','SSW','SW','WSW','W','WNW','NW','NNW',
    ]);
    for (let i = 0; i < 20; i++) {
      const angleFrac = i / 20;
      const rng = makeRng([COUNT_ONE, 0, 0, angleFrac, 0.5]);
      const [q] = generateManEaterQuests('v1', 'TestVille', 1000, 1000, 'forest', rng);
      expect(DIRS.has(q.spawnBearing)).toBe(true);
    }
  });
});

// ─── Duplicate man-eater name avoidance ────────────────────────────────────────

describe('generateManEaterQuests duplicate-name avoidance', () => {
  const COUNT_TWO = 0.5; // Math.floor(0.5 * 4) === 2

  it('retries once and picks a different name when the first roll collides', () => {
    // quest0: name index 0 ('One Eye'). quest1: initial roll also index 0 (collides),
    // first retry attempt rolls index 1 ('Scarback'), which is unused -> accepted.
    const rng = makeRng([
      COUNT_TWO,
      0, 0, 0, 0,          // quest0: eligible, name(=0 'One Eye'), angle, dist
      0, 0, 0.02, 0, 0,    // quest1: eligible, name(=0 collide), retry(=1 'Scarback'), angle, dist
    ]);
    const quests = generateManEaterQuests('v1', 'TestVille', 0, 0, 'forest', rng);
    expect(quests).toHaveLength(2);
    expect(quests[0].manEaterName).toBe('One Eye');
    expect(quests[1].manEaterName).toBe('Scarback');
    expect(quests[1].manEaterName).not.toBe(quests[0].manEaterName);
  });

  it('falls back to a duplicate name when all 8 retry attempts also collide', () => {
    // Every roll (initial + all 8 retries) resolves to index 0 ('One Eye') for both
    // quests, so quest1 can never find a free name and keeps the colliding one.
    const rng = makeRng([COUNT_TWO], 0);
    const quests = generateManEaterQuests('v1', 'TestVille', 0, 0, 'forest', rng);
    expect(quests).toHaveLength(2);
    expect(quests[0].manEaterName).toBe('One Eye');
    expect(quests[1].manEaterName).toBe('One Eye');
  });
});

// ─── questDescription ─────────────────────────────────────────────────────────

const BASE_QUEST: ManEaterQuest = {
  id: 'maneater_v1_0', villageId: 'v1', villageName: 'TestVille',
  animalEmoji: '🐻', animalName: 'Bear', manEaterName: 'Scarback',
  verb: 'attacking', locationName: 'the forest', biome: 'forest',
  reward: 10, spawnTileX: 100, spawnTileY: 100,
  spawnMiles: 3, spawnBearing: 'NE',
  acceptedDay: null, spawned: false, completed: false,
};

describe('questDescription', () => {
  it('formats a complete sentence for a bear quest', () => {
    expect(questDescription(BASE_QUEST)).toBe(
      "A bear named Scarback that's been attacking anyone who enters the forest."
    );
  });

  it('uses "An" article for animal names starting with a vowel', () => {
    const q: ManEaterQuest = { ...BASE_QUEST, animalName: 'Eagle', animalEmoji: '🦅', verb: 'harassing' };
    const desc = questDescription(q);
    expect(desc).toMatch(/^An eagle/);
  });

  it('uses "A" article for animal names starting with a consonant', () => {
    expect(questDescription(BASE_QUEST)).toMatch(/^A bear/);
  });

  it('lowercases the animal name in the description', () => {
    const q: ManEaterQuest = { ...BASE_QUEST, animalName: 'Snow Leopard', verb: 'stalking' };
    expect(questDescription(q)).toContain('snow leopard');
  });

  it('includes the man-eater name', () => {
    expect(questDescription(BASE_QUEST)).toContain('Scarback');
  });

  it('includes the location name', () => {
    expect(questDescription(BASE_QUEST)).toContain('the forest');
  });
});
