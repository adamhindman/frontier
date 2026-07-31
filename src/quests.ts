// Quest engine.
//
// To add a new quest type: implement QuestHandler and call registerQuestType(key, handler).
// Quest handlers are pure — they receive the quest and the event; all mutable state lives
// in quest.data (persisted) or is derived at check time.

export type QuestStatus = 'active' | 'complete';

export interface Quest {
  id:          string;
  type:        string;
  title:       string;
  description: string;
  status:      QuestStatus;
  data:        Record<string, unknown>;
}

export interface QuestEvent {
  type:    string;
  payload: Record<string, unknown>;
}

export interface QuestHandler {
  checkComplete(quest: Quest, event: QuestEvent): boolean;
}

// --- Type registry ---

const registry = new Map<string, QuestHandler>();

export function registerQuestType(type: string, handler: QuestHandler): void {
  registry.set(type, handler);
}

// --- Manager ---

export class QuestManager {
  private quests:     Quest[]                    = [];
  private onComplete: ((quest: Quest) => void) | undefined;

  constructor(opts?: { onComplete?: (quest: Quest) => void }) {
    this.onComplete = opts?.onComplete;
  }

  add(quest: Quest): void {
    this.quests.push(quest);
  }

  // Silently drops a quest — for when its goal became moot (e.g. someone
  // else claimed the target first) rather than actually completed. Does not
  // fire onComplete.
  remove(id: string): void {
    this.quests = this.quests.filter(q => q.id !== id);
  }

  // Call this whenever a game event occurs that quests might care about.
  // eventType should be a namespaced string like 'pin_renamed', 'tile_entered', etc.
  notify(eventType: string, payload: Record<string, unknown>): void {
    const event: QuestEvent = { type: eventType, payload };
    for (const quest of this.quests) {
      if (quest.status !== 'active') continue;
      const handler = registry.get(quest.type);
      if (handler?.checkComplete(quest, event)) {
        quest.status = 'complete';
        this.onComplete?.(quest);
      }
    }
  }

  getAll(): readonly Quest[] {
    return this.quests;
  }

  getSaveData(): Quest[] {
    return this.quests.map(q => ({ ...q, data: { ...q.data } }));
  }

  restore(quests: Quest[]): void {
    this.quests = quests.map(q => ({ ...q, data: { ...q.data } }));
  }
}

// --- Built-in quest type: find_and_name ---
// data: { pinId: string }
// Completes when 'pin_renamed' fires for that pinId.

registerQuestType('find_and_name', {
  checkComplete(quest, event) {
    return (
      event.type === 'pin_renamed' &&
      event.payload.pinId === quest.data.pinId
    );
  },
});
