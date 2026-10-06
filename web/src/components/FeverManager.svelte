<script lang="ts">
  import { onMount } from "svelte";
  import { Check, Copy } from "@lucide/svelte";
  import Segmented from "./settings/Segmented.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import { fetchFever, updateFever } from "../lib/api";
  import {
    codeBoxClass,
    codeTextClass,
    copyButtonClass,
    fieldHintClass,
    fieldLabelClass,
    inputClass,
    pageHintClass,
    saveButtonClass,
    sectionListClass,
  } from "../lib/formStyles";
  import { t } from "../lib/locale.svelte";
  import { isStrongPassword } from "../../../shared/password-strength";

  let enabled = $state(false);
  let user = $state("");
  let password = $state("");
  let hasPassword = $state(false);
  let savedEnabled = $state(false);
  let savedUser = $state("");
  let formError = $state("");
  let loading = $state(true);
  let saving = $state(false);
  let endpointCopied = $state(false);

  const endpointUrl = $derived(
    typeof window === "undefined" ? "/fever/" : `${window.location.origin}/fever/`,
  );

  const isDirty = $derived(
    enabled !== savedEnabled || user.trim() !== savedUser || password.length > 0,
  );
  const saveDisabled = $derived(saving || loading || !isDirty);

  async function loadFever() {
    formError = "";
    loading = true;
    try {
      const config = await fetchFever();
      enabled = config.enabled;
      user = config.user;
      hasPassword = config.hasPassword;
      password = "";
      savedEnabled = config.enabled;
      savedUser = config.user;
    } catch (e) {
      formError = e instanceof Error ? e.message : t("fever.loadFailed");
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saveDisabled) return;
    formError = "";

    if (enabled && !user.trim()) {
      formError = t("fever.userRequired");
      return;
    }
    if (enabled && !hasPassword && !password) {
      formError = t("fever.passwordRequired");
      return;
    }
    if (password.length > 0 && !isStrongPassword(password)) {
      formError = t("fever.passwordWeak");
      return;
    }

    saving = true;
    try {
      const payload: { enabled: boolean; user: string; password?: string } = {
        enabled,
        user: user.trim(),
      };
      if (password.length > 0) {
        payload.password = password;
      }
      const updated = await updateFever(payload);
      enabled = updated.enabled;
      user = updated.user;
      hasPassword = updated.hasPassword;
      password = "";
      savedEnabled = updated.enabled;
      savedUser = updated.user;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      formError = message.includes("at least 8 characters")
        ? t("fever.passwordWeak")
        : message || t("fever.saveFailed");
    } finally {
      saving = false;
    }
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpointUrl);
    endpointCopied = true;
    window.setTimeout(() => (endpointCopied = false), 1500);
  }

  onMount(() => {
    void loadFever();
  });
</script>

<section class="mb-10">
  <p class={pageHintClass}>{t("fever.hint")}</p>
  {#if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else}
    <div class={sectionListClass}>
      <SettingRow label={t("fever.enabled")}>
        <Segmented
          label={t("fever.enabled")}
          value={enabled}
          options={[
            { value: true, label: t("fever.on") },
            { value: false, label: t("fever.off") },
          ]}
          disabled={saving}
          onchange={(next) => (enabled = next)}
        />
      </SettingRow>

      <div class="grid gap-5 py-6 sm:grid-cols-2">
        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("fever.user")}</span>
          <input
            type="text"
            bind:value={user}
            class="w-full {inputClass}"
            autocomplete="username"
            disabled={saving}
          />
        </label>

        <label class="block space-y-2">
          <span class={fieldLabelClass}>{t("fever.password")}</span>
          <input
            type="password"
            bind:value={password}
            class="w-full {inputClass}"
            autocomplete="new-password"
            placeholder={hasPassword ? t("fever.passwordKeep") : ""}
            disabled={saving}
          />
        </label>
      </div>

      <div class="space-y-2 py-6">
        <span class={fieldLabelClass}>{t("fever.endpoint")}</span>
        <div class="items-center {codeBoxClass}">
          <code class="break-all {codeTextClass}">{endpointUrl}</code>
          <button type="button" class={copyButtonClass} aria-label={t("fever.copyEndpoint")} title={t("fever.copyEndpoint")} onclick={() => void copyEndpoint()}>
            {#if endpointCopied}
              <Check size={17} />
            {:else}
              <Copy size={17} />
            {/if}
          </button>
        </div>
        {#if endpointCopied}<span class="block {fieldHintClass}">{t("fever.copied")}</span>{/if}
      </div>
    </div>

    <button
      type="button"
      disabled={saveDisabled}
      class="mt-2 {saveButtonClass}"
      onclick={() => void handleSave()}
    >
      {saving ? t("fever.saving") : t("fever.save")}
    </button>
  {/if}
  {#if formError}
    <p class="mt-3 text-sm text-red-500">{formError}</p>
  {/if}
</section>
