import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { AnimalManager, COIL_TRIGGER_RADIUS, COIL_FLEE_DISTANCE, WORKLIGHT_ATTRACT_RADIUS } from './animals';

// AnimalManager's constructor and killAnimal() touch `document` (tooltip/dead-emoji
// elements). This repo runs vitest in the plain "node" environment (no jsdom), so
// provide a minimal fake DOM sufficient for construction and the methods under test.
function fakeEl(): any {
  return { style: {}, textContent: '', appendChild() {}, addEventListener() {}, remove() {} };
}
beforeAll(() => {
  (globalThis as any).document = {
    createElement: () => fakeEl(),
    body: { appendChild() {} },
  };
});

// update() calls reposition(), which needs a canvas/camera to compute screen
// coordinates — unlike fireRay/scareAll/frightenAll, which don't touch either.
function fakeCanvas(): any {
  return { getBoundingClientRect: () => ({ width: 1536, height: 768, left: 0, top: 0 }) };
}
function fakeCamera(): any {
  return { position: { x: 0, y: 0 } };
}

function makeManager(): AnimalManager {
  const noise = (() => 0) as any;
  return new AnimalManager(fakeCanvas(), fakeCamera(), noise, noise, noise);
}

function pushAnimal(mgr: AnimalManager, overrides: Record<string, any> = {}) {
  const { def: defOverride, ...rest } = overrides;
  const def = {
    emoji: '🦌', name: 'Deer', biomes: ['plains'], rarity: 'common',
    fleeRadius: 5, fleeSpeed: 6, wanderSpeed: 1, meatLbs: 10, furPelts: 1,
    size: 18, hp: 1, prey: true,
    ...defOverride,
  };
  const animal = {
    def, x: 0, y: 0, targetX: 0, targetY: 0, el: fakeEl(),
    wanderTimer: 0, fleeing: false, gunFleeTimer: 0, chargingPlayer: false,
    hidden: false, currentHp: def.hp, blinkTimer: 0, dead: false, deadEl: null,
    predatorState: 'idle', retreatTimer: 0, attackCooldown: 0, ignoreTimer: 0,
    isManEater: false, manEaterQuestId: null, manEaterName: null, nameplateEl: null,
    ...rest,
  };
  (mgr as any).animals.push(animal);
  return animal;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AnimalManager.fireRay', () => {
  it('hits an animal directly in the ray path and decrements hp', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0, def: { hp: 5 } });
    mgr.fireRay(0, 0, 1, 0, 10);
    expect(a.currentHp).toBe(4);
    expect(a.dead).toBe(false);
  });

  it('kills the animal when hp reaches 0', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0, def: { hp: 1 } });
    mgr.fireRay(0, 0, 1, 0, 10);
    expect(a.currentHp).toBe(0);
    expect(a.dead).toBe(true);
  });

  it('misses an animal outside the hit radius perpendicular to the ray', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 2, def: { hp: 5 } }); // 2 tiles off-axis, HIT_RADIUS=0.25
    mgr.fireRay(0, 0, 1, 0, 10);
    expect(a.currentHp).toBe(5);
  });

  it('ignores animals beyond range', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 50, y: 0, def: { hp: 5 } });
    mgr.fireRay(0, 0, 1, 0, 10);
    expect(a.currentHp).toBe(5);
  });

  it('ignores dead and hidden animals', () => {
    const mgr = makeManager();
    const dead = pushAnimal(mgr, { x: 5, y: 0, dead: true, def: { hp: 5 } });
    const hidden = pushAnimal(mgr, { x: 6, y: 0, hidden: true, def: { hp: 5 } });
    mgr.fireRay(0, 0, 1, 0, 10);
    expect(dead.currentHp).toBe(5);
    expect(hidden.currentHp).toBe(5);
  });

  it('hits only the closest animal when several lie along the ray', () => {
    const mgr = makeManager();
    const near = pushAnimal(mgr, { x: 3, y: 0, def: { hp: 5 } });
    const far = pushAnimal(mgr, { x: 7, y: 0, def: { hp: 5 } });
    mgr.fireRay(0, 0, 1, 0, 10);
    expect(near.currentHp).toBe(4);
    expect(far.currentHp).toBe(5);
  });

  it('a surviving predator hit immediately rushes the shooter', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, {
      x: 5, y: 0,
      def: { hp: 5, prey: false, detectionRadius: 8 },
    });
    mgr.fireRay(1, 0, 1, 0, 10); // shooter at (1,0), same y as animal so the ray hits it
    expect(a.predatorState).toBe('rushing');
    expect(a.targetX).toBe(1);
    expect(a.targetY).toBe(0);
  });

  it('a surviving non-predator, non-prey animal falls back to old-style charging', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0, def: { hp: 5, prey: false } });
    mgr.fireRay(1, 0, 1, 0, 10);
    expect(a.chargingPlayer).toBe(true);
    expect(a.fleeing).toBe(true);
    expect(a.gunFleeTimer).toBe(8);
  });

  it('returns manEaterKilled trophy info when a man-eater dies', () => {
    const mgr = makeManager();
    pushAnimal(mgr, {
      x: 5, y: 0, isManEater: true, manEaterQuestId: 'q1', manEaterName: 'Old Scarface',
      def: { hp: 1, name: 'Bear' },
    });
    const result = mgr.fireRay(0, 0, 1, 0, 10);
    expect(result.manEaterKilled).toEqual({
      questId: 'q1', manEaterName: 'Old Scarface', animalName: 'Bear',
    });
  });

  it('omits manEaterKilled when the kill is a non-man-eater', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 5, y: 0, def: { hp: 1 } });
    const result = mgr.fireRay(0, 0, 1, 0, 10);
    expect(result.manEaterKilled).toBeUndefined();
  });

  it('returns the ray endpoint at full range when nothing is hit', () => {
    const mgr = makeManager();
    const result = mgr.fireRay(0, 0, 1, 0, 10);
    expect(result.endX).toBe(10);
    expect(result.endY).toBe(0);
  });
});

describe('AnimalManager.scareAll', () => {
  it('sends a prey animal fleeing away from the player when the random roll succeeds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // < 1/3, flees
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 10, y: 0 });
    mgr.scareAll(0, 0);
    expect(a.fleeing).toBe(true);
    expect(a.gunFleeTimer).toBe(8);
    expect(a.targetX).toBeCloseTo(20); // 10 tiles further along the same direction from player
  });

  it('does not flee when the random roll fails', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // > 1/3
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 10, y: 0 });
    mgr.scareAll(0, 0);
    expect(a.fleeing).toBe(false);
  });

  it('never scares predators (non-prey)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 10, y: 0, def: { prey: false } });
    mgr.scareAll(0, 0);
    expect(a.fleeing).toBe(false);
  });

  it('never scares man-eaters even if prey-typed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 10, y: 0, isManEater: true });
    mgr.scareAll(0, 0);
    expect(a.fleeing).toBe(false);
  });

  it('skips dead or hidden animals', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mgr = makeManager();
    const dead = pushAnimal(mgr, { x: 10, y: 0, dead: true });
    const hidden = pushAnimal(mgr, { x: 10, y: 0, hidden: true });
    mgr.scareAll(0, 0);
    expect(dead.fleeing).toBe(false);
    expect(hidden.fleeing).toBe(false);
  });
});

describe('AnimalManager.frightenAll', () => {
  it('sends a nearby predator fleeing and counts it', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0, def: { prey: false, detectionRadius: 8 } });
    const affected = mgr.frightenAll(0, 0);
    expect(affected).toBe(1);
    expect(a.predatorState).toBe('fleeing');
    expect(a.targetX).toBeCloseTo(5 + COIL_FLEE_DISTANCE);
  });

  it('affects man-eaters regardless of prey flag', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0, isManEater: true });
    const affected = mgr.frightenAll(0, 0);
    expect(affected).toBe(1);
    expect(a.predatorState).toBe('fleeing');
  });

  it('does not affect plain prey animals', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0 }); // default prey:true, no detectionRadius
    const affected = mgr.frightenAll(0, 0);
    expect(affected).toBe(0);
    expect(a.predatorState).toBe('idle');
  });

  it('ignores predators beyond COIL_TRIGGER_RADIUS', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: COIL_TRIGGER_RADIUS + 1, y: 0, def: { prey: false, detectionRadius: 8 } });
    const affected = mgr.frightenAll(0, 0);
    expect(affected).toBe(0);
    expect(a.predatorState).toBe('idle');
  });

  it('affects a predator exactly at the trigger radius boundary', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: COIL_TRIGGER_RADIUS, y: 0, def: { prey: false, detectionRadius: 8 } });
    const affected = mgr.frightenAll(0, 0);
    expect(affected).toBe(1);
    expect(a.predatorState).toBe('fleeing');
  });

  it('skips dead or hidden predators', () => {
    const mgr = makeManager();
    const dead = pushAnimal(mgr, { x: 5, y: 0, dead: true, def: { prey: false, detectionRadius: 8 } });
    const affected = mgr.frightenAll(0, 0);
    expect(affected).toBe(0);
    expect(dead.predatorState).toBe('idle');
  });
});

describe('AnimalManager.getDescriptionAt', () => {
  it('returns tooltip text for a living animal on the tile', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 5.5, y: 5.5, def: { name: 'Deer', meatLbs: 10, furPelts: 1, prey: true } });
    const desc = mgr.getDescriptionAt(5, 5);
    expect(desc).toContain('Deer');
    expect(desc).toContain('Passive');
  });

  it('returns null when no animal is on the tile', () => {
    const mgr = makeManager();
    expect(mgr.getDescriptionAt(5, 5)).toBeNull();
  });

  it('returns null for a dead or hidden animal on the tile', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 5.5, y: 5.5, dead: true });
    expect(mgr.getDescriptionAt(5, 5)).toBeNull();
  });

  it('includes the man-eater name for a man-eater on the tile', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 5.5, y: 5.5, isManEater: true, manEaterName: 'Old Scarface', def: { name: 'Bear' } });
    const desc = mgr.getDescriptionAt(5, 5);
    expect(desc).toContain('Old Scarface');
    expect(desc).toContain('Bear');
  });
});

describe('AnimalManager.collectAt', () => {
  it('collects and removes a dead animal within 1 tile, returning its yield', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 5.5, y: 5.5, dead: true, def: { meatLbs: 12, furPelts: 2 } });
    const result = mgr.collectAt(5, 5);
    expect(result).toEqual({ meatLbs: 12, furPelts: 2 });
    expect((mgr as any).animals.length).toBe(0);
  });

  it('returns null when there is no dead animal nearby', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 5.5, y: 5.5, dead: false });
    expect(mgr.collectAt(5, 5)).toBeNull();
  });

  it('returns null when the dead animal is out of range', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 50, y: 50, dead: true });
    expect(mgr.collectAt(5, 5)).toBeNull();
  });
});

describe('AnimalManager.getActiveManEaterPositions / getManEaterSaveData', () => {
  it('lists only living man-eaters with a quest id', () => {
    const mgr = makeManager();
    pushAnimal(mgr, { x: 5.5, y: 5.5, isManEater: true, manEaterQuestId: 'q1' });
    pushAnimal(mgr, { x: 6.5, y: 6.5, isManEater: true, manEaterQuestId: 'q2', dead: true });
    pushAnimal(mgr, { x: 7.5, y: 7.5, isManEater: false });
    const positions = mgr.getActiveManEaterPositions();
    expect(positions).toEqual([{ questId: 'q1', tileX: 5, tileY: 5 }]);
  });

  it('save data includes hp and name for living man-eaters only', () => {
    const mgr = makeManager();
    pushAnimal(mgr, {
      x: 5.5, y: 5.5, isManEater: true, manEaterQuestId: 'q1', manEaterName: 'Old Scarface',
      currentHp: 3, def: { name: 'Bear' },
    });
    pushAnimal(mgr, { x: 6.5, y: 6.5, isManEater: true, manEaterQuestId: 'q2', manEaterName: 'Dead One', dead: true });
    const saved = mgr.getManEaterSaveData();
    expect(saved).toEqual([{
      questId: 'q1', manEaterName: 'Old Scarface', animalName: 'Bear', x: 5.5, y: 5.5, currentHp: 3,
    }]);
  });
});

describe('AnimalManager.update — Worklight Lantern predator attraction', () => {
  const NOON = 0.5; // isDaylightFrac(0.5) is true
  const MIDNIGHT = 0; // isDaylightFrac(0) is false

  // Spawning is probabilistic (15% chance per update()); pin Math.random so it
  // never fires and pollutes the animals array with an extra creature.
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
  });

  it('pulls an idle predator into stalking when within range, even beyond its own detection radius', () => {
    const mgr = makeManager();
    // Bear-like: detectionRadius 7, but placed 12 tiles away — out of its own
    // range, within WORKLIGHT_ATTRACT_RADIUS (15).
    const a = pushAnimal(mgr, { x: 12, y: 0, def: { prey: false, detectionRadius: 7 } });
    mgr.update(0.1, 0, 0, NOON, true, true);
    expect(a.predatorState).toBe('stalking');
  });

  it('does not attract when the lantern is off, even within range but beyond detection radius', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 12, y: 0, def: { prey: false, detectionRadius: 7 } });
    mgr.update(0.1, 0, 0, NOON, true, false);
    expect(a.predatorState).toBe('idle');
  });

  it('does not attract a predator beyond WORKLIGHT_ATTRACT_RADIUS', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: WORKLIGHT_ATTRACT_RADIUS + 1, y: 0, def: { prey: false, detectionRadius: 7 } });
    mgr.update(0.1, 0, 0, NOON, true, true);
    expect(a.predatorState).toBe('idle');
  });

  it('attracts a predator exactly at the WORKLIGHT_ATTRACT_RADIUS boundary', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: WORKLIGHT_ATTRACT_RADIUS, y: 0, def: { prey: false, detectionRadius: 7 } });
    mgr.update(0.1, 0, 0, NOON, true, true);
    expect(a.predatorState).toBe('stalking');
  });

  it('does not affect prey animals (no predator AI)', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0 }); // default def: prey true, no detectionRadius
    mgr.update(0.1, 0, 0, NOON, true, true);
    expect(a.predatorState).toBe('idle');
  });

  it('does not affect man-eaters that are already dead', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 5, y: 0, dead: true, def: { prey: false, detectionRadius: 7 } });
    mgr.update(0.1, 0, 0, NOON, true, true);
    expect(a.predatorState).toBe('idle');
  });

  it('does not affect a predator hidden by the day/night visibility mismatch', () => {
    const mgr = makeManager();
    // Non-nocturnal predator, visible only in daytime — at midnight it's hidden
    // and skipped entirely regardless of the lantern.
    const a = pushAnimal(mgr, { x: 5, y: 0, def: { prey: false, detectionRadius: 7, nocturnal: false } });
    mgr.update(0.1, 0, 0, MIDNIGHT, true, true);
    expect(a.predatorState).toBe('idle');
  });

  it('still attracts man-eaters within range', () => {
    const mgr = makeManager();
    const a = pushAnimal(mgr, { x: 12, y: 0, isManEater: true, def: { prey: true, detectionRadius: undefined } });
    mgr.update(0.1, 0, 0, NOON, true, true);
    expect(a.predatorState).toBe('stalking');
  });
});
