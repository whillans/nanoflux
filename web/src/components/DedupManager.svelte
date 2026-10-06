<script lang="ts">
  import { onMount } from "svelte";
  import Segmented from "./settings/Segmented.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import {
    fetchDedup,
    updateDedup,
    type DedupConfig,
    type DedupPrompt,
    type DedupState,
  } from "../lib/api";
  import {
    fieldLabelClass,
    groupHintClass,
    inputClass,
    pageHintClass,
    readonlyInputClass,
    saveButtonClass,
    sectionListClass,
  } from "../lib/formStyles";
  import { t } from "../lib/locale.svelte";

  const numberClass = `w-24 shrink-0 self-start sm:self-auto ${inputClass}`;

  let enabled = $state(true);
  let windowDays = $state(3);
  let minSimilarity = $state(0.6);
  let maxCandidates = $state(5);
  let saved = $state<DedupConfig | null>(null);
  let prompt = $state<DedupPrompt | null>(null);
  let formError = $state("");
  let loading = $state(true);
  let saving = $state(false);

  const isValid = $derived(
    Number.isInteger(windowDays) &&
      windowDays >= 1 &&
      windowDays <= 30 &&
      Number.isFinite(minSimilarity) &&
      minSimilarity >= 0 &&
      minSimilarity <= 1 &&
      Number.isInteger(maxCandidates) &&
      maxCandidates >= 1 &&
      maxCandidates <= 20,
  );
  const isDirty = $derived(
    saved !== null &&
      (enabled !== saved.enabled ||
        windowDays !== saved.windowDays ||
        minSimilarity !== saved.minSimilarity ||
        maxCandidates !== saved.maxCandidates),
  );
  const saveDisabled = $derived(saving || loading || !isDirty || !isValid);

  function apply(config: DedupState) {
    enabled = config.enabled;
    windowDays = config.windowDays;
    minSimilarity = config.minSimilarity;
    maxCandidates = config.maxCandidates;
    saved = config;
    prompt = config.prompt ?? null;
  }

  async function loadDedup() {
    formError = "";
    loading = true;
    try {
      apply(await fetchDedup());
    } catch (e) {
      formError = e instanceof Error ? e.message : t("dedup.loadFailed");
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saveDisabled) return;
    formError = "";
    saving = true;
    try {
      apply(await updateDedup({ enabled, windowDays, minSimilarity, maxCandidates }));
    } catch (err) {
      formError = err instanceof Error ? err.message : t("dedup.saveFailed");
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    void loadDedup();
  });
</script>

<section class="mb-10">
  <p class={pageHintClass}>{t("dedup.hint")}</p>
  {#if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else}
    <div class={sectionListClass}>
      <SettingRow label={t("dedup.enabled")}>
        <Segmented
          label={t("dedup.enabled")}
          value={enabled}
          options={[
            { value: true, label: t("dedup.on") },
            { value: false, label: t("dedup.off") },
          ]}
          disabled={saving}
          onchange={(next) => (enabled = next)}
        />
      </SettingRow>

      <SettingRow
        for="dedup-window-days"
        label={t("dedup.windowDays")}
        hint={t("dedup.windowDaysHint")}
      >
        <input
          id="dedup-window-days"
          type="number"
          min="1"
          max="30"
          step="1"
          bind:value={windowDays}
          class={numberClass}
          disabled={saving}
        />
      </SettingRow>

      <SettingRow
        for="dedup-min-similarity"
        label={t("dedup.minSimilarity")}
        hint={t("dedup.minSimilarityHint")}
      >
        <input
          id="dedup-min-similarity"
          type="number"
          min="0"
          max="1"
          step="0.05"
          bind:value={minSimilarity}
          class={numberClass}
          disabled={saving}
        />
      </SettingRow>

      <SettingRow
        for="dedup-max-candidates"
        label={t("dedup.maxCandidates")}
        hint={t("dedup.maxCandidatesHint")}
      >
        <input
          id="dedup-max-candidates"
          type="number"
          min="1"
          max="20"
          step="1"
          bind:value={maxCandidates}
          class={numberClass}
          disabled={saving}
        />
      </SettingRow>

      {#if prompt}
        <div class="space-y-5 py-6">
          <p class={groupHintClass}>{t("dedup.promptHint")}</p>
          {#each [{ label: t("dedup.promptQuestion"), text: prompt.question }, { label: t("dedup.promptDuplicate"), text: prompt.duplicateCriteria }, { label: t("dedup.promptDistinct"), text: prompt.distinctCriteria }] as field (field.label)}
            <label class="block space-y-2">
              <span class={fieldLabelClass}>{field.label}</span>
              <textarea
                readonly
                rows="2"
                value={field.text}
                class="field-sizing-content w-full resize-none {readonlyInputClass}"
              ></textarea>
            </label>
          {/each}
        </div>
      {/if}
    </div>

    {#if !isValid}
      <p class="mt-2 text-sm text-red-500">{t("dedup.invalid")}</p>
    {/if}

    <button
      type="button"
      disabled={saveDisabled}
      class="mt-2 {saveButtonClass}"
      onclick={() => void handleSave()}
    >
      {saving ? t("dedup.saving") : t("dedup.save")}
    </button>
  {/if}
  {#if formError}
    <p class="mt-3 text-sm text-red-500">{formError}</p>
  {/if}
</section>
