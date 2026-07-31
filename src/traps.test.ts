import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrapManager } from './traps';

function makeManager(): TrapManager {
  return new TrapManager(null as any, null as any);
}

// Push a fake trap directly, bypassing the DOM-creating add().
function pushTrap(mgr: TrapManager, tileX: number, tileY: number, biome: string, ageHours = 0) {
  const trap = { tileX, tileY, biome, ageHours, el: { remove() {} } };
  (mgr as any).traps.push(trap);
  return trap;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrapManager.advanceAge', () => {
  it('adds hours to every trap proportional to days elapsed', () => {
    const mgr = makeManager();
    pushTrap(mgr, 1, 1, 'forest', 5);
    pushTrap(mgr, 2, 2, 'plains', 10);
    mgr.advanceAge(1); // 24 hours
    const traps = (mgr as any).traps;
    expect(traps[0].ageHours).toBe(29);
    expect(traps[1].ageHours).toBe(34);
  });

  it('handles fractional days', () => {
    const mgr = makeManager();
    pushTrap(mgr, 1, 1, 'forest', 0);
    mgr.advanceAge(0.5); // 12 hours
    expect((mgr as any).traps[0].ageHours).toBe(12);
  });
});

describe('TrapManager.checkStep', () => {
  it('returns null when there is no trap on the tile', () => {
    const mgr = makeManager();
    pushTrap(mgr, 1, 1, 'forest', 100);
    expect(mgr.checkStep(5, 5)).toBeNull();
  });

  it('removes the trap from the array regardless of outcome', () => {
    const mgr = makeManager();
    pushTrap(mgr, 5, 5, 'forest', 100);
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // force a miss
    mgr.checkStep(5, 5);
    expect((mgr as any).traps.length).toBe(0);
  });

  it('always misses (caught:false) in a biome with an empty trappable pool (desert)', () => {
    const mgr = makeManager();
    pushTrap(mgr, 5, 5, 'desert', 100000);
    vi.spyOn(Math, 'random').mockReturnValue(0); // would otherwise always catch
    const result = mgr.checkStep(5, 5);
    expect(result).toEqual({ caught: false });
  });

  it('always misses in mountains (also an empty pool)', () => {
    const mgr = makeManager();
    pushTrap(mgr, 5, 5, 'mountains', 100000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = mgr.checkStep(5, 5);
    expect(result).toEqual({ caught: false });
  });

  it('never catches at ageHours=0 since the cumulative catch chance is 0', () => {
    const mgr = makeManager();
    pushTrap(mgr, 5, 5, 'forest', 0);
    vi.spyOn(Math, 'random').mockReturnValue(0); // any roll < chance would catch, but chance is 0
    const result = mgr.checkStep(5, 5);
    expect(result!.caught).toBe(false);
  });

  it('catches when the roll is below the cumulative catch chance for an aged trap', () => {
    const mgr = makeManager();
    pushTrap(mgr, 5, 5, 'forest', 100000); // very old -> catchChance approaches 1
    vi.spyOn(Math, 'random').mockReturnValue(0); // 0 < any positive chance
    const result = mgr.checkStep(5, 5);
    expect(result!.caught).toBe(true);
    expect(result!.emoji).toBeDefined();
    expect(result!.meatLbs).toBeGreaterThan(0);
  });

  it('misses when the roll is above the catch chance', () => {
    const mgr = makeManager();
    pushTrap(mgr, 5, 5, 'forest', 1); // small age -> small catch chance
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const result = mgr.checkStep(5, 5);
    expect(result!.caught).toBe(false);
  });

  it('returns a catch payload matching one of the biome pool entries', () => {
    const mgr = makeManager();
    pushTrap(mgr, 5, 5, 'plains', 100000);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)   // catch-chance roll: succeeds
      .mockReturnValueOnce(0);  // pickFromPool roll: picks first-weighted entry
    const result = mgr.checkStep(5, 5);
    expect(result!.caught).toBe(true);
    expect(['🐇', '🦃']).toContain(result!.emoji);
  });
});

describe('TrapManager.getSaveData', () => {
  it('maps traps to plain save entries', () => {
    const mgr = makeManager();
    pushTrap(mgr, 1, 2, 'forest', 12.5);
    expect(mgr.getSaveData()).toEqual([{ tileX: 1, tileY: 2, biome: 'forest', ageHours: 12.5 }]);
  });
});
