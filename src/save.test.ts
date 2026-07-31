import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveGame,
  loadGame,
  deleteSave,
  saveManualGame,
  loadManualGame,
  hasManualSave,
  promoteManualToAuto,
  cleanLegacySaves,
} from './save';
import { createStats } from './playerStats';

// Node's built-in `localStorage` global requires a --localstorage-file flag to
// actually function; under vitest it's an inert stub. Use a minimal in-memory
// polyfill instead so save.ts's real localStorage calls work in tests.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  get length(): number { return this.store.size; }
}
(globalThis as any).localStorage = new MemoryStorage();

const AUTO_KEY = 'frontier_autosave';
const MANUAL_KEY = 'frontier_manualsave';

function minimalArgs(stats: any) {
  return [
    'seed-1', 42, stats,
    1, 2, 0, 0,
    [], [], [],
    undefined, undefined, undefined,
  ] as [string, number, any, number, number, number, number, any[], any[], any[], undefined, undefined, undefined];
}

beforeEach(() => {
  localStorage.clear();
});

describe('saveGame / loadGame round-trip', () => {
  it('persists and reloads core fields', () => {
    const stats = createStats();
    saveGame(...minimalArgs(stats));
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.seed).toBe('seed-1');
    expect(loaded!.weatherSeed).toBe(42);
    expect(loaded!.playerTileX).toBe(1);
    expect(loaded!.playerTileY).toBe(2);
  });

  it('strips activeAction to null on save', () => {
    const stats = createStats();
    (stats as any).activeAction = { id: 'rest', label: 'Resting', durationDays: 1, progressDays: 0 };
    saveGame(...minimalArgs(stats));
    const loaded = loadGame();
    expect(loaded!.stats.activeAction).toBeNull();
  });

  it('returns null when no save exists', () => {
    expect(loadGame()).toBeNull();
  });

  it('returns null and discards data on version mismatch', () => {
    localStorage.setItem(AUTO_KEY, JSON.stringify({ version: 1, seed: 'old', stats: {} }));
    expect(loadGame()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(AUTO_KEY, 'not valid json {{{');
    expect(loadGame()).toBeNull();
  });

  it('backfills missing legacy fields with defaults', () => {
    const stats = createStats();
    saveGame(...minimalArgs(stats));
    // Simulate an old save missing newer fields by rewriting raw storage.
    const raw = JSON.parse(localStorage.getItem(AUTO_KEY)!);
    delete raw.stats.foodConsumed;
    delete raw.stats.trophies;
    delete raw.stats.bleeding;
    delete raw.stats.artifacts;
    localStorage.setItem(AUTO_KEY, JSON.stringify(raw));

    const loaded = loadGame();
    expect(loaded!.stats.foodConsumed).toBe(0);
    expect(loaded!.stats.trophies).toEqual([]);
    expect(loaded!.stats.bleeding).toBe(false);
    expect(loaded!.stats.artifacts).toEqual([]);
  });

  it('deleteSave removes the autosave', () => {
    const stats = createStats();
    saveGame(...minimalArgs(stats));
    deleteSave();
    expect(loadGame()).toBeNull();
  });
});

describe('saveManualGame / loadManualGame round-trip', () => {
  it('persists independently from the autosave slot', () => {
    const stats = createStats();
    saveGame(...minimalArgs(stats));
    const manualStats = createStats();
    (manualStats as any).food = 5;
    saveManualGame(...minimalArgs(manualStats));

    expect(loadGame()!.stats.food).not.toBe(5);
    expect(loadManualGame()!.stats.food).toBe(5);
  });

  it('returns null on version mismatch', () => {
    localStorage.setItem(MANUAL_KEY, JSON.stringify({ version: 999, seed: 'old', stats: {} }));
    expect(loadManualGame()).toBeNull();
  });
});

describe('hasManualSave', () => {
  it('is false when no manual save exists', () => {
    expect(hasManualSave()).toBe(false);
  });

  it('is true after a manual save is written', () => {
    saveManualGame(...minimalArgs(createStats()));
    expect(hasManualSave()).toBe(true);
  });
});

describe('promoteManualToAuto', () => {
  it('returns null when there is no manual save', () => {
    expect(promoteManualToAuto()).toBeNull();
  });

  it('copies the manual save into the auto slot and returns its seed', () => {
    saveManualGame(...minimalArgs(createStats()));
    const seed = promoteManualToAuto();
    expect(seed).toBe('seed-1');
    expect(loadGame()!.seed).toBe('seed-1');
  });
});

describe('cleanLegacySaves', () => {
  it('removes frontier_-prefixed keys other than the auto/manual slots, leaving those intact', () => {
    saveGame(...minimalArgs(createStats()));
    saveManualGame(...minimalArgs(createStats()));
    localStorage.setItem('frontier_expedition-1', '{"legacy":true}');
    localStorage.setItem('frontier_old-seed', '{"legacy":true}');
    localStorage.setItem('unrelated_key', 'keep-me');

    cleanLegacySaves();

    expect(localStorage.getItem('frontier_expedition-1')).toBeNull();
    expect(localStorage.getItem('frontier_old-seed')).toBeNull();
    expect(localStorage.getItem('unrelated_key')).toBe('keep-me');
    expect(localStorage.getItem(AUTO_KEY)).not.toBeNull();
    expect(localStorage.getItem(MANUAL_KEY)).not.toBeNull();
  });
});
