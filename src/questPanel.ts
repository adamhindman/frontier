import type { QuestManager } from "./quests";
import { getTopBandHeight } from "./hud";
import type { ManEaterQuest } from "./manEaterQuests";
import { questDescription, MANEATER_QUEST_EXPIRE_DAYS } from "./manEaterQuests";

export function createQuestPanel(
  questManager: QuestManager,
  getManEaterQuests: () => ManEaterQuest[] = () => [],
  getTrophyQuestIds: () => string[] = () => [],
) {
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed;
    right: 24px;
    min-width: 280px;
    max-width: 380px;
    background: #f5e6c0;
    border: 1px solid #c4a060;
    border-radius: 3px;
    padding: 16px 20px 18px;
    z-index: 1100;
    display: none;
    pointer-events: auto;
    font: 14px/1.65 Georgia, 'Book Antiqua', 'Palatino Linotype', serif;
    color: #3d2614;
    box-shadow: 2px 6px 20px rgba(0,0,0,0.38);
  `;
  document.body.appendChild(panel);

  const titleRow = document.createElement("div");
  titleRow.style.cssText = `
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 14px;
    border-bottom: 1px solid #c4a060;
    padding-bottom: 10px;
  `;

  const titleEl = document.createElement("div");
  titleEl.textContent = "Quest Log";
  titleEl.style.cssText = `
    font: italic bold 15px/1 Georgia, serif;
    color: #7a4a1a;
    letter-spacing: 0.03em;
  `;

  const toggleLabel = document.createElement("label");
  toggleLabel.style.cssText = "font-size: 11px; color: #9a7a50; display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none;";
  const toggleCheck = document.createElement("input");
  toggleCheck.type = "checkbox";
  toggleCheck.checked = false;
  toggleCheck.style.cssText = "cursor: pointer; accent-color: #7a4a1a;";
  toggleLabel.append(toggleCheck, document.createTextNode("Show completed"));

  titleRow.append(titleEl, toggleLabel);
  panel.appendChild(titleRow);

  const list = document.createElement("div");
  list.style.cssText = "display: flex; flex-direction: column; gap: 14px;";
  panel.appendChild(list);

  let open = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function reposition() {
    panel.style.top = `${getTopBandHeight() + 6}px`;
  }

  function renderList() {
    list.innerHTML = "";
    const quests = questManager.getAll();
    const manEaterQuests = getManEaterQuests();
    const trophyQuestIds = new Set(getTrophyQuestIds());

    const showCompleted = toggleCheck.checked;
    const visibleQuests = showCompleted ? quests : quests.filter(q => q.status !== "complete");
    const visibleManEater = showCompleted ? manEaterQuests : manEaterQuests.filter(q => !q.completed);

    if (visibleQuests.length === 0 && visibleManEater.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = quests.length === 0 && manEaterQuests.length === 0
        ? "No quests yet."
        : "No active quests.";
      empty.style.cssText = "color: #9a7a50; font-style: italic;";
      list.appendChild(empty);
      return;
    }

    // Ruin / find-and-name quests
    for (const quest of visibleQuests) {
      const item = document.createElement("div");
      item.style.cssText = "display: flex; flex-direction: column; gap: 3px;";

      const header = document.createElement("div");
      header.style.cssText = "display: flex; align-items: baseline; gap: 8px;";

      const statusDot = document.createElement("span");
      statusDot.textContent = quest.status === "complete" ? "✓" : "◎";
      statusDot.style.cssText =
        quest.status === "complete"
          ? "color: #5a7a3a; font-size: 13px; flex-shrink: 0;"
          : "color: #9a6a20; font-size: 13px; flex-shrink: 0;";

      const titleSpan = document.createElement("span");
      titleSpan.textContent = quest.title;
      titleSpan.style.cssText =
        quest.status === "complete"
          ? "color: #9a8060; text-decoration: line-through; font-style: italic;"
          : "color: #3d2614; font-weight: bold;";

      header.append(statusDot, titleSpan);

      const desc = document.createElement("div");
      desc.textContent = quest.description;
      desc.style.cssText =
        "color: #7a5a30; font-size: 12px; font-style: italic; padding-left: 22px;";

      item.append(header, desc);
      list.appendChild(item);
    }

    // Man-eater hunt quests
    for (const q of visibleManEater) {
      const hasTrophy = trophyQuestIds.has(q.id);
      const expireDay = Math.floor(q.acceptedDay!) + MANEATER_QUEST_EXPIRE_DAYS + 1;
      const expired   = q.completed && !hasTrophy;

      const item = document.createElement("div");
      item.style.cssText = "display: flex; flex-direction: column; gap: 3px;";

      const header = document.createElement("div");
      header.style.cssText = "display: flex; align-items: baseline; gap: 8px;";

      const statusDot = document.createElement("span");
      if (q.completed && hasTrophy) {
        statusDot.textContent = "★";
        statusDot.style.cssText = "color: #5a7a3a; font-size: 13px; flex-shrink: 0;";
      } else if (expired) {
        statusDot.textContent = "✗";
        statusDot.style.cssText = "color: #9a5050; font-size: 13px; flex-shrink: 0;";
      } else {
        statusDot.textContent = "◎";
        statusDot.style.cssText = "color: #9a6a20; font-size: 13px; flex-shrink: 0;";
      }

      const titleSpan = document.createElement("span");
      titleSpan.textContent = `Hunt ${q.manEaterName}`;
      titleSpan.style.cssText = expired
        ? "color: #9a8060; text-decoration: line-through; font-style: italic;"
        : "color: #3d2614; font-weight: bold;";

      header.append(statusDot, titleSpan);

      const desc = document.createElement("div");
      if (hasTrophy) {
        desc.textContent = `Trophy in hand — return to ${q.villageName} to claim ${q.reward} pelts.`;
        desc.style.cssText = "color: #5a7a3a; font-size: 12px; font-style: italic; padding-left: 22px;";
      } else if (expired) {
        desc.textContent = `Quest expired (Day ${expireDay}).`;
        desc.style.cssText = "color: #9a5050; font-size: 12px; font-style: italic; padding-left: 22px;";
      } else {
        desc.textContent = `${questDescription(q)} ~${q.spawnMiles} mi ${q.spawnBearing} of ${q.villageName}. Expires Day ${expireDay}.`;
        desc.style.cssText = "color: #7a5a30; font-size: 12px; font-style: italic; padding-left: 22px;";
      }

      item.append(header, desc);
      list.appendChild(item);
    }
  }

  function show() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (!open) {
      renderList();
      open = true;
    }
    reposition();
    panel.style.display = "block";
  }

  function hide() {
    panel.style.display = "none";
    open = false;
    hideTimer = null;
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 180);
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function toggle() {
    open ? hide() : show();
  }

  toggleCheck.addEventListener("change", () => { if (open) renderList(); });

  // Hovering over the panel itself keeps it open.
  panel.addEventListener("mouseenter", cancelHide);
  panel.addEventListener("mouseleave", scheduleHide);

  // Click outside closes it.
  window.addEventListener("mousedown", (e) => {
    if (open && !panel.contains(e.target as Node)) hide();
  });

  window.addEventListener("keydown", (e) => {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  });

  window.addEventListener("resize", () => {
    if (open) reposition();
  });

  return { toggle, show, hide, scheduleHide, cancelHide, isOpen: () => open };
}
