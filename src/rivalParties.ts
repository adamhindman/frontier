export interface RivalParty {
  id: string;
  name: string;
  milesTraveled: number;
  ruinsFound: number;
  status: 'active' | 'lost';
  restDaysRemaining: number;
  // This party's own (±15%-varied) distance to the capital, in miles, counted
  // from the moment it finds the 4th ruin — see capitalDistanceMiles below.
  capitalDistanceMiles: number;
  // milesTraveled at the moment ruinsFound reached RIVAL_TOTAL_RUINS; unset
  // until then. Arrival = milesTraveled - milesAtRuinsComplete >= capitalDistanceMiles.
  milesAtRuinsComplete?: number;
  // In-game day (floor) at the same moment — lets the debug panel show how
  // long a party has actually been on its capital leg, so a slow-looking
  // progress number can be told apart from one that only just started.
  dayRuinsComplete?: number;
  reachedCapital?: boolean;
  // In-game day (floor) reachedCapital became true — shown on hover.
  dayArrived?: number;
}

export const RIVAL_TOTAL_RUINS = 4;
// Cumulative sum of the player quest chain's actual per-leg distances — ruin 1
// at 25 mi from start, then +125, +150, +200 (see RUINS_MIN/MAX_MILES and
// RUINS_LEG_MILES in main.ts) — kept in sync with those so a party's
// mileage-gated "eligible to find the next ruin" threshold roughly tracks how
// far the real chain is.
const RUIN_MILE_THRESHOLDS = [25, 150, 300, 500];
// The capital's own leg, from ruin 4 — see CAPITAL_LEG_MILES in main.ts, kept
// in sync with that. Together with RUIN_MILE_THRESHOLDS above, this puts the
// capital at a cumulative ~1000 mi from start, same order of magnitude for
// every party (and the player) regardless of how their individual legs varied.
export const CAPITAL_LEG_MILES = 500;
const RUIN_DAILY_PROB = 0.33;
const LOST_DAILY_PROB = 0.002;
const REST_DAILY_PROB = 0.10;
const REST_DAYS_MIN = 2;
const REST_DAYS_MAX = 4;
// Rivals aren't rendered anywhere on the map while en route (the capital
// standee position, in rivalSprites.ts, is derived independently from a hash
// of the party's id — never from anything tracked here), so there's no reason
// to model their progress as a walk through space. A prior version had them
// wander with a fresh random direction each day and only start heading toward
// the capital once they'd found all 4 ruins; a random walk's net displacement
// grows much slower than the distance actually traveled, so parties could
// rack up real mileage without getting meaningfully closer to the capital,
// then still needed to cross almost its entire real distance from scratch.
// Tracking plain mileage against a known target sidesteps that entirely —
// progress is monotonic by construction.
const CAPITAL_DISTANCE_VARIANCE = 0.15; // ±15% per party, for arrival-time variety

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

export function createRivalParties(worldSeed: string): RivalParty[] {
  let h = 5381;
  for (let i = 0; i < worldSeed.length; i++) h = (Math.imul(h, 33) + worldSeed.charCodeAt(i)) >>> 0;
  h = (h + 0xdeadbeef) >>> 0;
  const rng = mulberry32(h);

  const count = 2 + Math.floor(rng() * 2); // 2 or 3
  const shuffled = PARTY_NAMES.slice().sort(() => rng() - 0.5);
  return shuffled.slice(0, count).map((name, i) => ({
    id: `rival_${i}`,
    name,
    milesTraveled: 0,
    ruinsFound: 0,
    status: 'active' as const,
    restDaysRemaining: 0,
    capitalDistanceMiles: CAPITAL_LEG_MILES * (1 - CAPITAL_DISTANCE_VARIANCE + rng() * 2 * CAPITAL_DISTANCE_VARIANCE),
  }));
}

// Advance rival parties by the given number of in-game days.
// startDay: the in-game day (floor) of the first day being ticked — used only
// to record dayRuinsComplete accurately; pass 0 if you don't care.
// Returns log messages for notable events (party lost).
export function tickRivalParties(parties: RivalParty[], days: number, startDay = 0): string[] {
  const messages: string[] = [];

  for (let d = 0; d < days; d++) {
    const activeParties = parties.filter(p => p.status === 'active');

    for (const party of parties) {
      if (party.status === 'lost') continue;
      if (party.reachedCapital) continue;

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

      // Daily mileage. ×2.22 (empirically tuned, factoring in the 10% rest-day
      // chance above) to land on a ~9 mi/day overall average pace.
      const r1 = Math.random(), r2 = Math.random();
      const dailyMiles = (r1 < 0.10 ? 0 : 2.5 + Math.min(r2, Math.random()) * 7.5) * 2.22;
      party.milesTraveled += dailyMiles;

      // Ruin discovery check
      if (party.ruinsFound < RIVAL_TOTAL_RUINS) {
        const threshold = RUIN_MILE_THRESHOLDS[party.ruinsFound];
        if (party.milesTraveled >= threshold && Math.random() < RUIN_DAILY_PROB) {
          party.ruinsFound++;
          if (party.ruinsFound === RIVAL_TOTAL_RUINS) {
            party.milesAtRuinsComplete = party.milesTraveled;
            party.dayRuinsComplete = startDay + d;
          }
        }
      }

      // Once all ruins are found, keep accumulating mileage until this
      // party's own (varied) distance to the capital has been covered.
      if (party.ruinsFound >= RIVAL_TOTAL_RUINS) {
        const base = party.milesAtRuinsComplete ?? party.milesTraveled;
        if (party.milesTraveled - base >= party.capitalDistanceMiles) {
          party.reachedCapital = true;
          party.dayArrived = startDay + d;
          messages.push(`arrived:${party.name}`);
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

// Flavor lines for clicking a rival standee at the capital, in period voice.
// Hand-edited by the user directly on occasion — preserve edits, don't revert.
const RIVAL_WON_LINES = [
  "By God, we've beaten you to it! Mark it down — the honor belongs to us.",
  'You made a valiant push, sir, but valor alone does not outpace a head start.',
  'We raised our flag over this ground a fortnight past. I trust the walk was scenic, at least.',
  'No shame in it. Few men come this far at all, fewer still on the first attempt.',
  'I confess I expected to find you here ahead of us. I am pleasantly mistaken.',
  "Your outfit is well provisioned, I'll grant — better than most who perish out here. Provisions, alas, do not make up for lost time.",
  "The annals will record our names first. Yours, I'm sure, will follow in due course.",
];
const PLAYER_WON_LINES = [
  'Well fought, sir. The laurels are yours; we shall content ourselves with the footnotes.',
  'Confound it all — a lamed mule and a flooded ford cost us the day. Otherwise this prize was ours by rights.',
  'My compliments. Genuinely. Do try not to let it swell your head.',
  'Of all the ill fortune — a week lost to a broken canoe. Fate is a cruel correspondent.',
  'You have my respect, sir. Precious few make this crossing at all, fewer still ahead of us.',
  'Very well. VERY well. The victory is yours, this expedition.',
  'We shall remember this the next time our paths cross, you may depend upon it.',
];

export function getCapitalEncounterLine(rivalWonRace: boolean): string {
  const lines = rivalWonRace ? RIVAL_WON_LINES : PLAYER_WON_LINES;
  return lines[Math.floor(Math.random() * lines.length)];
}

export function getNewsReport(party: RivalParty, currentDay: number): string {
  if (party.status === 'lost') {
    return `${party.name} — no word has been received for many weeks. Feared lost.`;
  }
  if (party.reachedCapital) {
    return `${party.name} has reached the ancient capital.`;
  }
  const staleDays = 1 + Math.floor(Math.random() * 3);
  const reportDay = Math.max(1, Math.floor(currentDay) - staleDays);
  const ruinsText =
    party.ruinsFound === 0 ? 'found no ruins'
    : party.ruinsFound === RIVAL_TOTAL_RUINS ? `found all ${RIVAL_TOTAL_RUINS} ruins`
    : party.ruinsFound === 1 ? 'found 1 ruin'
    : `found ${party.ruinsFound} ruins`;
  const restText = party.restDaysRemaining > 0 ? ' Currently making camp — building a canoe or tending to the injured.' : '';
  return `${party.name}: as of day ${reportDay}, ~${party.milesTraveled.toFixed(0)} miles traveled, ${ruinsText}.${restText}`;
}
