export interface LogEntry {
  text: string; // e.g. "Day 3: 4.2 miles traveled"
}

export function createActivityLog() {
  const entries: LogEntry[] = [];

  // --- Panel ---
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed;
    top: 44px;
    left: 50%;
    transform: translateX(-50%);
    width: 320px;
    max-height: 240px;
    overflow-y: auto;
    background: rgba(10,10,10,0.96);
    border: 1px solid rgba(255,255,255,0.12);
    border-top: none;
    border-radius: 0 0 6px 6px;
    padding: 8px 0;
    z-index: 1002;
    display: none;
    pointer-events: auto;
    box-shadow: 0 6px 24px rgba(0,0,0,0.6);
  `;
  document.body.appendChild(panel);

  let open = false;

  function renderEntries() {
    panel.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No log entries yet.';
      empty.style.cssText = 'color: #555; font: 11px monospace; padding: 6px 14px;';
      panel.appendChild(empty);
      return;
    }
    // Most recent first
    for (let i = entries.length - 1; i >= 0; i--) {
      const row = document.createElement('div');
      row.textContent = entries[i].text;
      row.style.cssText = `
        color: #aaa;
        font: 11px/1.7 monospace;
        padding: 2px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.04);
      `;
      panel.appendChild(row);
    }
  }

  function toggle() {
    open = !open;
    panel.style.display = open ? 'block' : 'none';
    if (open) renderEntries();
  }

  function close() {
    open = false;
    panel.style.display = 'none';
  }

  function addEntry(text: string) {
    entries.push({ text });
    if (open) renderEntries();
  }

  // Close when clicking outside
  window.addEventListener('click', (e) => {
    if (open && !panel.contains(e.target as Node)) close();
  });

  return { toggle, close, addEntry, isOpen: () => open };
}
