import { describe, it, expect } from 'vitest';
import { StructureManager } from './structures';
import type { StructureType } from './structures';

// StructureManager constructor stores canvas/camera but never calls DOM methods —
// only add() does. Pass null to avoid a real canvas/camera dependency.
function makeManager(): StructureManager {
  return new StructureManager(null as any, null as any);
}

// Push a fake slot directly, bypassing the DOM-creating add() method.
function pushSlot(
  mgr: StructureManager,
  tileX: number, tileY: number,
  type: StructureType,
  complete = false,
) {
  (mgr as any).slots.push({
    tileX, tileY, type, complete,
    progressDays: 0, burnProgress: 0,
    el: {}, tooltipEl: {},
  });
}

// ── findUnfinished ────────────────────────────────────────────────────────────

describe('StructureManager.findUnfinished', () => {
  it('returns the slot index for an exact tile/type match', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinished(5, 3, 'canoe')).toBe(0);
  });

  it('returns -1 when tile does not match', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinished(6, 3, 'canoe')).toBe(-1);
  });

  it('returns -1 when the structure is complete', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe', true);
    expect(mgr.findUnfinished(5, 3, 'canoe')).toBe(-1);
  });

  it('returns -1 when type does not match', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'shelter');
    expect(mgr.findUnfinished(5, 3, 'canoe')).toBe(-1);
  });

  it('returns the correct index when multiple slots exist', () => {
    const mgr = makeManager();
    pushSlot(mgr, 1, 1, 'campfire');
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinished(5, 3, 'canoe')).toBe(1);
  });
});

// ── findUnfinishedNear ────────────────────────────────────────────────────────

describe('StructureManager.findUnfinishedNear', () => {
  it('finds an exact tile match (radius 1)', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinishedNear(5, 3, 'canoe', 1)).toBe(0);
  });

  it('finds a horizontally adjacent tile within radius 1', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinishedNear(6, 3, 'canoe', 1)).toBe(0);
  });

  it('finds a diagonally adjacent tile within radius 1', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinishedNear(6, 4, 'canoe', 1)).toBe(0);
  });

  it('returns -1 for a tile 2 away when radius is 1', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinishedNear(7, 3, 'canoe', 1)).toBe(-1);
  });

  it('finds a tile 2 away when radius is 2', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    expect(mgr.findUnfinishedNear(7, 3, 'canoe', 2)).toBe(0);
  });

  it('skips complete structures even within radius', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe', true);
    expect(mgr.findUnfinishedNear(5, 3, 'canoe', 1)).toBe(-1);
  });

  it('skips wrong type even within radius', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'shelter');
    expect(mgr.findUnfinishedNear(5, 3, 'canoe', 1)).toBe(-1);
  });

  it('returns the first matching slot index when multiple are nearby', () => {
    const mgr = makeManager();
    pushSlot(mgr, 5, 3, 'canoe');
    pushSlot(mgr, 6, 3, 'canoe');
    expect(mgr.findUnfinishedNear(6, 3, 'canoe', 1)).toBe(0); // slot 0 is within radius too
  });
});
