<script lang="ts">
  import { onMount } from "svelte";
  import Header from "./components/Header.svelte";
  import FeedsManager from "./components/FeedsManager.svelte";
  import SettingsManager from "./components/SettingsManager.svelte";
  import ExportPage from "./components/ExportPage.svelte";
  import StatsPage from "./components/StatsPage.svelte";
  import NewsList from "./components/ItemList.svelte";
  import LoginGate from "./components/LoginGate.svelte";
  import { authState, initAuth } from "./lib/auth.svelte";
  import { t } from "./lib/locale.svelte";
  import { route } from "./lib/router";

  onMount(() => {
    void initAuth();
  });

  const locked = $derived(
    authState.required && !authState.authenticated,
  );
</script>

{#if authState.loading}
  <main class="flex min-h-screen items-center justify-center px-5 text-sm text-neutral-400">
    {t("items.loading")}
  </main>
{:else if locked}
  <LoginGate />
{:else}
  <main class="w-full font-sans md:flex">
    <Header />
    {#if $route === "/settings"}
      <SettingsManager />
    {:else}
      <div class="min-w-0 flex-1">
        <div class="mx-auto max-w-page px-5 py-10 md:py-16">
          {#if $route === "/feeds"}
            <FeedsManager />
          {:else if $route === "/stats"}
            <StatsPage />
          {:else if $route === "/export"}
            <ExportPage />
          {:else}
            <NewsList />
          {/if}
        </div>
      </div>
    {/if}
  </main>
{/if}
