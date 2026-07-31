import { describe, it, expect } from 'vitest';
import { TimberPileManager } from './timberPiles';

function makeManager(): TimberPileManager {
  return new TimberPileManager(null as any, null as any);
}

// Push a fake pile directly, bypassing the DOM-creating createPile().
function pushPile(mgr: TimberPileManager, tileX: number, tileY: number, amount: number) {
  const pile = { tileX, tileY, amount, el: { remove() {} }, tooltipEl: { remove() {}, textContent: '' } };
  (mgr as any).piles.push(pile);
  return pile;
}

describe('TimberPileManager.addAmount (merge path)', () => {
  it('merges into an existing pile within radius 1 instead of creating a new one', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 5, 10);
    mgr.addAmount(5, 6, 4); // adjacent (dy=1)
    expect(mgr.getAdjacentAmount(5, 5)).toBe(14);
    expect((mgr as any).piles.length).toBe(1);
  });

  it('does not merge into the same tile (dx=0,dy=0 excluded from merge check)', () => {
    // existing pile check requires dx>0 || dy>0, so a pile ON nearTile itself doesn't match —
    // this call will fall through to placement logic (DOM-creating), so just verify it doesn't merge silently.
    const mgr = makeManager();
    const pile = pushPile(mgr, 5, 5, 10);
    // stub createPile to avoid DOM
    let created: any = null;
    (mgr as any).createPile = (tx: number, ty: number, amt: number) => { created = { tx, ty, amt }; };
    mgr.addAmount(5, 5, 4);
    expect(pile.amount).toBe(10); // unchanged
    expect(created).not.toBeNull();
  });

  it('does not merge a pile 2 tiles away', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 5, 10);
    let created: any = null;
    (mgr as any).createPile = (tx: number, ty: number, amt: number) => { created = { tx, ty, amt }; };
    mgr.addAmount(7, 5, 4);
    expect(created).not.toBeNull();
  });
});

describe('TimberPileManager.addAmount (placement path)', () => {
  it('places at radius-1 offset [0,1] when nothing is blocked', () => {
    const mgr = makeManager();
    let created: any = null;
    (mgr as any).createPile = (tx: number, ty: number, amt: number) => { created = { tx, ty, amt }; };
    mgr.addAmount(10, 10, 5);
    expect(created).toEqual({ tx: 10, ty: 11, amt: 5 });
  });

  it('falls through to radius 2 when all radius-1 offsets are water', () => {
    const mgr = makeManager();
    let created: any = null;
    (mgr as any).createPile = (tx: number, ty: number, amt: number) => { created = { tx, ty, amt }; };
    const isWater = (tx: number, ty: number) => Math.max(Math.abs(tx - 10), Math.abs(ty - 10)) <= 1;
    mgr.addAmount(10, 10, 5, isWater);
    expect(Math.max(Math.abs(created.tx - 10), Math.abs(created.ty - 10))).toBe(2);
  });

  it('falls back to [0,1] offset when everything within radius 2 is blocked', () => {
    const mgr = makeManager();
    let created: any = null;
    (mgr as any).createPile = (tx: number, ty: number, amt: number) => { created = { tx, ty, amt }; };
    mgr.addAmount(10, 10, 5, () => true);
    expect(created).toEqual({ tx: 10, ty: 11, amt: 5 });
  });

  it('skips occupied tiles the same as water tiles', () => {
    const mgr = makeManager();
    let created: any = null;
    (mgr as any).createPile = (tx: number, ty: number, amt: number) => { created = { tx, ty, amt }; };
    const isOccupied = (tx: number, ty: number) => tx === 10 && ty === 11; // block the default [0,1]
    mgr.addAmount(10, 10, 5, undefined, isOccupied);
    expect(created).not.toEqual({ tx: 10, ty: 11, amt: 5 });
  });
});

describe('TimberPileManager.getAmountWithin / getAdjacentAmount', () => {
  it('sums piles within the Chebyshev radius, excluding farther ones', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 5, 3);
    pushPile(mgr, 6, 5, 4); // dx=1 within radius 1
    pushPile(mgr, 7, 5, 100); // dx=2, excluded at radius 1
    expect(mgr.getAdjacentAmount(5, 5)).toBe(7);
  });

  it('excludes a tile where only one axis is within radius (Chebyshev, not circular)', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 7, 9); // dx=0, dy=2 -> excluded at radius 1
    expect(mgr.getAdjacentAmount(5, 5)).toBe(0);
  });

  it('getAmountWithin respects an arbitrary radius', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 7, 9); // dy=2
    expect(mgr.getAmountWithin(5, 5, 1)).toBe(0);
    expect(mgr.getAmountWithin(5, 5, 2)).toBe(9);
  });
});

describe('TimberPileManager.consumeFromAdjacent', () => {
  it('consumes from a single pile up to what is available', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 5, 3);
    const consumed = mgr.consumeFromAdjacent(5, 5, 10);
    expect(consumed).toBe(3);
    expect(mgr.getAdjacentAmount(5, 5)).toBe(0);
  });

  it('consumes nearest pile first when multiple are in range', () => {
    const mgr = makeManager();
    const far = pushPile(mgr, 6, 6, 5); // farther (dist ~1.41)
    const near = pushPile(mgr, 5, 6, 5); // nearer (dist 1)
    mgr.consumeFromAdjacent(5, 5, 3);
    expect(near.amount).toBe(2);
    expect(far.amount).toBe(5);
  });

  it('removes a pile once it drops below the 0.001 threshold', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 5, 2);
    mgr.consumeFromAdjacent(5, 5, 2);
    expect((mgr as any).piles.length).toBe(0);
  });

  it('returns less than requested when piles run dry', () => {
    const mgr = makeManager();
    pushPile(mgr, 5, 5, 2);
    const consumed = mgr.consumeFromAdjacent(5, 5, 10);
    expect(consumed).toBe(2);
  });

  it('returns 0 when there are no piles in range', () => {
    const mgr = makeManager();
    pushPile(mgr, 50, 50, 100);
    expect(mgr.consumeFromAdjacent(5, 5, 10)).toBe(0);
  });

  it('respects the radius parameter', () => {
    const mgr = makeManager();
    pushPile(mgr, 7, 5, 8); // dx=2
    expect(mgr.consumeFromAdjacent(5, 5, 3, 1)).toBe(0);
    expect(mgr.consumeFromAdjacent(5, 5, 3, 2)).toBe(3);
  });
});

describe('TimberPileManager.getSaveData', () => {
  it('maps piles to plain tileX/tileY/amount tuples', () => {
    const mgr = makeManager();
    pushPile(mgr, 1, 2, 3.5);
    expect(mgr.getSaveData()).toEqual([{ tileX: 1, tileY: 2, amount: 3.5 }]);
  });
});
