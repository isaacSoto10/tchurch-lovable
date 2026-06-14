export const MOBILE_NAV_SAFE_BOTTOM = 22;
export const MOBILE_NAV_ITEM_HEIGHT = 60;
export const MOBILE_NAV_TOP_PADDING = 10;
export const MOBILE_NAV_BORDER_HEIGHT = 1;
export const MOBILE_NAV_CHROME_HEIGHT = MOBILE_NAV_TOP_PADDING + MOBILE_NAV_ITEM_HEIGHT + MOBILE_NAV_BORDER_HEIGHT;
export const MOBILE_NAV_BASE_HEIGHT =
  MOBILE_NAV_CHROME_HEIGHT + MOBILE_NAV_SAFE_BOTTOM;
export const MOBILE_NAV_RESERVE_GAP = 36;
export const MOBILE_NAV_RESERVED_SPACE = MOBILE_NAV_BASE_HEIGHT + MOBILE_NAV_RESERVE_GAP;
export const MOBILE_PAGE_BOTTOM_BUFFER = 18;
export const MOBILE_NAV_HEIGHT_CSS = `calc(3.75rem + 0.625rem + ${MOBILE_NAV_BORDER_HEIGHT}px)`;
export const MOBILE_NAV_CONTENT_CLEARANCE_CSS =
  `calc(var(--tchurch-mobile-nav-height, ${MOBILE_NAV_CHROME_HEIGHT}px) + ` +
  `var(--app-safe-area-bottom, ${MOBILE_NAV_SAFE_BOTTOM}px) + ${MOBILE_NAV_RESERVE_GAP}px)`;

export function getMobileNavSafeBottom() {
  return MOBILE_NAV_SAFE_BOTTOM;
}

export function getMobileNavReservedSpace() {
  return MOBILE_NAV_RESERVED_SPACE;
}

export function getMobilePageBottomBuffer() {
  return MOBILE_PAGE_BOTTOM_BUFFER;
}

export function getMobileNavHeightCss() {
  return MOBILE_NAV_HEIGHT_CSS;
}

export function getMobileNavContentClearanceCss() {
  return MOBILE_NAV_CONTENT_CLEARANCE_CSS;
}
