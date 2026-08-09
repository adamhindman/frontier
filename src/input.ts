export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export function createInputHandler(): InputState & {
  reset(): void;
  resetStale(maxAgeMs: number): void;
} {
  const keys = { up: false, down: false, left: false, right: false } as InputState & {
    reset(): void;
    resetStale(maxAgeMs: number): void;
  };

  const map: Record<string, keyof InputState> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  };

  // Timestamp of the most recent keydown (including OS auto-repeat) per
  // direction — lets resetStale() tell a genuinely-still-held key (repeat
  // events keep refreshing this) apart from one whose keyup silently never
  // arrived (see resetStale below).
  const lastDownAt: Record<keyof InputState, number> = { up: 0, down: 0, left: 0, right: 0 };

  keys.reset = () => { keys.up = keys.down = keys.left = keys.right = false; };

  // Clears only directions that look stale (no keydown/repeat within
  // maxAgeMs) instead of wiping all input state unconditionally. Used as the
  // macOS/Chrome stuck-key workaround on Meta keyup (see main.ts) — a plain
  // input.reset() there would also wipe out arrow keys that are still
  // physically held, which incorrectly cancels auto-walk if Cmd is tapped
  // more than once in quick succession while steering.
  keys.resetStale = (maxAgeMs: number) => {
    const now = performance.now();
    for (const k of ['up', 'down', 'left', 'right'] as const) {
      if (keys[k] && now - lastDownAt[k] > maxAgeMs) keys[k] = false;
    }
  };

  window.addEventListener('keydown', e => {
    const k = map[e.key];
    if (k) { keys[k] = true; lastDownAt[k] = performance.now(); e.preventDefault(); }
  });

  window.addEventListener('keyup', e => {
    const k = map[e.key];
    if (k) keys[k] = false;
  });

  // If the window loses focus while a key is held, the keyup never arrives.
  // Reset everything so the player doesn't keep moving after tabbing back in.
  window.addEventListener('blur', () => { keys.reset(); });

  return keys;
}
