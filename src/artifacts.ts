// Registry of ruin artifacts. Each ruins-chain quest completion awards one
// random artifact the player doesn't already own (see awardRandomArtifact in
// main.ts); if every artifact is already owned, that ruin awards nothing.
// flavor and instructions are shown on the artifact-reveal page of the
// quest-complete dialog (see showQuestComplete in main.ts).
export interface ArtifactDef {
  id: string;
  name: string;
  emoji: string;
  flavor: string; // evocative, in-world description
  instructions: string; // plain mechanical explanation of how it works
}

export const ARTIFACTS: ArtifactDef[] = [
  {
    id: "robot_companion",
    name: "Robot Companion",
    emoji: "🤖",
    flavor:
      "A small metallic creature, hardy and eager to work. Its carapace, harder than steel, is etched with what may well be a serial number in that same strange, unreadable script from the ruins. You quickly earn its undying loyalty.",
    instructions:
      "While you rest, it stays put and quietly forages nearby once every in-game hour, gathering food and water up to half of your own carrying capacity. Click it to collect what it has found. It vanishes into the canoe with you on water and reappears nearby once you reach land.",
  },
  {
    id: "shrieking_coil",
    name: "Shrieking Coil",
    emoji: "🌀",
    flavor:
      "A tight coil of small, densely interlocked rings made of some biologicla substance. Is it alive? At night, you bury it deeply at the bottom of your pack so that you can't hear its constant humming.",
    instructions:
      "Click it in your inventory to activate. Every aggressive creature within 10 tiles instantly flees out to a distance of 15 tiles, man-eaters included.",
  },
  {
    id: "night_boots",
    name: "Night Boots",
    emoji: "👢",
    flavor:
      "In daylight these black leather boots seem unremarkable. Once starlight strikes them, they stride, sure-footed, over ground you can barely see.",
    instructions:
      "Equipped automatically once found. +50% travel speed at night while on foot (no effect while paddling a canoe).",
  },
  {
    id: "worklight_lantern",
    name: "Worklight Lantern",
    emoji: "🏮",
    flavor:
      "A dense lattice of dark red glass, warm to the touch even in the coldest wind. There is no wick, no oil, no visible source for the light inside it — only a faint, steady thrum, like something breathing just beneath the surface.",
    instructions:
      "Click it in your inventory to toggle. While lit, a reddish glow floods the ground around you, letting you build, harvest timber, survey, and track by night as though it were day. But the glow carries: every predator within 15 tiles is drawn straight toward you for as long as it burns. Switch it off and the light — and the danger — vanish immediately.",
  },
];
