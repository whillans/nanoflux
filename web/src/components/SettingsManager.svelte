<script lang="ts">
  import { onMount } from "svelte";
  import PreferencesManager from "./PreferencesManager.svelte";
  import FiltersManager from "./FiltersManager.svelte";
  import DedupManager from "./DedupManager.svelte";
  import TranslateManager from "./TranslateManager.svelte";
  import FeverManager from "./FeverManager.svelte";
  import HermesManager from "./HermesManager.svelte";
  import McpManager from "./McpManager.svelte";
  import {
    type SettingsTab,
    settingsTabFromLocation,
    setSettingsTab,
  } from "../lib/router";
  import { t } from "../lib/locale.svelte";

  let tab = $state<SettingsTab>(settingsTabFromLocation());

  const tabs = [
    { id: "preferences" as const, key: "items.preferences" as const },
    { id: "filter" as const, key: "items.filter" as const },
    { id: "dedup" as const, key: "items.dedup" as const },
    { id: "translate" as const, key: "items.translate" as const },
    { id: "fever" as const, key: "items.fever" as const },
    { id: "hermes" as const, key: "items.hermes" as const },
    { id: "mcp" as const, key: "items.mcp" as const },
  ];

  function tabClass(active: boolean): string {
    return `shrink-0 px-2 py-1.5 text-sm transition-colors md:w-full md:text-left ${
      active
        ? "text-neutral-900 dark:text-neutral-100"
        : "text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100"
    }`;
  }

  function selectTab(next: SettingsTab) {
    if (tab === next) return;
    tab = next;
    setSettingsTab(next);
  }

  onMount(() => {
    tab = settingsTabFromLocation();
    const onHash = () => {
      tab = settingsTabFromLocation();
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  });
</script>

<div class="flex min-w-0 flex-1 flex-col md:flex-row">
  <aside
    class="px-5 py-4 md:sticky md:top-4 md:m-4 md:flex md:h-[calc(100vh-2rem)] md:w-40 md:shrink-0 md:flex-col md:px-5 md:py-8"
  >
    <nav
      class="flex min-w-0 gap-1 overflow-x-auto text-sm md:flex-col md:overflow-visible"
      role="tablist"
      aria-label={t("items.settings")}
    >
      {#each tabs as item (item.id)}
        <button
          type="button"
          role="tab"
          class={tabClass(tab === item.id)}
          aria-selected={tab === item.id}
          onclick={() => selectTab(item.id)}
        >
          {t(item.key)}
        </button>
      {/each}
    </nav>
  </aside>

  <div class="min-w-0 flex-1">
    <div class="mx-auto max-w-page px-5 py-10 md:py-16">
      {#if tab === "preferences"}
        <PreferencesManager />
      {:else if tab === "filter"}
        <FiltersManager />
      {:else if tab === "dedup"}
        <DedupManager />
      {:else if tab === "translate"}
        <TranslateManager />
      {:else if tab === "fever"}
        <FeverManager />
      {:else if tab === "hermes"}
        <HermesManager />
      {:else}
        <McpManager />
      {/if}
    </div>
  </div>
</div>
