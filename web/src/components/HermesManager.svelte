<script lang="ts">
  import { onMount } from "svelte";
  import Segmented from "./settings/Segmented.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import { fetchHermes, testHermes, updateHermes } from "../lib/api";
  import {
    fieldHintClass,
    fieldLabelClass,
    inputClass,
    pageHintClass,
    saveButtonClass,
    sectionListClass,
  } from "../lib/formStyles";
  import { t } from "../lib/locale.svelte";
  import { isHttpUrl } from "../../../shared/url";

  let enabled = $state(false);
  let url = $state("");
  let secret = $state("");
  let hasSecret = $state(false);
  let savedEnabled = $state(false);
  let savedUrl = $state("");
  let formError = $state("");
  let testMessage = $state("");
  let loading = $state(true);
  let saving = $state(false);
  let testing = $state(false);

  const isDirty = $derived(
    enabled !== savedEnabled || url.trim() !== savedUrl || secret.length > 0,
  );
  const saveDisabled = $derived(saving || testing || loading || !isDirty);
  const testDisabled = $derived(
    saving || testing || loading || !savedUrl || !hasSecret,
  );

  function applyConfig(config: { enabled: boolean; url: string; hasSecret: boolean }) {
    enabled = config.enabled;
    url = config.url;
    hasSecret = config.hasSecret;
    secret = "";
    savedEnabled = config.enabled;
    savedUrl = config.url;
  }

  async function loadHermes() {
    formError = "";
    loading = true;
    try {
      applyConfig(await fetchHermes());
    } catch (e) {
      formError = e instanceof Error ? e.message : t("hermes.loadFailed");
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saveDisabled) return;
    formError = "";
    testMessage = "";

    const nextUrl = url.trim();
    if (enabled && !nextUrl) {
      formError = t("hermes.urlRequired");
      return;
    }
    if (nextUrl && !isHttpUrl(nextUrl)) {
      formError = t("hermes.urlInvalid");
      return;
    }
    if (enabled && !hasSecret && !secret) {
      formError = t("hermes.secretRequired");
      return;
    }

    saving = true;
    try {
      const payload: { enabled: boolean; url: string; secret?: string } = {
        enabled,
        url: nextUrl,
      };
      if (secret.length > 0) {
        payload.secret = secret;
      }
      applyConfig(await updateHermes(payload));
    } catch (err) {
      formError = err instanceof Error && err.message ? err.message : t("hermes.saveFailed");
    } finally {
      saving = false;
    }
  }

  async function handleTest() {
    if (testDisabled) return;
    formError = "";
    testMessage = "";
    if (isDirty) {
      formError = t("hermes.testSaveFirst");
      return;
    }
    testing = true;
    try {
      await testHermes();
      testMessage = t("hermes.testOk");
    } catch (err) {
      formError = err instanceof Error && err.message ? err.message : t("hermes.testFailed");
    } finally {
      testing = false;
    }
  }

  onMount(() => {
    void loadHermes();
  });
</script>

<section class="mb-10">
  <p class={pageHintClass}>{t("hermes.hint")}</p>
  {#if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else}
    <div class={sectionListClass}>
      <SettingRow label={t("hermes.enabled")}>
        <Segmented
          label={t("hermes.enabled")}
          value={enabled}
          options={[
            { value: true, label: t("hermes.on") },
            { value: false, label: t("hermes.off") },
          ]}
          disabled={saving}
          onchange={(next) => (enabled = next)}
        />
      </SettingRow>

      <div class="grid gap-5 py-6">
        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("hermes.url")}</span>
          <input
            type="url"
            bind:value={url}
            class="w-full {inputClass}"
            placeholder="http://127.0.0.1:8644/webhooks/nanoflux"
            autocomplete="off"
            spellcheck="false"
            disabled={saving}
          />
          <span class="block {fieldHintClass}">{t("hermes.urlHint")}</span>
        </label>

        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("hermes.secret")}</span>
          <input
            type="password"
            bind:value={secret}
            class="w-full {inputClass}"
            autocomplete="new-password"
            placeholder={hasSecret ? t("hermes.secretKeep") : ""}
            disabled={saving}
          />
        </label>
      </div>
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={saveDisabled}
        class={saveButtonClass}
        onclick={() => void handleSave()}
      >
        {saving ? t("hermes.saving") : t("hermes.save")}
      </button>
      <button
        type="button"
        disabled={testDisabled}
        class="inline-flex h-9 items-center rounded-lg border border-neutral-200 px-4 text-[14px] leading-none transition-colors enabled:hover:border-neutral-900 disabled:opacity-30 dark:border-neutral-700 dark:enabled:hover:border-neutral-100"
        onclick={() => void handleTest()}
      >
        {testing ? t("hermes.testing") : t("hermes.test")}
      </button>
    </div>
  {/if}
  {#if formError}
    <p class="mt-3 text-sm text-red-500">{formError}</p>
  {:else if testMessage}
    <p class="mt-3 text-sm text-neutral-500 dark:text-neutral-400">{testMessage}</p>
  {/if}
</section>
