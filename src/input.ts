export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export function createInputHandler(): InputState & { reset(): void } {
  const keys = { up: false, down: false, left: false, right: false } as InputState & { reset(): void };

  const map: Record<string, keyof InputState> = {
    ArrowUp: 'up',    w: 'up',
    ArrowDown: 'down', s: 'down',
    ArrowLeft: 'left', a: 'left',
    ArrowRight: 'right', d: 'right',
  };

  keys.reset = () => { keys.up = keys.down = keys.left = keys.right = false; };

  window.addEventListener('keydown', e => {
    const k = map[e.key];
    if (k) { keys[k] = true; e.preventDefault(); }
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
