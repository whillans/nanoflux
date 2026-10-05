<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchTranslate,
    TRANSLATE_TARGET_LANGS,
    updateTranslate,
    type TranslateTargetLang,
  } from "../lib/api";
  import { t } from "../lib/locale.svelte";

  let enabled = $state(false);
  let targetLang = $state<TranslateTargetLang>("zh-Hans");
  let savedEnabled = $state(false);
  let savedTargetLang = $state<TranslateTargetLang>("zh-Hans");
  let formError = $state("");
  let loading = $state(true);
  let saving = $state(false);

  const isDirty = $derived(
    enabled !== savedEnabled || targetLang !== savedTargetLang,
  );
  const saveDisabled = $derived(saving || loading || !isDirty);

  function toggleClass(active: boolean): string {
    return active
      ? "text-neutral-900 underline underline-offset-4 decoration-neutral-900 dark:text-neutral-100 dark:decoration-neutral-100"
      : "text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300";
  }

  async function loadTranslate() {
    formError = "";
    loading = true;
    try {
      const config = await fetchTranslate();
      enabled = config.enabled;
      targetLang = config.targetLang;
      savedEnabled = config.enabled;
      savedTargetLang = config.targetLang;
    } catch (e) {
      formError = e instanceof Error ? e.message : t("translate.loadFailed");
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saveDisabled) return;
    formError = "";
    saving = true;

    try {
      const updated = await updateTranslate({ enabled, targetLang });
      enabled = updated.enabled;
      targetLang = updated.targetLang;
      savedEnabled = updated.enabled;
      savedTargetLang = updated.targetLang;
    } catch (err) {
      formError = err instanceof Error ? err.message : t("translate.saveFailed");
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    void loadTranslate();
  });
</script>

<section class="mb-10">
  <p class="mb-6 text-sm text-neutral-400 dark:text-neutral-500">
    {t("translate.hint")}
  </p>
  {#if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else}
    <div class="space-y-8">
      <div class="space-y-3">
        <span class="block text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
          {t("translate.enabled")}
        </span>
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
          role="group"
          aria-label={t("translate.enabled")}
        >
          <button
            type="button"
            class="transition-colors {toggleClass(enabled)}"
            aria-pressed={enabled}
            disabled={saving}
            onclick={() => (enabled = true)}
          >
            {t("translate.on")}
          </button>
          <button
            type="button"
            class="transition-colors {toggleClass(!enabled)}"
            aria-pressed={!enabled}
            disabled={saving}
            onclick={() => (enabled = false)}
          >
            {t("translate.off")}
          </button>
        </div>
      </div>

      <div class="space-y-3">
        <span class="block text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
          {t("translate.targetLang")}
        </span>
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
          role="group"
          aria-label={t("translate.targetLang")}
        >
          {#each TRANSLATE_TARGET_LANGS as lang (lang)}
            <button
              type="button"
              class="transition-colors {toggleClass(targetLang === lang)}"
              aria-pressed={targetLang === lang}
              disabled={saving}
              onclick={() => (targetLang = lang)}
            >
              {t(
                lang === "en"
                  ? "translate.langEn"
                  : lang === "zh-Hans"
                    ? "translate.langZhHans"
                    : "translate.langZhHant",
              )}
            </button>
          {/each}
        </div>
      </div>

      <button
        type="button"
        disabled={saveDisabled}
        class="text-sm text-neutral-900 underline-offset-4 hover:underline disabled:opacity-50 dark:text-neutral-100"
        onclick={() => void handleSave()}
      >
        {saving ? t("translate.saving") : t("translate.save")}
      </button>
    </div>
  {/if}
  {#if formError}
    <p class="mt-3 text-sm text-red-500">{formError}</p>
  {/if}
</section>
