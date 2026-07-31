import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createRivalParties,
  tickRivalParties,
  getCapitalEncounterLine,
  getNewsReport,
  RIVAL_TOTAL_RUINS,
  CAPITAL_LEG_MILES,
  type RivalParty,
} from './rivalParties';

function makeParty(overrides: Partial<RivalParty> = {}): RivalParty {
  return {
    id: 'rival_0',
    name: 'The Test Expedition',
    milesTraveled: 0,
    ruinsFound: 0,
    status: 'active',
    restDaysRemaining: 0,
    capitalDistanceMiles: 1000,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRivalParties', () => {
  it('is deterministic for a given seed', () => {
    const a = createRivalParties('seed-a');
    const b = createRivalParties('seed-a');
    expect(a).toEqual(b);
  });

  it('creates 2 or 3 parties', () => {
    const parties = createRivalParties('some-seed');
    expect([2, 3]).toContain(parties.length);
  });

  it('assigns each party a capitalDistanceMiles within +/-15% of CAPITAL_LEG_MILES', () => {
    const parties = createRivalParties('another-seed');
    for (const p of parties) {
      expect(p.capitalDistanceMiles).toBeGreaterThanOrEqual(CAPITAL_LEG_MILES * 0.85 - 1e-9);
      expect(p.capitalDistanceMiles).toBeLessThanOrEqual(CAPITAL_LEG_MILES * 1.15 + 1e-9);
    }
  });

  it('gives every party a unique id and active status', () => {
    const parties = createRivalParties('id-seed');
    const ids = new Set(parties.map(p => p.id));
    expect(ids.size).toBe(parties.length);
    for (const p of parties) expect(p.status).toBe('active');
  });

  it('produces a different party set for a different seed', () => {
    const a = createRivalParties('seed-x');
    const b = createRivalParties('seed-y');
    expect(a).not.toEqual(b);
  });
});

describe('tickRivalParties', () => {
  it('does nothing for a lost party', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const p = makeParty({ status: 'lost', milesTraveled: 50 });
    tickRivalParties([p], 5);
    expect(p.milesTraveled).toBe(50);
  });

  it('does nothing for a party that already reached the capital', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const p = makeParty({ reachedCapital: true, milesTraveled: 50 });
    tickRivalParties([p], 5);
    expect(p.milesTraveled).toBe(50);
  });

  it('counts down restDaysRemaining without traveling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // avoid re-triggering rest
    const p = makeParty({ restDaysRemaining: 2 });
    tickRivalParties([p], 1);
    expect(p.restDaysRemaining).toBe(1);
    expect(p.milesTraveled).toBe(0);
  });

  it('enters rest when the rest-day roll succeeds, logging a resting message', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05); // < REST_DAILY_PROB (0.10)
    const p = makeParty();
    const messages = tickRivalParties([p], 1);
    expect(p.restDaysRemaining).toBeGreaterThanOrEqual(2);
    expect(p.restDaysRemaining).toBeLessThanOrEqual(4);
    expect(messages).toContain(`resting:${p.name}`);
  });

  it('accrues zero miles when the zero-mileage roll (r1 < 0.10) hits, after skipping rest', () => {
    // Sequence: rest roll (>=0.10 => no rest), r1 (<0.10 => zero miles), r2, lost roll
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99) // no rest
      .mockReturnValueOnce(0.05) // r1 < 0.10 -> zero miles
      .mockReturnValueOnce(0.5)  // r2 unused when zero
      .mockReturnValue(0.99);    // lost check etc
    const p = makeParty();
    tickRivalParties([p], 1);
    expect(p.milesTraveled).toBe(0);
  });

  it('accrues positive mileage on a normal travel day', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99) // no rest
      .mockReturnValueOnce(0.5)  // r1 >= 0.10
      .mockReturnValueOnce(0.5)  // r2
      .mockReturnValue(0.99);    // remaining rolls (ruin discovery, lost)
    const p = makeParty();
    tickRivalParties([p], 1);
    expect(p.milesTraveled).toBeGreaterThan(0);
  });

  it('discovers a ruin once mileage threshold is met and the discovery roll succeeds', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99) // no rest
      .mockReturnValueOnce(0.5)  // travel roll r1
      .mockReturnValueOnce(0.5)  // travel roll r2
      .mockReturnValueOnce(0.5)  // extra Math.random() inside dailyMiles calc (Math.min(r2, Math.random()))
      .mockReturnValueOnce(0.01) // ruin discovery roll < RUIN_DAILY_PROB (0.33)
      .mockReturnValue(0.99);    // lost check
    const p = makeParty({ milesTraveled: 30 }); // already above threshold[0]=25
    tickRivalParties([p], 1);
    expect(p.ruinsFound).toBe(1);
  });

  it('sets milesAtRuinsComplete and dayRuinsComplete on the 4th ruin', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99) // no rest
      .mockReturnValueOnce(0.5)  // travel r1
      .mockReturnValueOnce(0.5)  // travel r2
      .mockReturnValueOnce(0.5)  // extra Math.random() inside dailyMiles calc
      .mockReturnValueOnce(0.01) // ruin discovery succeeds
      .mockReturnValue(0.99);    // lost check
    const p = makeParty({ ruinsFound: RIVAL_TOTAL_RUINS - 1, milesTraveled: 900 });
    tickRivalParties([p], 1, 100);
    expect(p.ruinsFound).toBe(RIVAL_TOTAL_RUINS);
    expect(p.milesAtRuinsComplete).toBe(p.milesTraveled);
    expect(p.dayRuinsComplete).toBe(100);
  });

  it('reaches the capital once post-ruins mileage covers capitalDistanceMiles', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99) // no rest
      .mockReturnValueOnce(0.5)  // travel r1
      .mockReturnValueOnce(0.5)  // travel r2
      .mockReturnValue(0.99);    // no further ruin discovery (already done), no lost
    const p = makeParty({
      ruinsFound: RIVAL_TOTAL_RUINS,
      milesTraveled: 500,
      milesAtRuinsComplete: 490,
      capitalDistanceMiles: 5, // small threshold guaranteed to be exceeded this tick
    });
    const messages = tickRivalParties([p], 1, 10);
    expect(p.reachedCapital).toBe(true);
    expect(p.dayArrived).toBe(10);
    expect(messages).toContain(`arrived:${p.name}`);
  });

  it('does not mark a party lost when it is the only active party', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0001); // would trigger lost/rest otherwise
    const p = makeParty();
    tickRivalParties([p], 1);
    expect(p.status).toBe('active');
  });

  it('can mark a party lost when at least 2 active parties remain', () => {
    // rest roll no, travel rolls mid, ruin roll no, lost roll yes
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99) // no rest
      .mockReturnValueOnce(0.5)  // r1
      .mockReturnValueOnce(0.5)  // r2
      .mockReturnValue(0.0001);  // lost roll succeeds (also would affect ruin roll, but miles below threshold)
    const p1 = makeParty({ id: 'a' });
    const p2 = makeParty({ id: 'b' });
    tickRivalParties([p1, p2], 1);
    expect([p1.status, p2.status]).toContain('lost');
  });
});

describe('getCapitalEncounterLine', () => {
  it('returns a non-empty string regardless of who won', () => {
    expect(getCapitalEncounterLine(true).length).toBeGreaterThan(0);
    expect(getCapitalEncounterLine(false).length).toBeGreaterThan(0);
  });
});

describe('getNewsReport', () => {
  it('reports a lost party distinctly', () => {
    const p = makeParty({ status: 'lost' });
    expect(getNewsReport(p, 10)).toContain('Feared lost');
  });

  it('reports a party that reached the capital', () => {
    const p = makeParty({ reachedCapital: true });
    expect(getNewsReport(p, 10)).toContain('reached the ancient capital');
  });

  it('describes zero ruins found', () => {
    const p = makeParty({ ruinsFound: 0 });
    expect(getNewsReport(p, 10)).toContain('found no ruins');
  });

  it('describes exactly 1 ruin using singular phrasing', () => {
    const p = makeParty({ ruinsFound: 1 });
    expect(getNewsReport(p, 10)).toContain('found 1 ruin');
    expect(getNewsReport(p, 10)).not.toContain('found 1 ruins');
  });

  it('describes 2-3 ruins with a count', () => {
    const p = makeParty({ ruinsFound: 2 });
    expect(getNewsReport(p, 10)).toContain('found 2 ruins');
  });

  it('describes all ruins found', () => {
    const p = makeParty({ ruinsFound: RIVAL_TOTAL_RUINS });
    expect(getNewsReport(p, 10)).toContain(`found all ${RIVAL_TOTAL_RUINS} ruins`);
  });

  it('appends resting text when restDaysRemaining is positive', () => {
    const p = makeParty({ restDaysRemaining: 2 });
    expect(getNewsReport(p, 10)).toContain('Currently making camp');
  });

  it('omits resting text when not resting', () => {
    const p = makeParty({ restDaysRemaining: 0 });
    expect(getNewsReport(p, 10)).not.toContain('Currently making camp');
  });
});
