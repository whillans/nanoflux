<script lang="ts">
  import { onMount } from "svelte";
  import Segmented from "./settings/Segmented.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import { fetchFilter, updateFilter } from "../lib/api";
  import {
    fieldLabelClass,
    groupHintClass,
    inputClass,
    pageHintClass,
    saveButtonClass,
    sectionListClass,
  } from "../lib/formStyles";
  import { t } from "../lib/locale.svelte";

  let question = $state("");
  let keepCriteria = $state("");
  let rejectCriteria = $state("");
  let enabled = $state(false);
  let allowKeywords = $state("");
  let blockKeywords = $state("");
  let sources = $state<string[]>([]);
  let sourceInput = $state("");
  let savedQuestion = $state("");
  let savedKeepCriteria = $state("");
  let savedRejectCriteria = $state("");
  let savedEnabled = $state(false);
  let savedAllowKeywords = $state("");
  let savedBlockKeywords = $state("");
  let savedSources = $state<string[]>([]);
  let formError = $state("");
  let loading = $state(true);
  let saving = $state(false);

  const isDirty = $derived(
    question.trim() !== savedQuestion ||
      keepCriteria.trim() !== savedKeepCriteria ||
      rejectCriteria.trim() !== savedRejectCriteria ||
      enabled !== savedEnabled ||
      allowKeywords.trim() !== savedAllowKeywords ||
      blockKeywords.trim() !== savedBlockKeywords ||
      sources.join("\u0000") !== savedSources.join("\u0000"),
  );
  const saveDisabled = $derived(saving || loading || !isDirty);

  async function loadFilter() {
    formError = "";
    loading = true;
    try {
      const filter = await fetchFilter();
      question = filter.question;
      keepCriteria = filter.keepCriteria;
      rejectCriteria = filter.rejectCriteria;
      enabled = filter.enabled;
      allowKeywords = filter.allowKeywords;
      blockKeywords = filter.blockKeywords;
      sources = filter.sources;
      savedQuestion = filter.question;
      savedKeepCriteria = filter.keepCriteria;
      savedRejectCriteria = filter.rejectCriteria;
      savedEnabled = filter.enabled;
      savedAllowKeywords = filter.allowKeywords;
      savedBlockKeywords = filter.blockKeywords;
      savedSources = filter.sources;
    } catch (e) {
      formError = e instanceof Error ? e.message : t("filters.loadFailed");
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saveDisabled) return;
    formError = "";
    saving = true;

    try {
      const updated = await updateFilter({
        question: question.trim(),
        keepCriteria: keepCriteria.trim(),
        rejectCriteria: rejectCriteria.trim(),
        enabled,
        allowKeywords: allowKeywords.trim(),
        blockKeywords: blockKeywords.trim(),
        sources,
      });
      question = updated.question;
      keepCriteria = updated.keepCriteria;
      rejectCriteria = updated.rejectCriteria;
      enabled = updated.enabled;
      savedQuestion = updated.question;
      savedKeepCriteria = updated.keepCriteria;
      savedRejectCriteria = updated.rejectCriteria;
      savedEnabled = updated.enabled;
      allowKeywords = updated.allowKeywords;
      savedAllowKeywords = updated.allowKeywords;
      blockKeywords = updated.blockKeywords;
      savedBlockKeywords = updated.blockKeywords;
      sources = updated.sources;
      savedSources = updated.sources;
    } catch (err) {
      formError = err instanceof Error ? err.message : t("filters.saveFailed");
    } finally {
      saving = false;
    }
  }

  function addSource(): void {
    const candidates = sourceInput
      .split(/[,，\s]+/)
      .map((source) => source.trim().toLocaleLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "")
      .filter(Boolean);
    if (candidates.length) {
      sources = [...new Set([...sources, ...candidates])];
    }
    sourceInput = "";
  }

  function removeSource(source: string): void {
    sources = sources.filter((item) => item !== source);
  }

  function handleSourceKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addSource();
    }
    if (event.key === "Backspace" && !sourceInput && sources.length) {
      sources = sources.slice(0, -1);
    }
  }

  onMount(() => {
    void loadFilter();
  });
</script>

<section class="mb-10">
  <p class={pageHintClass}>{t("filters.hint")}</p>
  {#if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else}
    <div class={sectionListClass}>
      <SettingRow label={t("filters.enabled")}>
        <Segmented
          label={t("filters.enabled")}
          value={enabled}
          options={[
            { value: true, label: t("filters.on") },
            { value: false, label: t("filters.off") },
          ]}
          disabled={saving}
          onchange={(next) => (enabled = next)}
        />
      </SettingRow>

      <div class="space-y-2 py-6">
        <label for="filter-sources" class={fieldLabelClass}>{t("filters.sources")}</label>
        <div
          class="flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-neutral-200 px-2 py-1.5 transition-colors focus-within:border-neutral-900 dark:border-neutral-700 dark:focus-within:border-neutral-100"
        >
          {#each sources as source}
            <span class="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
              {source}
              <button
                type="button"
                class="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                aria-label={`${t("filters.removeSource")} ${source}`}
                disabled={saving}
                onclick={() => removeSource(source)}
              >×</button>
            </span>
          {/each}
          <input
            id="filter-sources"
            bind:value={sourceInput}
            class="min-w-40 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
            disabled={saving}
            placeholder={t("filters.sourcesPlaceholder")}
            onkeydown={handleSourceKeydown}
            onblur={addSource}
          />
        </div>
      </div>

      <div class="space-y-5 py-6">
        <p class={groupHintClass}>{t("filters.keywordsHint")}</p>
        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("filters.allowKeywords")}</span>
          <textarea
            bind:value={allowKeywords}
            class="min-h-20 w-full resize-y {inputClass}"
            disabled={saving}
            placeholder={t("filters.allowKeywordsPlaceholder")}
          ></textarea>
        </label>
        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("filters.blockKeywords")}</span>
          <textarea
            bind:value={blockKeywords}
            class="min-h-20 w-full resize-y {inputClass}"
            disabled={saving}
            placeholder={t("filters.blockKeywordsPlaceholder")}
          ></textarea>
        </label>
      </div>

      <div class="space-y-5 py-6">
        <p class={groupHintClass}>{t("filters.aiHint")}</p>
        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("filters.question")}</span>
          <input
            bind:value={question}
            class="w-full {inputClass}"
            disabled={saving}
            placeholder={t("filters.questionPlaceholder")}
          />
        </label>
        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("filters.keepCriteria")}</span>
          <textarea
            bind:value={keepCriteria}
            class="min-h-24 w-full resize-y {inputClass}"
            disabled={saving}
            placeholder={t("filters.keepCriteriaPlaceholder")}
          ></textarea>
        </label>
        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("filters.rejectCriteria")}</span>
          <textarea
            bind:value={rejectCriteria}
            class="min-h-24 w-full resize-y {inputClass}"
            disabled={saving}
            placeholder={t("filters.rejectCriteriaPlaceholder")}
          ></textarea>
        </label>
      </div>
    </div>

    <button
      type="button"
      disabled={saveDisabled}
      class="mt-2 {saveButtonClass}"
      onclick={() => void handleSave()}
    >
      {saving ? t("filters.saving") : t("filters.save")}
    </button>
  {/if}
  {#if formError}
    <p class="mt-3 text-sm text-red-500">{formError}</p>
  {/if}
</section>
