export interface RivalParty {
  id: string;
  name: string;
  tileX: number;
  tileY: number;
  milesTraveled: number;
  ruinsFound: number;
  status: 'active' | 'lost';
  restDaysRemaining: number;
}

// Cumulative straight-line miles from start needed before a party can roll to find
// each ruin — the running sum of the player quest chain's per-leg distances
// (~7.5, 22.5, 67.5 mi legs), NOT the raw per-leg array. Using the raw per-leg
// values directly as cumulative thresholds let a party qualify for all 4 ruins
// after just 67.5 total miles of wandering, instead of the ~105 miles of real
// progress the chained legs actually add up to — that mismatch let rivals find
// all 4 ruins in about a month regardless of how far they'd actually traveled.
export const RIVAL_TOTAL_RUINS = 4;
const RUIN_MILE_THRESHOLDS = [7.5, 15, 37.5, 105];
const RUIN_DAILY_PROB = 0.20;
const LOST_DAILY_PROB = 0.002;
const REST_DAILY_PROB = 0.05; // chance per day to halt for canoe-building/healing
const REST_DAYS_MIN = 2;
const REST_DAYS_MAX = 4;

export const PARTY_NAMES = [
  'The Blackwood Expedition',
  'The Order of the Golden Horizon',
  'The Vance Survey Company',
  'The Meridian Brotherhood',
  'The Hargrove Expedition',
  'The Royal Geographic Society',
  'The Iron Compass Guild',
  'The Moreau Party',
  'The League of Distant Shores',
  'The Ashford Institute',
  'The Kessler Expedition',
  'The Dawnseeker Company',
  'The Stonehaven Society',
  'The Far Meridian Guild',
  'The Breckenridge Survey',
];

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRivalParties(worldSeed: string, startTileX: number, startTileY: number): RivalParty[] {
  let h = 5381;
  for (let i = 0; i < worldSeed.length; i++) h = (Math.imul(h, 33) + worldSeed.charCodeAt(i)) >>> 0;
  h = (h + 0xdeadbeef) >>> 0;
  const rng = mulberry32(h);

  const count = 2 + Math.floor(rng() * 2); // 2 or 3
  const shuffled = PARTY_NAMES.slice().sort(() => rng() - 0.5);
  return shuffled.slice(0, count).map((name, i) => ({
    id: `rival_${i}`,
    name,
    tileX: startTileX,
    tileY: startTileY,
    milesTraveled: 0,
    ruinsFound: 0,
    status: 'active' as const,
    restDaysRemaining: 0,
  }));
}

// Advance rival parties by the given number of in-game days.
// Returns log messages for notable events (party lost).
export function tickRivalParties(
  parties: RivalParty[],
  days: number,
  capitalTileX: number,
  capitalTileY: number,
  milesPerTile: number,
): string[] {
  const messages: string[] = [];

  for (let d = 0; d < days; d++) {
    const activeParties = parties.filter(p => p.status === 'active');

    for (const party of parties) {
      if (party.status === 'lost') continue;

      // Resting parties (building a canoe / healing up) sit still for a few days.
      if (party.restDaysRemaining > 0) {
        party.restDaysRemaining--;
        continue;
      }
      if (Math.random() < REST_DAILY_PROB) {
        party.restDaysRemaining = REST_DAYS_MIN + Math.floor(Math.random() * (REST_DAYS_MAX - REST_DAYS_MIN + 1));
        messages.push(`resting:${party.name}`);
        continue;
      }

      // Daily mileage: mostly 5–15 mi/day, occasionally stuck (0) or fast (up to 20)
      const r1 = Math.random(), r2 = Math.random();
      const dailyMiles = r1 < 0.10 ? 0 : 2.5 + Math.min(r2, Math.random()) * 7.5;
      const dailyTiles = dailyMiles / milesPerTile;

      // Movement: head toward capital once all ruins found, otherwise wander
      if (party.ruinsFound >= RIVAL_TOTAL_RUINS) {
        const dx = capitalTileX - party.tileX;
        const dy = capitalTileY - party.tileY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          const frac = Math.min(dailyTiles / dist, 1);
          party.tileX = Math.round(party.tileX + dx * frac);
          party.tileY = Math.round(party.tileY + dy * frac);
        }
      } else {
        const angle = Math.random() * Math.PI * 2;
        party.tileX = Math.round(party.tileX + Math.cos(angle) * dailyTiles);
        party.tileY = Math.round(party.tileY + Math.sin(angle) * dailyTiles);
      }

      party.milesTraveled += dailyMiles;

      // Ruin discovery check
      if (party.ruinsFound < RIVAL_TOTAL_RUINS) {
        const threshold = RUIN_MILE_THRESHOLDS[party.ruinsFound];
        if (party.milesTraveled >= threshold && Math.random() < RUIN_DAILY_PROB) {
          party.ruinsFound++;
        }
      }

      // Lost check — only when at least 2 active parties remain
      if (activeParties.length > 1 && Math.random() < LOST_DAILY_PROB) {
        party.status = 'lost';
        messages.push(`lost:${party.name}`);
      }
    }
  }

  return messages;
}

export function getNewsReport(party: RivalParty, currentDay: number): string {
  if (party.status === 'lost') {
    return `${party.name} — no word has been received for many weeks. Feared lost.`;
  }
  const staleDays = 3 + Math.floor(Math.random() * 5);
  const reportDay = Math.max(1, Math.floor(currentDay) - staleDays);
  const ruinsText =
    party.ruinsFound === 0 ? 'found no ruins'
    : party.ruinsFound === RIVAL_TOTAL_RUINS ? `found all ${RIVAL_TOTAL_RUINS} ruins`
    : party.ruinsFound === 1 ? 'found 1 ruin'
    : `found ${party.ruinsFound} ruins`;
  const restText = party.restDaysRemaining > 0 ? ' Currently making camp — building a canoe or tending to the injured.' : '';
  return `${party.name}: as of day ${reportDay}, ~${party.milesTraveled.toFixed(0)} miles traveled, ${ruinsText}.${restText}`;
}
