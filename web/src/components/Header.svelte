<script lang="ts">
  import ChartColumn from "@lucide/svelte/icons/chart-column";
  import Download from "@lucide/svelte/icons/download";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Newspaper from "@lucide/svelte/icons/newspaper";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import Rss from "@lucide/svelte/icons/rss";
  import {
    exportHref,
    feedsHref,
    homeHref,
    navClick,
    route,
    statsHref,
  } from "../lib/router";
  import SettingsButton from "./buttons/SettingsButton.svelte";
  import { authState, submitLogout } from "../lib/auth.svelte";
  import { t } from "../lib/locale.svelte";
  import { sidebarState, toggleSidebar } from "../lib/sidebar.svelte";

  const iconProps = { size: 16, strokeWidth: 1.5, "aria-hidden": true as const };
  const toggleIconProps = { size: 16, strokeWidth: 1.5, "aria-hidden": true as const };

  const collapsed = $derived(sidebarState.collapsed);
  const showLogout = $derived(authState.required && authState.authenticated);

  async function handleLogout() {
    try {
      await submitLogout();
    } catch {
      /* session is cleared server-side even if this fails */
    }
  }

  const navClass = (active: boolean) =>
    `flex items-center rounded-md transition-colors ${
      collapsed ? "justify-center p-2 md:justify-center" : "gap-2 px-2 py-1.5"
    } ${
      active
        ? "text-neutral-900 dark:text-neutral-100"
        : "text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100"
    }`;
</script>

<aside
  class="border-b border-neutral-100 px-5 py-5 transition-[width,padding] duration-200 dark:border-neutral-800 md:sticky md:top-4 md:m-4 md:flex md:h-[calc(100vh-2rem)] md:shrink-0 md:flex-col md:rounded-xl md:border md:bg-white md:py-8 md:shadow-sm md:dark:bg-neutral-950 {collapsed
    ? 'md:w-14 md:px-2'
    : 'md:w-48 md:px-5'}"
>
  <div
    class="flex items-center {collapsed
      ? 'md:flex-col md:gap-2'
      : 'justify-between gap-2'}"
  >
    <a
      href={homeHref()}
      onclick={navClick("/")}
      class="truncate text-lg font-medium tracking-tight hover:opacity-70 {collapsed
        ? 'md:hidden'
        : ''}"
    >
      NanoFlux
    </a>

    <button
      type="button"
      onclick={toggleSidebar}
      class="hidden shrink-0 cursor-pointer rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 md:inline-flex dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
      title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
    >
      {#if collapsed}
        <PanelLeftOpen {...toggleIconProps} />
      {:else}
        <PanelLeftClose {...toggleIconProps} />
      {/if}
    </button>
  </div>

  <nav
    class="mt-4 flex min-w-0 gap-1 overflow-x-auto text-sm md:mt-8 md:flex-col md:overflow-visible"
    aria-label={t("items.latest")}
  >
    <a
      href={homeHref()}
      onclick={navClick("/")}
      class={navClass($route === "/")}
      aria-current={$route === "/" ? "page" : undefined}
      title={collapsed ? t("items.latest") : undefined}
    >
      <Newspaper {...iconProps} />
      <span class={collapsed ? "md:sr-only" : ""}>{t("items.latest")}</span>
    </a>
    <a
      href={feedsHref()}
      onclick={navClick("/feeds")}
      class={navClass($route === "/feeds")}
      aria-current={$route === "/feeds" ? "page" : undefined}
      title={collapsed ? t("items.feeds") : undefined}
    >
      <Rss {...iconProps} />
      <span class={collapsed ? "md:sr-only" : ""}>{t("items.feeds")}</span>
    </a>
    <a
      href={statsHref()}
      onclick={navClick("/stats")}
      class={navClass($route === "/stats")}
      aria-current={$route === "/stats" ? "page" : undefined}
      title={collapsed ? t("items.stats") : undefined}
    >
      <ChartColumn {...iconProps} />
      <span class={collapsed ? "md:sr-only" : ""}>{t("items.stats")}</span>
    </a>
  </nav>

  <div class="mt-4 shrink-0 text-sm md:mt-auto">
    <a
      href={exportHref()}
      onclick={navClick("/export")}
      class="mb-1 {navClass($route === '/export')}"
      aria-current={$route === "/export" ? "page" : undefined}
      title={collapsed ? t("items.export") : undefined}
    >
      <Download {...iconProps} />
      <span class={collapsed ? "md:sr-only" : ""}>{t("items.export")}</span>
    </a>
    <SettingsButton {collapsed} />
    {#if showLogout}
      <button
        type="button"
        onclick={handleLogout}
        class="mt-1 flex w-full cursor-pointer items-center rounded-md text-sm text-neutral-400 transition-colors hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100 {collapsed
          ? 'justify-center p-2 md:justify-center'
          : 'gap-2 px-2 py-1.5'}"
        title={collapsed ? t("auth.logout") : undefined}
      >
        <LogOut {...iconProps} />
        <span class={collapsed ? "md:sr-only" : ""}>{t("auth.logout")}</span>
      </button>
    {/if}
  </div>
</aside>
