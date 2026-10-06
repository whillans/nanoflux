<script lang="ts">
  import { onMount } from "svelte";
  import Segmented from "./settings/Segmented.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import {
    fetchTranslate,
    TRANSLATE_TARGET_LANGS,
    updateTranslate,
    type TranslatePrompts,
    type TranslateTargetLang,
  } from "../lib/api";
  import {
    fieldLabelClass,
    groupHintClass,
    pageHintClass,
    readonlyInputClass,
    saveButtonClass,
    sectionListClass,
  } from "../lib/formStyles";
  import { t } from "../lib/locale.svelte";

  let enabled = $state(false);
  let targetLang = $state<TranslateTargetLang>("zh-Hans");
  let savedEnabled = $state(false);
  let savedTargetLang = $state<TranslateTargetLang>("zh-Hans");
  let prompts = $state<TranslatePrompts>({});
  let formError = $state("");
  let loading = $state(true);
  let saving = $state(false);

  const prompt = $derived(prompts[targetLang] ?? "");

  const isDirty = $derived(
    enabled !== savedEnabled || targetLang !== savedTargetLang,
  );
  const saveDisabled = $derived(saving || loading || !isDirty);

  async function loadTranslate() {
    formError = "";
    loading = true;
    try {
      const config = await fetchTranslate();
      enabled = config.enabled;
      targetLang = config.targetLang;
      savedEnabled = config.enabled;
      savedTargetLang = config.targetLang;
      prompts = config.prompts;
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
      prompts = updated.prompts;
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
  <p class={pageHintClass}>{t("translate.hint")}</p>
  {#if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else}
    <div class={sectionListClass}>
      <SettingRow label={t("translate.enabled")}>
        <Segmented
          label={t("translate.enabled")}
          value={enabled}
          options={[
            { value: true, label: t("translate.on") },
            { value: false, label: t("translate.off") },
          ]}
          disabled={saving}
          onchange={(next) => (enabled = next)}
        />
      </SettingRow>

      <SettingRow label={t("translate.targetLang")}>
        <Segmented
          label={t("translate.targetLang")}
          value={targetLang}
          options={TRANSLATE_TARGET_LANGS.map((lang) => ({
            value: lang,
            label: t(
              lang === "en"
                ? "translate.langEn"
                : lang === "zh-Hans"
                  ? "translate.langZhHans"
                  : "translate.langZhHant",
            ),
          }))}
          disabled={saving}
          onchange={(next) => (targetLang = next)}
        />
      </SettingRow>

      {#if prompt}
        <div class="space-y-5 py-6">
          <p class={groupHintClass}>{t("translate.promptHint")}</p>
          <label class="block space-y-2">
            <span class={fieldLabelClass}>{t("translate.prompt")}</span>
            <textarea
              readonly
              rows="4"
              value={prompt}
              class="field-sizing-content w-full resize-none {readonlyInputClass}"
            ></textarea>
          </label>
        </div>
      {/if}
    </div>

    <button
      type="button"
      disabled={saveDisabled}
      class="mt-2 {saveButtonClass}"
      onclick={() => void handleSave()}
    >
      {saving ? t("translate.saving") : t("translate.save")}
    </button>
  {/if}
  {#if formError}
    <p class="mt-3 text-sm text-red-500">{formError}</p>
  {/if}
</section>
