import * as React from "react";
import { Capacitor } from "@capacitor/core";

const MOBILE_BREAKPOINT = 768;
const COMPACT_TABLET_WINDOW_BREAKPOINT = 900;
const PHONE_LANDSCAPE_MAX_WIDTH = 950;
const PHONE_LANDSCAPE_MAX_HEIGHT = 500;

function isCompactPhoneViewport(width: number, height: number) {
  return width < MOBILE_BREAKPOINT || (height < PHONE_LANDSCAPE_MAX_HEIGHT && width < PHONE_LANDSCAPE_MAX_WIDTH);
}

function isCompactTabletWindow(width: number, height: number) {
  return width >= MOBILE_BREAKPOINT && width < COMPACT_TABLET_WINDOW_BREAKPOINT && height > width;
}

function isCompactNavigationViewport(width: number, height: number) {
  return isCompactPhoneViewport(width, height) || isCompactTabletWindow(width, height);
}

function isNativeTabletViewport(width: number, height: number) {
  if (!Capacitor.isNativePlatform()) return false;

  const shortestSide = Math.min(width || 0, height || 0);
  return shortestSide >= MOBILE_BREAKPOINT && !isCompactPhoneViewport(width, height);
}

function shouldUseMobileShell(width: number, height: number) {
  return isCompactNavigationViewport(width, height) || isNativeTabletViewport(width, height);
}

export function useWindowDimensions() {
  const [dimensions, setDimensions] = React.useState(() => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }));

  React.useEffect(() => {
    const onResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return dimensions;
}

export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const shortestSide = Math.min(width || 0, height || 0);
  const isPhone = isCompactPhoneViewport(width, height);
  const isNativeTablet = isNativeTabletViewport(width, height);

  return {
    width,
    height,
    shortestSide,
    isPhone,
    isCompactNavigation: isCompactNavigationViewport(width, height),
    isCompactTabletWindow: isCompactTabletWindow(width, height),
    isNativeTablet,
    isTablet: !isPhone && width < 1180,
    isTabletPortrait: width >= MOBILE_BREAKPOINT && width < 1024 && height > width,
    isWide: width >= 1180,
  };
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window === "undefined" ? false : shouldUseMobileShell(window.innerWidth, window.innerHeight),
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(shouldUseMobileShell(window.innerWidth, window.innerHeight));
    };
    mql.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    setIsMobile(shouldUseMobileShell(window.innerWidth, window.innerHeight));
    return () => {
      mql.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  return !!isMobile;
}
