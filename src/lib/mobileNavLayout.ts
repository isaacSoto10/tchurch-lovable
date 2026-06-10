export const MOBILE_NAV_BASE_HEIGHT = 62;
export const MOBILE_NAV_RESERVE_GAP = 10;
export const MAX_MOBILE_SAFE_BOTTOM = 14;

export function clampMobileSafeAreaBottom(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), MAX_MOBILE_SAFE_BOTTOM) : 0;
}

export function getMobileNavReservedSpace(safeBottom: number) {
  return MOBILE_NAV_BASE_HEIGHT + clampMobileSafeAreaBottom(safeBottom) + MOBILE_NAV_RESERVE_GAP;
}
