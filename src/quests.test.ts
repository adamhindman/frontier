import { describe, it, expect, vi } from 'vitest';
import { QuestManager, registerQuestType, type Quest } from './quests';

function makeQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 'q1',
    type: 'find_and_name',
    title: 'Find it',
    description: 'desc',
    status: 'active',
    data: { pinId: 'pin1' },
    ...overrides,
  };
}

describe('QuestManager.add/remove', () => {
  it('adds a quest retrievable via getAll', () => {
    const mgr = new QuestManager();
    const q = makeQuest();
    mgr.add(q);
    expect(mgr.getAll()).toEqual([q]);
  });

  it('remove drops the quest without firing onComplete', () => {
    const onComplete = vi.fn();
    const mgr = new QuestManager({ onComplete });
    mgr.add(makeQuest({ id: 'q1' }));
    mgr.add(makeQuest({ id: 'q2' }));
    mgr.remove('q1');
    expect(mgr.getAll().map(q => q.id)).toEqual(['q2']);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('QuestManager.notify', () => {
  it('completes a matching find_and_name quest and fires onComplete once', () => {
    const onComplete = vi.fn();
    const mgr = new QuestManager({ onComplete });
    const q = makeQuest();
    mgr.add(q);
    mgr.notify('pin_renamed', { pinId: 'pin1' });
    expect(q.status).toBe('complete');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(q);
  });

  it('does not complete when pinId does not match', () => {
    const mgr = new QuestManager();
    const q = makeQuest();
    mgr.add(q);
    mgr.notify('pin_renamed', { pinId: 'other' });
    expect(q.status).toBe('active');
  });

  it('does not complete when event type does not match', () => {
    const mgr = new QuestManager();
    const q = makeQuest();
    mgr.add(q);
    mgr.notify('tile_entered', { pinId: 'pin1' });
    expect(q.status).toBe('active');
  });

  it('ignores quests that are already complete', () => {
    const onComplete = vi.fn();
    const mgr = new QuestManager({ onComplete });
    const q = makeQuest({ status: 'complete' });
    mgr.add(q);
    mgr.notify('pin_renamed', { pinId: 'pin1' });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('is a no-op for an unregistered quest type', () => {
    const mgr = new QuestManager();
    const q = makeQuest({ type: 'totally_unregistered_type' });
    mgr.add(q);
    expect(() => mgr.notify('pin_renamed', { pinId: 'pin1' })).not.toThrow();
    expect(q.status).toBe('active');
  });

  it('only completes the matching quest among several active ones', () => {
    const mgr = new QuestManager();
    const q1 = makeQuest({ id: 'q1', data: { pinId: 'pin1' } });
    const q2 = makeQuest({ id: 'q2', data: { pinId: 'pin2' } });
    mgr.add(q1);
    mgr.add(q2);
    mgr.notify('pin_renamed', { pinId: 'pin2' });
    expect(q1.status).toBe('active');
    expect(q2.status).toBe('complete');
  });
});

describe('QuestManager.getSaveData/restore', () => {
  it('getSaveData returns a deep copy — mutating original does not affect stored quest', () => {
    const mgr = new QuestManager();
    const q = makeQuest();
    mgr.add(q);
    const saved = mgr.getSaveData();
    saved[0].data.pinId = 'mutated';
    expect((mgr.getAll()[0].data as any).pinId).toBe('pin1');
  });

  it('restore replaces quests and deep-copies input data', () => {
    const mgr = new QuestManager();
    const incoming = [makeQuest({ id: 'restored' })];
    mgr.restore(incoming);
    incoming[0].data.pinId = 'mutated-after-restore';
    expect((mgr.getAll()[0].data as any).pinId).toBe('pin1');
    expect(mgr.getAll().map(q => q.id)).toEqual(['restored']);
  });
});

describe('registerQuestType', () => {
  it('allows registering a custom handler used by notify', () => {
    registerQuestType('custom_test_type', {
      checkComplete(quest, event) {
        return event.type === 'custom_event' && event.payload.done === true;
      },
    });
    const mgr = new QuestManager();
    const q = makeQuest({ type: 'custom_test_type', data: {} });
    mgr.add(q);
    mgr.notify('custom_event', { done: false });
    expect(q.status).toBe('active');
    mgr.notify('custom_event', { done: true });
    expect(q.status).toBe('complete');
  });
});
