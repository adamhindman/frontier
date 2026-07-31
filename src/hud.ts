import type { PlayerStats } from "./playerStats";
import { getMoraleLabel, getMoraleEmoji, getWarmthLabel, MILES_PER_TILE } from "./playerStats";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./constants";
import musketBasicUrl from "./assets/tiles/musket-basic.png";
import musketAdvancedUrl from "./assets/tiles/musket-advanced.png";
import peltUrl from "./assets/tiles/pelt-basic.png";
import gearUrl from "./assets/tiles/gear.png";
import itemsUrl from "./assets/tiles/items.png";

// Condition icon row (next to the day/season text in the bottom bar). Each
// entry's `active` mirrors the same thresholds the above-player status
// indicators use elsewhere, so the two stay consistent.
interface ConditionDef {
  id: string;
  emoji: string;
  title: string;
  lines: readonly [string, string]; // consequence, then suggested action
  active: (s: PlayerStats) => boolean;
  // Wet-only: a dynamic line shown in blue right under the title. Takes the
  // current ambient temperature so it can report the net felt temperature.
  blueLine?: (s: PlayerStats, ambientTempF: number) => string;
}
const CONDITION_DEFS: readonly ConditionDef[] = [
  { id: "hungry",   emoji: "🍖", title: "Hungry",   lines: ["You lose health slowly", "Eat food soon"],   active: s => s.food <= 0 },
  { id: "thirsty",  emoji: "💧", title: "Thirsty",  lines: ["You lose health quickly", "Drink water soon"], active: s => s.water <= 0 },
  { id: "cold",     emoji: "❄️", title: "Cold",     lines: ["The cold saps your health", "Get warm soon"], active: s => s.warmth < 50 },
  {
    id: "wet", emoji: "💦", title: "Wet",
    lines: ["Makes you feel colder", "Dry off by a fire or in shelter"],
    active: s => s.wetPenalty > 0,
    blueLine: (s, ambientTempF) => `Feels like ${Math.round(ambientTempF - s.wetPenalty)}°F`,
  },
  { id: "bleeding",  emoji: "🩸", title: "Bleeding",  lines: ["You lose health quickly", "Heal yourself"], active: s => s.bleeding },
  { id: "exhausted", emoji: "⚡", title: "Exhausted", lines: ["Drains health over time", "Rest soon"],     active: s => s.energy < 10 },
];

function makeConditionIcon(def: ConditionDef) {
  const el = document.createElement("span");
  el.textContent = def.emoji;
  el.style.cssText = "position: relative; display: none; line-height: 1; pointer-events: auto; cursor: default;";

  const tip = document.createElement("div");
  tip.style.cssText = `
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(14,14,14,0.95);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 5px;
    color: #ddd;
    font: 12px/1.5 monospace;
    padding: 6px 10px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 1100;
  `;
  const titleEl = document.createElement("div");
  titleEl.textContent = def.title;
  titleEl.style.cssText = "font-weight: bold; color: #fff;";
  const blueEl = document.createElement("div");
  blueEl.style.cssText = "color: #7ec8ff; display: none;";
  const line1El = document.createElement("div");
  line1El.textContent = def.lines[0];
  const line2El = document.createElement("div");
  line2El.textContent = def.lines[1];
  tip.append(titleEl, blueEl, line1El, line2El);

  el.appendChild(tip);
  el.addEventListener("mouseenter", () => { tip.style.opacity = "1"; });
  el.addEventListener("mouseleave", () => { tip.style.opacity = "0"; });

  return { el, tip, blueEl };
}

// Custom confirm dialog, styled to match the game's other modal popups
// (showCluePopup / showRaceIntro in main.ts) instead of the native browser confirm().
function showConfirmDialog(message: string, confirmLabel: string, onConfirm: () => void): void {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.72);
    display: flex; align-items: center; justify-content: center;
    z-index: 3500; font-family: monospace;
  `;
  const box = document.createElement("div");
  box.style.cssText = `
    background: rgba(18,14,8,0.98);
    border: 1px solid rgba(200,168,80,0.3);
    border-radius: 10px; padding: 32px 40px;
    max-width: 420px; width: 100%;
    display: flex; flex-direction: column; gap: 20px;
  `;
  const msg = document.createElement("div");
  msg.textContent = message;
  msg.style.cssText = "color: #d8c890; font-size: 13px; line-height: 1.7; text-align: center;";

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 12px; justify-content: center;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = `
    background: rgba(40,40,40,0.9); border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px; color: #d0d0d0; font: 13px monospace;
    padding: 10px 24px; cursor: pointer;
  `;
  cancelBtn.addEventListener("mouseenter", () => { cancelBtn.style.background = "rgba(70,70,70,0.95)"; cancelBtn.style.color = "#fff"; });
  cancelBtn.addEventListener("mouseleave", () => { cancelBtn.style.background = "rgba(40,40,40,0.9)"; cancelBtn.style.color = "#d0d0d0"; });

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = confirmLabel;
  confirmBtn.style.cssText = `
    background: rgba(120,40,30,0.85); border: 1px solid rgba(255,120,90,0.4);
    border-radius: 6px; color: #f0d0c8; font: 13px monospace;
    padding: 10px 24px; cursor: pointer;
  `;
  confirmBtn.addEventListener("mouseenter", () => { confirmBtn.style.background = "rgba(160,50,35,0.95)"; confirmBtn.style.color = "#fff"; });
  confirmBtn.addEventListener("mouseleave", () => { confirmBtn.style.background = "rgba(120,40,30,0.85)"; confirmBtn.style.color = "#f0d0c8"; });

  const dismiss = () => { overlay.remove(); window.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
  cancelBtn.addEventListener("click", dismiss);
  confirmBtn.addEventListener("click", () => { dismiss(); onConfirm(); });
  window.addEventListener("keydown", onKey);

  btnRow.append(cancelBtn, confirmBtn);
  box.append(msg, btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
}

function formatTime(daysFractional: number): string {
  const day = Math.floor(daysFractional) + 1;
  const hour = Math.floor((daysFractional % 1) * 24);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `Day ${day}, ${h12}${ampm}`;
}

function makeBarRow(label: string, color: string) {
  const row = document.createElement("div");
  row.style.cssText = "display: flex; align-items: center; gap: 8px;";
  const lbl = document.createElement("span");
  lbl.textContent = label;
  lbl.style.cssText =
    "color: #666; font: 11px monospace; width: 44px; text-align: left; flex-shrink: 0;";
  const track = document.createElement("div");
  track.style.cssText =
    "width: 110px; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; flex-shrink: 0;";
  const fill = document.createElement("div");
  fill.style.cssText = `height: 100%; width: 100%; background: ${color}; border-radius: 3px; transition: width 0.25s ease;`;
  track.appendChild(fill);
  const val = document.createElement("span");
  val.style.cssText =
    "color: #888; font: 11px monospace; width: 26px; flex-shrink: 0;";
  row.append(lbl, track, val);
  return { row, fill, val };
}

function makeTextRow(label: string) {
  const row = document.createElement("div");
  row.style.cssText = "display: flex; align-items: center; gap: 8px;";
  const lbl = document.createElement("span");
  lbl.textContent = label;
  lbl.style.cssText =
    "color: #666; font: 11px monospace; width: 44px; text-align: left; flex-shrink: 0;";
  const val = document.createElement("span");
  val.style.cssText = "color: #999; font: 11px monospace;";
  row.append(lbl, val);
  return { row, val };
}

// A reusable "stat widget": category label on top, large icon in the middle,
// descriptive text below. Used for morale and future stats in the bottom bar.
function makeStatWidget(topLabel: string) {
  const el = document.createElement("div");
  el.style.cssText =
    "display: flex; flex-direction: column; align-items: center; gap: 3px; width: 58px;";

  const top = document.createElement("div");
  top.textContent = topLabel.toUpperCase();
  top.style.cssText =
    "color: #555; font: 11px/1 monospace; letter-spacing: 0.08em;";

  const iconWrap = document.createElement("div");
  iconWrap.style.cssText = `
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    font-size: 24px;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
  `;

  const bottom = document.createElement("div");
  bottom.style.cssText =
    "color: #888; font: 11px/1 monospace; letter-spacing: 0.04em; text-align: center; width: 100%;";

  el.append(top, iconWrap, bottom);
  return { el, iconWrap, bottom };
}

// Total vertical space consumed by both bands combined.
function totalBandSpace(): number {
  const sa = window.innerWidth / window.innerHeight;
  const ca = CANVAS_WIDTH / CANVAS_HEIGHT;
  if (sa <= ca) return Math.max(0, window.innerHeight - window.innerWidth / ca);
  return 88; // pillarboxed fallback
}

// 25 % top / 75 % bottom split.
export function getTopBandHeight(): number {
  return Math.round(totalBandSpace() * 0.25);
}
export function getBottomBandHeight(): number {
  return totalBandSpace() - getTopBandHeight();
}

// Clickable or passive inventory item widget used in the right-side inventory strip.
function makeItemWidget(
  topLabel: string,
  emoji: string,
  clickable: boolean,
  onClick?: () => void,
  tooltip?: string,
) {
  const el = document.createElement("div");
  el.style.cssText = `
    position: relative;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    width: 58px;
    opacity: 1;
    transition: opacity 0.12s;
    pointer-events: ${clickable ? "auto" : "none"};
    ${clickable ? "cursor: pointer;" : ""}
  `;

  const topEl = document.createElement("div");
  topEl.textContent = topLabel;
  topEl.style.cssText = "color: #555; font: 11px/1 monospace; letter-spacing: 0.08em;";

  const iconWrap = document.createElement("div");
  iconWrap.style.cssText = `
    display: grid; place-items: center;
    width: 40px; height: 40px; font-size: 20px;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
  `;
  iconWrap.textContent = emoji;

  const bottomEl = document.createElement("div");
  bottomEl.style.cssText =
    "color: #888; font: 11px/1 monospace; text-align: center; width: 100%;";

  el.append(topEl, iconWrap, bottomEl);

  if (tooltip) {
    const tip = document.createElement("div");
    tip.textContent = tooltip;
    tip.style.cssText = `
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(14,14,14,0.95);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 5px;
      color: #bbb;
      font: 11px/1.5 monospace;
      padding: 6px 10px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 1100;
    `;
    el.appendChild(tip);
    el.style.pointerEvents = "auto";
    el.addEventListener("mouseenter", () => { tip.style.opacity = "1"; });
    el.addEventListener("mouseleave", () => { tip.style.opacity = "0"; });
  }

  if (clickable && onClick) {
    el.addEventListener("mouseenter", () => { el.style.opacity = "0.6"; });
    el.addEventListener("mouseleave", () => { el.style.opacity = "1"; });
    el.addEventListener("click", onClick);
  }

  return { el, bottomEl };
}

// A toggleable inventory-category icon. Clicking opens a popup column above it.
function makeGroupWidget(emoji: string, topLabel: string) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position: relative; display: none; align-items: center; flex-shrink: 0;";

  const btn = document.createElement("div");
  btn.style.cssText = `
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    flex-shrink: 0; width: 58px; cursor: pointer; pointer-events: auto;
    opacity: 1; transition: opacity 0.12s;
  `;

  const topEl = document.createElement("div");
  topEl.textContent = topLabel;
  topEl.style.cssText = "color: #555; font: 11px/1 monospace; letter-spacing: 0.08em;";

  const iconWrap = document.createElement("div");
  iconWrap.style.cssText = `
    display: grid; place-items: center; width: 40px; height: 40px; font-size: 20px;
    background: rgba(255,255,255,0.06); border-radius: 8px;
  `;
  iconWrap.textContent = emoji;

  const bottomEl = document.createElement("div");
  bottomEl.style.cssText =
    "color: #888; font: 11px/1 monospace; text-align: center; width: 100%;";

  btn.append(topEl, iconWrap, bottomEl);
  btn.addEventListener("mouseenter", () => { btn.style.opacity = "0.6"; });
  btn.addEventListener("mouseleave", () => { btn.style.opacity = "1"; });

  const popup = document.createElement("div");
  popup.style.cssText = `
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: rgba(10,10,10,0.96);
    border: 1px solid rgba(255,255,255,0.13);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.6);
    z-index: 1050;
    pointer-events: auto;
  `;

  wrapper.append(btn, popup);

  let open = false;
  function close() {
    open = false;
    popup.style.display = "none";
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    open = !open;
    popup.style.display = open ? "flex" : "none";
  });
  popup.addEventListener("click", (e) => e.stopPropagation());
  window.addEventListener("click", () => { if (open) close(); });

  return { wrapper, iconWrap, bottomEl, popup, close };
}

export function createHud(
  seed?: string,
  onStopAction?: () => void,
  onDropCanoe?: () => void,
  onTogglePause?: () => void,
  onToggleQuests?: () => void,
  onQuestHover?: { enter: () => void; leave: () => void },
  onToggleLog?: () => void,
  onUseMedicine?: () => void,
  onUseLiquor?: () => void,
  onUseLodestone?: () => void,
  onUseCoil?: () => void,
  onToggleLantern?: () => void,
  onSave?: () => void,
  onRestart?: () => void,
): {
  update: (
    stats: PlayerStats,
    timeTicking: boolean,
    distanceStr: string,
    ambientTempF: number,
    portaging?: boolean,
    weatherStr?: string,
    isPaused?: boolean,
    elevFt?: number,
    huntingMode?: boolean,
    seasonStr?: string,
  ) => void;
  flash: (msg: string, durationMs?: number) => void;
  updateVisited: (
    locations: { name: string; type: string; tileX: number; tileY: number }[],
    playerTileX: number,
    playerTileY: number,
  ) => void;
  togglePlaces: () => void;
} {
  // ── Top bar ────────────────────────────────────────────────────────────
  const topBar = document.createElement("div");
  topBar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0;
    display: flex; align-items: center; gap: 18px;
    padding: 0 24px;
    background: #000;
    color: #bbb; font: 13px/1 monospace;
    pointer-events: none; z-index: 1000; box-sizing: border-box;
  `;
  document.body.appendChild(topBar);

  const conditionsEl = document.createElement("span");
  conditionsEl.style.color = "#d08050";

  topBar.append(conditionsEl);

  // ── Status banner (top-center, below top bar) ──────────────────────────
  const bannerEl = document.createElement("div");
  bannerEl.style.cssText = `
    position: fixed; top: 52px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px;
    background: rgba(14,14,14,0.92);
    border: 1px solid rgba(255,255,255,0.13);
    border-radius: 6px;
    padding: 8px 16px;
    pointer-events: none; z-index: 1100;
    opacity: 0; transition: opacity 0.2s ease;
    white-space: nowrap;
  `;
  document.body.appendChild(bannerEl);

  const bannerTextEl = document.createElement("span");
  bannerTextEl.style.cssText = "color: #c8c0a0; font: 13px/1 monospace;";
  bannerEl.appendChild(bannerTextEl);

  const stopBtn = document.createElement("button");
  stopBtn.textContent = "■ Stop";
  stopBtn.style.cssText = `
    display: none;
    background: none;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    color: #c09060;
    font: 11px monospace;
    padding: 2px 7px;
    cursor: pointer;
    pointer-events: auto;
    flex-shrink: 0;
  `;
  stopBtn.addEventListener("mouseenter", () => {
    stopBtn.style.color = "#e0b080";
    stopBtn.style.borderColor = "rgba(255,255,255,0.3)";
  });
  stopBtn.addEventListener("mouseleave", () => {
    stopBtn.style.color = "#c09060";
    stopBtn.style.borderColor = "rgba(255,255,255,0.15)";
  });
  if (onStopAction) stopBtn.addEventListener("click", onStopAction);
  bannerEl.appendChild(stopBtn);

  let persistentMsg: string | null = null;
  let persistentShowStop = false;
  let transientMsg: string | null = null;
  let transientTimer: ReturnType<typeof setTimeout> | null = null;

  function refreshBanner() {
    const msg = transientMsg ?? persistentMsg;
    if (msg) {
      bannerTextEl.textContent = msg;
      bannerEl.style.opacity = "1";
      const showStop = !transientMsg && persistentShowStop;
      stopBtn.style.display = showStop ? "inline-block" : "none";
      bannerEl.style.pointerEvents = showStop ? "auto" : "none";
    } else {
      bannerEl.style.opacity = "0";
      bannerEl.style.pointerEvents = "none";
      stopBtn.style.display = "none";
    }
  }

  function flash(msg: string, durationMs = 2500) {
    transientMsg = msg;
    if (transientTimer) clearTimeout(transientTimer);
    transientTimer = setTimeout(() => {
      transientMsg = null;
      refreshBanner();
    }, durationMs);
    refreshBanner();
  }

  // ── Top-right controls ────────────────────────────────────────────────
  const rightWrap = document.createElement("div");
  rightWrap.style.cssText =
    "margin-left: auto; display: flex; align-items: center; gap: 10px; flex-shrink: 0;";

  const pauseBtn = document.createElement("button");
  pauseBtn.title = "Pause (P)";
  pauseBtn.textContent = "⏸";
  pauseBtn.style.cssText = `
    background: none;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: #666;
    font: 13px monospace;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    pointer-events: auto;
  `;
  pauseBtn.addEventListener("mouseenter", () => {
    pauseBtn.style.color = "#bbb";
    pauseBtn.style.borderColor = "rgba(255,255,255,0.3)";
  });
  pauseBtn.addEventListener("mouseleave", () => {
    pauseBtn.style.color = "#666";
    pauseBtn.style.borderColor = "rgba(255,255,255,0.12)";
  });
  if (onTogglePause) pauseBtn.addEventListener("click", onTogglePause);

  const questBtn = document.createElement("button");
  questBtn.title = "Quests (Q)";
  questBtn.textContent = "📜";
  questBtn.style.cssText = `
    background: none;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: #666;
    font: 13px monospace;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    pointer-events: auto;
  `;
  questBtn.addEventListener("mouseenter", () => {
    questBtn.style.color = "#bbb";
    questBtn.style.borderColor = "rgba(255,255,255,0.3)";
  });
  questBtn.addEventListener("mouseleave", () => {
    questBtn.style.color = "#666";
    questBtn.style.borderColor = "rgba(255,255,255,0.12)";
  });
  if (onToggleQuests) questBtn.addEventListener("click", onToggleQuests);
  if (onQuestHover) {
    questBtn.addEventListener("mouseenter", onQuestHover.enter);
    questBtn.addEventListener("mouseleave", onQuestHover.leave);
  }

  const logBtn = document.createElement("button");
  logBtn.title = "Log (L)";
  logBtn.textContent = "💬";
  logBtn.style.cssText = `
    background: none;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: #666;
    font: 13px monospace;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    pointer-events: auto;
  `;
  logBtn.addEventListener("mouseenter", () => {
    logBtn.style.color = "#bbb";
    logBtn.style.borderColor = "rgba(255,255,255,0.3)";
  });
  logBtn.addEventListener("mouseleave", () => {
    logBtn.style.color = "#666";
    logBtn.style.borderColor = "rgba(255,255,255,0.12)";
  });
  if (onToggleLog)
    logBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggleLog();
    });

  const saveBtn = document.createElement("button");
  saveBtn.title = "Save game (S)";
  saveBtn.textContent = "💾";
  saveBtn.style.cssText = `
    background: none;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: #666;
    font: 13px monospace;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    pointer-events: auto;
  `;
  saveBtn.addEventListener("mouseenter", () => {
    saveBtn.style.color = "#bbb";
    saveBtn.style.borderColor = "rgba(255,255,255,0.3)";
  });
  saveBtn.addEventListener("mouseleave", () => {
    saveBtn.style.color = "#666";
    saveBtn.style.borderColor = "rgba(255,255,255,0.12)";
  });
  if (onSave) saveBtn.addEventListener("click", onSave);

  // ── Visited locations panel ────────────────────────────────────────────
  const COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

  const placesBtn = document.createElement("button");
  placesBtn.title = "Visited locations (V)";
  placesBtn.textContent = "🗺️";
  placesBtn.style.cssText = `
    background: none;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: #666;
    font: 11px monospace;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    pointer-events: auto;
  `;
  placesBtn.addEventListener("mouseenter", () => {
    placesBtn.style.color = "#bbb";
    placesBtn.style.borderColor = "rgba(255,255,255,0.3)";
  });
  placesBtn.addEventListener("mouseleave", () => {
    placesBtn.style.color = "#666";
    placesBtn.style.borderColor = "rgba(255,255,255,0.12)";
  });

  const placesPanel = document.createElement("div");
  placesPanel.style.cssText = `
    position: fixed;
    right: 24px;
    min-width: 260px;
    background: rgba(8,8,8,0.97);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    padding: 10px 14px;
    z-index: 1100;
    display: none;
    pointer-events: auto;
    font: 12px/1.6 monospace;
    color: #aaa;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  `;
  document.body.appendChild(placesPanel);

  let placesOpen = false;

  function togglePlaces() {
    placesOpen = !placesOpen;
    placesPanel.style.display = placesOpen ? "block" : "none";
    if (placesOpen) placesPanel.style.top = `${getTopBandHeight() + 6}px`;
  }

  placesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlaces();
  });

  document.addEventListener("click", (e) => {
    if (placesOpen && !placesPanel.contains(e.target as Node) && e.target !== placesBtn) {
      placesOpen = false;
      placesPanel.style.display = "none";
    }
  });

  function updateVisited(
    locations: { name: string; type: string; tileX: number; tileY: number }[],
    playerTileX: number,
    playerTileY: number,
  ) {
    placesBtn.textContent = `🗺️${locations.length ? ` (${locations.length})` : ""}`;

    if (!placesOpen) return;

    placesPanel.innerHTML = "";

    if (locations.length === 0) {
      const msg = document.createElement("div");
      msg.textContent = "No locations visited yet.";
      msg.style.color = "#555";
      placesPanel.appendChild(msg);
      return;
    }

    for (const loc of locations) {
      const dx = loc.tileX - playerTileX;
      const dy = loc.tileY - playerTileY;
      const miles = Math.sqrt(dx * dx + dy * dy) * MILES_PER_TILE;
      const deg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
      const bearing = COMPASS_16[Math.round(deg / 22.5) % 16];
      const distStr = miles < 0.1 ? "here" : `${miles.toFixed(1)} mi ${bearing}`;

      const row = document.createElement("div");
      row.style.cssText = "display:flex; justify-content:space-between; gap:16px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.06);";

      const nameEl = document.createElement("span");
      nameEl.textContent = loc.name;
      nameEl.style.color =
        loc.type === "village"     ? "#8ab890" :
        loc.type === "settlement"  ? "#a09050" :
        loc.type === "ruins"       ? "#9a9a7a" :
        /* pin */                     "#7ab0c8";

      const distEl = document.createElement("span");
      distEl.textContent = distStr;
      distEl.style.cssText = "color:#555; white-space:nowrap;";

      row.append(nameEl, distEl);
      placesPanel.appendChild(row);
    }
  }

  rightWrap.append(placesBtn, saveBtn, logBtn, questBtn, pauseBtn);

  if (seed !== undefined) {
    const seedInput = document.createElement("input");
    seedInput.value = seed;
    seedInput.spellcheck = false;
    seedInput.style.cssText = `
      background: none;
      border: none;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      border-radius: 0;
      color: #555;
      font: 11px monospace;
      letter-spacing: 0.03em;
      width: 90px;
      outline: none;
      pointer-events: auto;
      padding: 0 2px;
    `;
    seedInput.addEventListener("focus", () => {
      seedInput.style.color = "#aaa";
      seedInput.style.borderBottomColor = "rgba(255,255,255,0.35)";
    });
    seedInput.addEventListener("blur", () => {
      seedInput.style.color = "#555";
      seedInput.style.borderBottomColor = "rgba(255,255,255,0.12)";
      if (!seedInput.value.trim()) seedInput.value = seed!;
    });

    function loadSeed() {
      const s = seedInput.value.trim();
      if (!s) return;
      const url = new URL(window.location.href);
      url.searchParams.set("seed", s);
      window.location.href = url.toString();
    }

    seedInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); loadSeed(); }
      e.stopPropagation(); // don't let typing trigger game hotkeys
    });

    const reloadBtn = document.createElement("button");
    reloadBtn.textContent = "Load";
    reloadBtn.title = "Load seed";
    reloadBtn.style.cssText = `
      background: none;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px;
      color: #666;
      font: 13px monospace;
      line-height: 1;
      padding: 2px 6px;
      cursor: pointer;
      pointer-events: auto;
    `;
    reloadBtn.addEventListener("mouseenter", () => {
      reloadBtn.style.color = "#bbb";
      reloadBtn.style.borderColor = "rgba(255,255,255,0.3)";
    });
    reloadBtn.addEventListener("mouseleave", () => {
      reloadBtn.style.color = "#666";
      reloadBtn.style.borderColor = "rgba(255,255,255,0.12)";
    });
    reloadBtn.addEventListener("click", loadSeed);

    const restartBtn = document.createElement("button");
    restartBtn.textContent = "New";
    restartBtn.title = "New game (new world)";
    restartBtn.style.cssText = `
      background: none;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px;
      color: #666;
      font: 13px monospace;
      line-height: 1;
      padding: 2px 6px;
      cursor: pointer;
      pointer-events: auto;
    `;
    restartBtn.addEventListener("mouseenter", () => {
      restartBtn.style.color = "#bbb";
      restartBtn.style.borderColor = "rgba(255,255,255,0.3)";
    });
    restartBtn.addEventListener("mouseleave", () => {
      restartBtn.style.color = "#666";
      restartBtn.style.borderColor = "rgba(255,255,255,0.12)";
    });
    restartBtn.addEventListener("click", () => {
      showConfirmDialog(
        "Start a new game in a new world? Your progress will be lost.",
        "Start New Game",
        () => onRestart?.(),
      );
    });

    rightWrap.append(seedInput, reloadBtn, restartBtn);
  }

  topBar.appendChild(rightWrap);

  // ── Bottom bar ─────────────────────────────────────────────────────────
  const bottomBar = document.createElement("div");
  bottomBar.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0;
    display: flex; align-items: center;
    padding: 0 28px;
    background: #000;
    pointer-events: none; z-index: 1000; box-sizing: border-box;
  `;
  document.body.appendChild(bottomBar);

  // Center group: all stat widgets
  const widgetGroup = document.createElement("div");
  widgetGroup.style.cssText = `
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 20px;
    pointer-events: none;
  `;
  bottomBar.appendChild(widgetGroup);

  const healthWidget = makeStatWidget("Health");
  healthWidget.iconWrap.textContent = "❤️";

  const energyWidget = makeStatWidget("Energy");
  energyWidget.iconWrap.textContent = "⚡";

  const tempWidget = makeStatWidget("Warmth");
  tempWidget.iconWrap.textContent = "🌡️";
  tempWidget.iconWrap.style.position = "relative";
  const warmthArrowEl = document.createElement("span");
  warmthArrowEl.style.cssText =
    "position:absolute;top:2px;right:3px;font:9px/1 monospace;font-weight:bold;";
  tempWidget.iconWrap.appendChild(warmthArrowEl);

  const foodWidget = makeStatWidget("Food");
  foodWidget.iconWrap.textContent = "🍖";

  const moraleWidget = makeStatWidget("Morale");

  const waterWidget = makeStatWidget("Water");
  waterWidget.iconWrap.textContent = "💧";

  widgetGroup.append(
    healthWidget.el,
    energyWidget.el,
    tempWidget.el,
    moraleWidget.el,
    foodWidget.el,
    waterWidget.el,
  );

  // Left: day/time, distance, temp+weather
  const leftCol = document.createElement("div");
  leftCol.style.cssText = `
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 9px;
    flex-shrink: 0;
    pointer-events: none;
  `;

  const dayRowEl = document.createElement("div");
  dayRowEl.style.cssText = "display: flex; align-items: center; gap: 8px; pointer-events: auto;";
  const dayEl = document.createElement("span");
  const milesEl = document.createElement("span");
  const altEl = document.createElement("span");
  const tempRowEl = document.createElement("span");

  dayEl.style.cssText = "color: #aaa; font: 14px/1 monospace;";
  milesEl.style.cssText = "color: #888; font: 11px/1 monospace;";
  altEl.style.cssText = "color: #888; font: 11px/1 monospace;";
  tempRowEl.style.cssText = "color: #888; font: 11px/1 monospace;";

  // Condition icons — same font-size as the day/season text they sit next to.
  const conditionIcons = CONDITION_DEFS.map(makeConditionIcon);
  const conditionsRowEl = document.createElement("div");
  conditionsRowEl.style.cssText = "display: flex; align-items: center; gap: 6px; font-size: 14px;";
  conditionsRowEl.append(...conditionIcons.map(c => c.el));

  dayRowEl.append(dayEl, conditionsRowEl);
  leftCol.append(dayRowEl, milesEl, altEl, tempRowEl);
  bottomBar.appendChild(leftCol);

  // Right: inventory row — rifle, pelts, canoe (each a small stat widget)
  const rightInventory = document.createElement("div");
  rightInventory.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: auto;
    flex-shrink: 0;
  `;

  // Rifle widget
  const rifleWidget = makeStatWidget("Musket");
  const musketImg = document.createElement("img");
  musketImg.src = musketBasicUrl;
  musketImg.style.cssText = "width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;";
  rifleWidget.iconWrap.appendChild(musketImg);

  // Pelts widget
  const peltsWidget = makeStatWidget("Pelts");
  const peltImg = document.createElement("img");
  peltImg.src = peltUrl;
  peltImg.style.cssText = "width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;";
  peltsWidget.iconWrap.appendChild(peltImg);

  // Equipment group: coat, waders, canoe
  const equipGroup = makeGroupWidget("", "GEAR");
  const equipImg = document.createElement("img");
  equipImg.src = gearUrl;
  equipImg.style.cssText = "width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;";
  equipGroup.iconWrap.appendChild(equipImg);
  const coatItem      = makeItemWidget("COAT",    "🧥", false, undefined, "Ambient temperature feels\n+10°F warmer");
  const wadersItem    = makeItemWidget("WADERS",  "👖", false, undefined, "Cross shallow water\nwithout a canoe");
  const cramponsItem  = makeItemWidget("CRAMPONS","🥾", false, undefined, "+50% speed in mountains\nand hills");
  const toolsItem     = makeItemWidget("TOOLS",   "🧰", false, undefined, "Halves canoe and shelter\nbuild time");
  const nightBootsItem = makeItemWidget("NIGHT BOOTS", "👢", false, undefined, "+50% travel speed at\nnight (foot only)");
  const musketItem    = makeItemWidget("MUSKET",  "", false, undefined, "+2 range · less wobble\n· less inaccuracy");
  const musketGearImg = document.createElement("img");
  musketGearImg.style.cssText = "width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;";
  musketGearImg.src = musketBasicUrl;
  (musketItem.el.children[1] as HTMLElement).replaceChildren(musketGearImg);
  const canoeItem     = makeItemWidget("CANOE",   "🛶", true,  () => { onDropCanoe?.(); equipGroup.close(); }, "Drop canoe here\nto use later");
  equipGroup.popup.append(coatItem.el, wadersItem.el, cramponsItem.el, toolsItem.el, nightBootsItem.el, musketItem.el, canoeItem.el);

  // Consumables group: liquor, medicine, lodestone
  const consumGroup = makeGroupWidget("", "ITEMS");
  const itemsImg = document.createElement("img");
  itemsImg.src = itemsUrl;
  itemsImg.style.cssText = "width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;";
  consumGroup.iconWrap.appendChild(itemsImg);
  const liquorItem    = makeItemWidget("LIQUOR",    "🍶", true, () => { onUseLiquor?.();    consumGroup.close(); }, "Restores morale & warmth");
  const medicItem     = makeItemWidget("MEDICINE",  "💊", true, () => { onUseMedicine?.();  consumGroup.close(); }, "Fully restores health");
  const lodestoneItem = makeItemWidget("LODESTONE", "🧲", true, () => { onUseLodestone?.(); },                      "Points toward the\nnearest nameless ruins");
  const coilItem      = makeItemWidget("SHRIEKING COIL", "🌀", true, () => { onUseCoil?.(); },                      "Scares aggressive creatures\nwithin 10 tiles");
  const lanternItem   = makeItemWidget("WORKLIGHT LANTERN", "🏮", true, () => { onToggleLantern?.(); },              "Lets you work at night,\nbut draws predators\nwithin 15 tiles");
  consumGroup.popup.append(liquorItem.el, medicItem.el, lodestoneItem.el, coilItem.el, lanternItem.el);

  rightInventory.append(rifleWidget.el, peltsWidget.el, equipGroup.wrapper, consumGroup.wrapper);
  bottomBar.append(rightInventory);

  // ── Layout: set bar heights to match letterbox bands ───────────────────
  function layout() {
    topBar.style.height = `${getTopBandHeight()}px`;
    bottomBar.style.height = `${getBottomBandHeight()}px`;
    bannerEl.style.top = `${getTopBandHeight() + 8}px`;
  }
  layout();
  window.addEventListener("resize", layout);

  // ── Update (called every frame) ────────────────────────────────────────
  let prevWarmth = -1;
  function updateHud(
    stats: PlayerStats,
    _timeTicking: boolean,
    distanceStr: string,
    ambientTempF: number,
    portaging = false,
    weatherStr?: string,
    isPaused = false,
    elevFt?: number,
    huntingMode = false,
    seasonStr?: string,
  ) {
    pauseBtn.textContent = isPaused ? "▶" : "⏸";
    pauseBtn.title = isPaused ? "Resume (P)" : "Pause (P)";
    dayEl.textContent = seasonStr
      ? `${formatTime(stats.daysTraveled)} · ${seasonStr}`
      : formatTime(stats.daysTraveled);
    CONDITION_DEFS.forEach((def, i) => {
      const icon = conditionIcons[i];
      const isActive = def.active(stats);
      icon.el.style.display = isActive ? "inline-block" : "none";
      if (isActive && def.blueLine) {
        icon.blueEl.textContent = def.blueLine(stats, ambientTempF);
        icon.blueEl.style.display = "block";
      } else {
        icon.blueEl.style.display = "none";
      }
    });
    milesEl.textContent = distanceStr === "at start" ? "No surveys taken" : distanceStr;
    altEl.textContent =
      elevFt !== undefined ? `${elevFt.toLocaleString()} ft elevation` : "";

    if (stats.activeAction) {
      let actionText: string;
      if (isFinite(stats.activeAction.durationDays)) {
        const pct = Math.min(
          stats.activeAction.progressDays / stats.activeAction.durationDays,
          1,
        );
        actionText = `${stats.activeAction.label} · ${Math.round(pct * 100)}%`;
      } else {
        const hours = Math.floor(stats.activeAction.progressDays * 24);
        actionText = `${stats.activeAction.label} · ${hours}h`;
      }
      persistentMsg = actionText;
      persistentShowStop =
        !isFinite(stats.activeAction.durationDays) ||
        stats.activeAction.id.startsWith("build_");
    } else if (huntingMode) {
      persistentMsg = "Musket mode 🔫";
      persistentShowStop = false;
    } else if (portaging) {
      persistentMsg = "😰 Portaging the canoe";
      persistentShowStop = false;
    } else {
      persistentMsg = null;
      persistentShowStop = false;
    }
    refreshBanner();

    conditionsEl.textContent = stats.statusConditions
      .map((c) => `! ${c.label}`)
      .join("  ");

    healthWidget.iconWrap.textContent = stats.health < 50 ? "❤️‍🩹" : "❤️";
    healthWidget.bottom.textContent = String(Math.round(stats.health));
    energyWidget.bottom.textContent = String(Math.round(stats.energy));
    tempWidget.bottom.textContent = getWarmthLabel(stats.warmth);
    if (prevWarmth >= 0) {
      const delta = stats.warmth - prevWarmth;
      if (delta > 0.02) {
        warmthArrowEl.textContent = "▲";
        warmthArrowEl.style.color = "#5c5";
      } else if (delta < -0.02) {
        warmthArrowEl.textContent = "▼";
        warmthArrowEl.style.color = "#c55";
      } else {
        warmthArrowEl.textContent = "";
      }
    }
    prevWarmth = stats.warmth;
    tempRowEl.textContent = weatherStr
      ? `${Math.round(ambientTempF)}°F · ${weatherStr}`
      : `${Math.round(ambientTempF)}°F`;
    foodWidget.bottom.textContent = `${stats.food.toFixed(1)} lbs`;
    waterWidget.bottom.textContent = `${stats.water.toFixed(1)} gal`;
    moraleWidget.iconWrap.textContent = getMoraleEmoji(stats.morale);
    moraleWidget.bottom.textContent = getMoraleLabel(stats.morale);

    musketImg.src = stats.precisionRifle > 0 ? musketAdvancedUrl : musketBasicUrl;
    rifleWidget.bottom.textContent = `${stats.rifleAmmo}`;
    peltsWidget.bottom.textContent = `${stats.pelts}`;

    // Equipment popup items
    coatItem.el.style.display     = stats.heavyCoat      > 0 ? "flex" : "none";
    coatItem.bottomEl.textContent = stats.heavyCoat      > 1 ? `×${stats.heavyCoat}` : "Equipped";
    wadersItem.el.style.display     = stats.hipWaders    > 0 ? "flex" : "none";
    wadersItem.bottomEl.textContent = stats.hipWaders    > 1 ? `×${stats.hipWaders}` : "Equipped";
    cramponsItem.el.style.display     = stats.crampons   > 0 ? "flex" : "none";
    cramponsItem.bottomEl.textContent = "Equipped";
    toolsItem.el.style.display     = stats.tools         > 0 ? "flex" : "none";
    toolsItem.bottomEl.textContent = "Equipped";
    nightBootsItem.el.style.display     = stats.nightBoots > 0 ? "flex" : "none";
    nightBootsItem.bottomEl.textContent = "Equipped";
    musketItem.el.style.display     = stats.precisionRifle > 0 ? "flex" : "none";
    musketItem.bottomEl.textContent = "Equipped";
    musketGearImg.src = stats.precisionRifle > 0 ? musketAdvancedUrl : musketBasicUrl;
    canoeItem.el.style.display     = stats.canoes        > 0 ? "flex" : "none";
    canoeItem.bottomEl.textContent = stats.canoes        > 1 ? `×${stats.canoes}` : "Drop";
    const equipCount = (stats.heavyCoat > 0 ? 1 : 0) + (stats.hipWaders > 0 ? 1 : 0)
                     + (stats.crampons > 0 ? 1 : 0) + (stats.tools > 0 ? 1 : 0)
                     + (stats.nightBoots > 0 ? 1 : 0)
                     + (stats.precisionRifle > 0 ? 1 : 0) + stats.canoes;
    equipGroup.wrapper.style.display = equipCount > 0 ? "flex" : "none";
    equipGroup.bottomEl.textContent = equipCount > 0 ? String(equipCount) : "";

    // Consumables popup items
    liquorItem.el.style.display = stats.liquor > 0 ? "flex" : "none";
    liquorItem.bottomEl.textContent = stats.liquor > 1 ? `×${stats.liquor}` : "Use";
    medicItem.el.style.display = stats.medicine > 0 ? "flex" : "none";
    medicItem.bottomEl.textContent = stats.medicine > 1 ? `×${stats.medicine}` : "Use";
    lodestoneItem.el.style.display = stats.lodestone > 0 ? "flex" : "none";
    lodestoneItem.bottomEl.textContent = "Locate";
    coilItem.el.style.display = stats.shriekingCoil > 0 ? "flex" : "none";
    coilItem.bottomEl.textContent = "Activate";
    lanternItem.el.style.display = stats.worklightLantern > 0 ? "flex" : "none";
    lanternItem.bottomEl.textContent = stats.worklightOn ? "Lit — Tap to Douse" : "Tap to Light";
    const consumCount = stats.liquor + stats.medicine + (stats.lodestone > 0 ? 1 : 0) + (stats.shriekingCoil > 0 ? 1 : 0) + (stats.worklightLantern > 0 ? 1 : 0);
    consumGroup.wrapper.style.display = consumCount > 0 ? "flex" : "none";
    consumGroup.bottomEl.textContent = consumCount > 0 ? String(consumCount) : "";
  }

  return { update: updateHud, flash, updateVisited, togglePlaces };
}
