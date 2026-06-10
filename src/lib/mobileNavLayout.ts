export const MOBILE_NAV_SAFE_BOTTOM = 22;
export const MOBILE_NAV_ITEM_HEIGHT = 60;
export const MOBILE_NAV_TOP_PADDING = 10;
export const MOBILE_NAV_BORDER_HEIGHT = 1;
export const MOBILE_NAV_BASE_HEIGHT =
  MOBILE_NAV_TOP_PADDING + MOBILE_NAV_ITEM_HEIGHT + MOBILE_NAV_SAFE_BOTTOM + MOBILE_NAV_BORDER_HEIGHT;
export const MOBILE_NAV_RESERVE_GAP = 36;
export const MOBILE_NAV_RESERVED_SPACE = MOBILE_NAV_BASE_HEIGHT + MOBILE_NAV_RESERVE_GAP;
export const MOBILE_PAGE_BOTTOM_BUFFER = 18;

export function getMobileNavSafeBottom() {
  return MOBILE_NAV_SAFE_BOTTOM;
}

export function getMobileNavReservedSpace() {
  return MOBILE_NAV_RESERVED_SPACE;
}

export function getMobilePageBottomBuffer() {
  return MOBILE_PAGE_BOTTOM_BUFFER;
}
