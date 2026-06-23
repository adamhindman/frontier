// Inventory panel removed. Timber is now a world object (TimberPileManager).
// Canoe count is shown in the HUD bottom bar.
export function createInventory() {
  return { toggle: () => {}, update: () => {}, isOpen: () => false };
}
