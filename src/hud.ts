import type { PlayerStats } from "./playerStats";
import { getMoraleLabel, getMoraleEmoji, getWarmthLabel } from "./playerStats";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./constants";

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

export function createHud(
  seed?: string,
  onStopAction?: () => void,
  onDropCanoe?: () => void,
  onTogglePause?: () => void,
  onToggleQuests?: () => void,
  onQuestHover?: { enter: () => void; leave: () => void },
  onToggleLog?: () => void,
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
  ) => void;
  showMessage: (msg: string) => void;
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

  const actionEl = document.createElement("span");
  const conditionsEl = document.createElement("span");

  actionEl.style.color = "#90b8d0";
  conditionsEl.style.color = "#d08050";

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

  topBar.append(actionEl, stopBtn, conditionsEl);

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

  rightWrap.append(logBtn, questBtn, pauseBtn);

  if (seed !== undefined) {
    const seedLabel = document.createElement("span");
    seedLabel.textContent = seed;
    seedLabel.style.cssText =
      "color: #555; font: 11px monospace; letter-spacing: 0.03em;";

    const newWorldBtn = document.createElement("button");
    newWorldBtn.textContent = "↺";
    newWorldBtn.title = "New world";
    newWorldBtn.style.cssText = `
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
    newWorldBtn.addEventListener("mouseenter", () => {
      newWorldBtn.style.color = "#bbb";
      newWorldBtn.style.borderColor = "rgba(255,255,255,0.3)";
    });
    newWorldBtn.addEventListener("mouseleave", () => {
      newWorldBtn.style.color = "#666";
      newWorldBtn.style.borderColor = "rgba(255,255,255,0.12)";
    });
    newWorldBtn.addEventListener("click", () => {
      const newSeed = Math.random().toString(36).substring(2, 10);
      const url = new URL(window.location.href);
      url.searchParams.set("seed", newSeed);
      window.location.href = url.toString();
    });

    rightWrap.append(seedLabel, newWorldBtn);
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

  const dayEl = document.createElement("span");
  const milesEl = document.createElement("span");
  const altEl = document.createElement("span");
  const tempRowEl = document.createElement("span");

  dayEl.style.cssText = "color: #aaa; font: 14px/1 monospace;";
  milesEl.style.cssText = "color: #888; font: 11px/1 monospace;";
  altEl.style.cssText = "color: #888; font: 11px/1 monospace;";
  tempRowEl.style.cssText = "color: #888; font: 11px/1 monospace;";

  leftCol.append(dayEl, milesEl, altEl, tempRowEl);
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
  const rifleWidget = makeStatWidget("Rifle");
  rifleWidget.iconWrap.textContent = "🔫";
  rifleWidget.iconWrap.style.fontSize = "20px";

  // Pelts widget
  const peltsWidget = makeStatWidget("Pelts");
  peltsWidget.iconWrap.textContent = "🧣";
  peltsWidget.iconWrap.style.fontSize = "20px";

  // Canoe indicator (clickable)
  const canoeIndicator = document.createElement("div");
  canoeIndicator.title = "Drop canoe";
  canoeIndicator.style.cssText = `
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    cursor: pointer;
    pointer-events: auto;
    opacity: 1;
    transition: opacity 0.12s;
    width: 58px;
  `;

  const canoeTopLabel = document.createElement("div");
  canoeTopLabel.textContent = "DROP";
  canoeTopLabel.style.cssText =
    "color: #555; font: 11px/1 monospace; letter-spacing: 0.08em;";

  const canoeIconWrap = document.createElement("div");
  canoeIconWrap.style.cssText = `
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    font-size: 24px;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
  `;
  canoeIconWrap.textContent = "🛶";

  const canoeCount = document.createElement("div");
  canoeCount.style.cssText =
    "color: #888; font: 11px/1 monospace; letter-spacing: 0.04em; text-align: center; width: 100%;";
  canoeCount.textContent = "Canoe";

  canoeIndicator.append(canoeTopLabel, canoeIconWrap, canoeCount);
  canoeIndicator.addEventListener("mouseenter", () => {
    canoeIndicator.style.opacity = "0.6";
  });
  canoeIndicator.addEventListener("mouseleave", () => {
    canoeIndicator.style.opacity = "1";
  });
  if (onDropCanoe) canoeIndicator.addEventListener("click", onDropCanoe);

  rightInventory.append(rifleWidget.el, peltsWidget.el, canoeIndicator);
  bottomBar.append(rightInventory);

  // ── Layout: set bar heights to match letterbox bands ───────────────────
  function layout() {
    topBar.style.height = `${getTopBandHeight()}px`;
    bottomBar.style.height = `${getBottomBandHeight()}px`;
  }
  layout();
  window.addEventListener("resize", layout);

  // ── Temp message (e.g. "Out of ammunition") ───────────────────────────
  let tempMessage = "";
  let tempMsgTimeout: ReturnType<typeof setTimeout> | null = null;

  function showMessage(msg: string) {
    tempMessage = msg;
    if (tempMsgTimeout) clearTimeout(tempMsgTimeout);
    tempMsgTimeout = setTimeout(() => {
      tempMessage = "";
    }, 2000);
  }

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
  ) {
    pauseBtn.textContent = isPaused ? "▶" : "⏸";
    pauseBtn.title = isPaused ? "Resume (P)" : "Pause (P)";
    dayEl.textContent = formatTime(stats.daysTraveled);
    milesEl.textContent = `${distanceStr} from start`;
    altEl.textContent =
      elevFt !== undefined ? `${elevFt.toLocaleString()} ft elevation` : "";

    if (tempMessage) {
      actionEl.textContent = `· ${tempMessage}`;
      stopBtn.style.display = "none";
    } else if (stats.activeAction) {
      if (isFinite(stats.activeAction.durationDays)) {
        const pct = Math.min(
          stats.activeAction.progressDays / stats.activeAction.durationDays,
          1,
        );
        actionEl.textContent = `· ${stats.activeAction.label} ${Math.round(pct * 100)}%`;
      } else {
        const hours = Math.floor(stats.activeAction.progressDays * 24);
        actionEl.textContent = `· ${stats.activeAction.label} ${hours}h`;
      }
      const showStop =
        !isFinite(stats.activeAction.durationDays) ||
        stats.activeAction.id.startsWith("build_");
      stopBtn.style.display = showStop ? "inline-block" : "none";
    } else if (huntingMode) {
      actionEl.textContent = "· Hunting Mode 🔫";
      stopBtn.style.display = "none";
    } else {
      actionEl.textContent = portaging
        ? "· NOTE: Portaging the canoe is slow and tiring"
        : "";
      stopBtn.style.display = "none";
    }

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

    rifleWidget.bottom.textContent = `${stats.rifleAmmo}`;
    peltsWidget.bottom.textContent = `${stats.pelts}`;

    if (stats.canoes > 0) {
      canoeIndicator.style.display = "flex";
      canoeCount.textContent =
        stats.canoes > 1 ? `×${stats.canoes} Canoes` : "Canoe";
    } else {
      canoeIndicator.style.display = "none";
    }
  }

  return { update: updateHud, showMessage };
}
