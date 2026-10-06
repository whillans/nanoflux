import { get, writable } from "svelte/store";

/** Logical routes (not URL pathnames). */
export type AppRoute = "/" | "/feeds" | "/stats" | "/settings" | "/export";

export type SettingsTab = "preferences" | "filter" | "dedup" | "translate" | "fever" | "mcp";

const scrollByRoute = new Map<string, number>();

export const route = writable<AppRoute>("/");

const SUBPAGE_PATH_SUFFIXES = [
  "/feeds/",
  "/stats/",
  "/settings/",
  "/filter/",
  "/filters/",
  "/translate/",
  "/dedup/",
  "/export/",
  "/fever/",
  "/mcp-settings/",
];

function isSubPagePath(path: string): boolean {
  return SUBPAGE_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function pathnameToRoute(pathname: string): AppRoute {
  if (pathname.endsWith("/feeds")) return "/feeds";
  if (pathname.endsWith("/stats")) return "/stats";
  if (pathname.endsWith("/export")) return "/export";
  if (
    pathname.endsWith("/settings") ||
    pathname.endsWith("/filter") ||
    pathname.endsWith("/filters") ||
    pathname.endsWith("/translate") ||
    pathname.endsWith("/dedup") ||
    pathname.endsWith("/fever") ||
    pathname.endsWith("/mcp-settings")
  ) {
    return "/settings";
  }
  return "/";
}

function routeToRelativeHref(next: AppRoute): string {
  if (next === "/feeds") return "feeds";
  if (next === "/stats") return "stats";
  if (next === "/settings") return "settings";
  if (next === "/export") return "export";
  if (isSubPagePath(window.location.pathname)) {
    return "..";
  }
  return "./";
}

/** Relative link to the app home (sibling of the feeds segment). */
export function homeHref(): string {
  if (isSubPagePath(window.location.pathname)) {
    return "..";
  }
  return "./";
}

/** Relative link to the feeds page. */
export function feedsHref(): string {
  return "feeds";
}

/** Relative link to the stats page. */
export function statsHref(): string {
  return "stats";
}

/** Relative link to the export page. */
export function exportHref(): string {
  return "export";
}

/** Relative link to the settings page. */
export function settingsHref(): string {
  return "settings";
}

export function settingsTabFromLocation(): SettingsTab {
  const path = window.location.pathname;
  if (path.endsWith("/translate")) return "translate";
  if (path.endsWith("/dedup")) return "dedup";
  if (path.endsWith("/fever")) return "fever";
  if (path.endsWith("/mcp-settings")) return "mcp";
  const hash = window.location.hash.replace(/^#/, "");
  if (
    hash === "preferences" ||
    hash === "translate" ||
    hash === "dedup" ||
    hash === "fever" ||
    hash === "mcp" ||
    hash === "filter"
  ) {
    return hash;
  }
  return "preferences";
}

export function setSettingsTab(tab: SettingsTab) {
  const url = new URL(window.location.href);
  url.hash = tab;
  if (
    url.pathname.endsWith("/filter") ||
    url.pathname.endsWith("/filters") ||
    url.pathname.endsWith("/translate") ||
    url.pathname.endsWith("/dedup") ||
    url.pathname.endsWith("/fever") ||
    url.pathname.endsWith("/mcp-settings")
  ) {
    const settings = new URL(settingsHref(), window.location.href);
    url.pathname = settings.pathname;
  }
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function saveScroll(current: AppRoute) {
  scrollByRoute.set(current, window.scrollY);
}

function restoreScroll(next: AppRoute) {
  requestAnimationFrame(() => {
    window.scrollTo(0, scrollByRoute.get(next) ?? 0);
  });
}

export function syncRouteFromLocation() {
  route.set(pathnameToRoute(window.location.pathname));
}

export function navigate(next: AppRoute) {
  const current = get(route);
  if (current === next) return;

  const href = routeToRelativeHref(next);
  const target = new URL(href, window.location.href);
  if (window.location.pathname === target.pathname) return;

  saveScroll(current);
  history.pushState(null, "", href + window.location.search);
  route.set(next);
  restoreScroll(next);
}

export function initRouter(): void {
  syncRouteFromLocation();

  window.addEventListener("popstate", () => {
    syncRouteFromLocation();
    restoreScroll(get(route));
  });
}

export function shouldHandleNavClick(event: MouseEvent): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }
  return true;
}

export function navClick(next: AppRoute) {
  return (event: MouseEvent) => {
    if (!shouldHandleNavClick(event)) return;
    event.preventDefault();
    navigate(next);
  };
}
