<script lang="ts">
  import { onMount } from "svelte";
  import { Check, Copy } from "@lucide/svelte";
  import Segmented from "./settings/Segmented.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import {
    fetchMcp,
    fetchMcpEndpoint,
    generateMcpToken,
    updateMcp,
  } from "../lib/api";
  import {
    codeBoxClass,
    codeTextClass,
    copyButtonClass,
    fieldHintClass,
    fieldLabelClass,
    pageHintClass,
    saveButtonClass,
    sectionListClass,
  } from "../lib/formStyles";
  import { t } from "../lib/locale.svelte";

  let remoteAccess = $state(false);
  let authorization = $state<string | undefined>();
  let hasAuthorization = $state(false);
  let savedRemoteAccess = $state(false);
  let formError = $state("");
  let loading = $state(true);
  let saving = $state(false);
  let copied = $state(false);
  let endpointCopied = $state(false);
  let configCopied = $state(false);
  let remoteEndpoint = $state("");

  const endpointUrl = $derived(
    typeof window === "undefined"
      ? "/mcp"
      : remoteAccess
        ? remoteEndpoint || `${window.location.origin}/mcp`
        : `http://127.0.0.1:${window.location.port || "3000"}/mcp`,
  );
  const isDirty = $derived(remoteAccess !== savedRemoteAccess);
  const saveDisabled = $derived(saving || loading || !isDirty);
  const mcpJsonConfig = $derived(
    JSON.stringify(
      {
        mcpServers: {
          nanoflux: {
            url: endpointUrl,
            ...(remoteAccess && authorization
              ? { headers: { Authorization: `Bearer ${authorization}` } }
              : {}),
          },
        },
      },
      null,
      2,
    ),
  );

  async function loadMcp() {
    loading = true;
    formError = "";
    try {
      const config = await fetchMcp();
      try {
        remoteEndpoint = await fetchMcpEndpoint();
      } catch {
        remoteEndpoint = "";
      }
      remoteAccess = config.remoteAccess;
      hasAuthorization = config.hasAuthorization;
      savedRemoteAccess = config.remoteAccess;
      authorization = config.authorization;
    } catch (error) {
      formError = error instanceof Error ? error.message : t("mcp.loadFailed");
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saveDisabled) return;
    formError = "";
    saving = true;
    try {
      const updated = await updateMcp({
        remoteAccess,
        ...(remoteAccess && authorization ? { authorization } : {}),
      });
      remoteAccess = updated.remoteAccess;
      hasAuthorization = updated.hasAuthorization;
      savedRemoteAccess = updated.remoteAccess;
      authorization = updated.authorization;
    } catch (error) {
      formError = error instanceof Error ? error.message : t("mcp.saveFailed");
    } finally {
      saving = false;
    }
  }

  async function enableRemoteAccess() {
    if (remoteAccess || saving) return;
    remoteAccess = true;
    formError = "";
    saving = true;
    try {
      authorization = await generateMcpToken();
    } catch (error) {
      remoteAccess = savedRemoteAccess;
      formError = error instanceof Error ? error.message : t("mcp.saveFailed");
    } finally {
      saving = false;
    }
  }

  async function copyAuthorization() {
    if (!authorization) return;
    await navigator.clipboard.writeText(`Authorization: Bearer ${authorization}`);
    copied = true;
    window.setTimeout(() => (copied = false), 1500);
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpointUrl);
    endpointCopied = true;
    window.setTimeout(() => (endpointCopied = false), 1500);
  }

  async function copyJsonConfig() {
    await navigator.clipboard.writeText(mcpJsonConfig);
    configCopied = true;
    window.setTimeout(() => (configCopied = false), 1500);
  }

  onMount(() => void loadMcp());
</script>

<section class="mb-10">
  <p class={pageHintClass}>{t("mcp.hint")}</p>
  {#if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else}
    <div class={sectionListClass}>
      <SettingRow label={t("mcp.remoteAccess")}>
        <Segmented
          label={t("mcp.remoteAccess")}
          value={remoteAccess}
          options={[
            { value: false, label: t("mcp.localOnly") },
            { value: true, label: t("mcp.remoteEnabled") },
          ]}
          disabled={saving}
          onchange={(next) => (next ? void enableRemoteAccess() : (remoteAccess = false))}
        />
      </SettingRow>

      {#if remoteAccess}
        <div class="space-y-2 py-6">
          <span class={fieldLabelClass}>{t("mcp.authorization")}</span>
          {#if authorization}
            <div class="items-center {codeBoxClass}">
              <code class="break-all {codeTextClass}">Authorization: Bearer {authorization}</code>
              <button type="button" class={copyButtonClass} aria-label={t("mcp.copy")} title={t("mcp.copy")} onclick={() => void copyAuthorization()}>
                {#if copied}
                  <Check size={17} />
                {:else}
                  <Copy size={17} />
                {/if}
              </button>
            </div>
            {#if copied}<span class="block {fieldHintClass}">{t("mcp.copied")}</span>{/if}
            {#if isDirty}
              <span class="block text-xs text-amber-600 dark:text-amber-400">{t("mcp.authorizationSave")}</span>
            {/if}
          {:else}
            <span class="block {fieldHintClass}">{t("mcp.authorizationConfigured")}</span>
          {/if}
        </div>
      {/if}

      <div class="space-y-2 py-6">
        <span class={fieldLabelClass}>{t("mcp.endpoint")}</span>
        <div class="items-center {codeBoxClass}">
          <code class="break-all {codeTextClass}">{endpointUrl}</code>
          <button type="button" class={copyButtonClass} aria-label={t("mcp.copyEndpoint")} title={t("mcp.copyEndpoint")} onclick={() => void copyEndpoint()}>
            {#if endpointCopied}
              <Check size={17} />
            {:else}
              <Copy size={17} />
            {/if}
          </button>
        </div>
        {#if endpointCopied}<span class="block {fieldHintClass}">{t("mcp.copied")}</span>{/if}
      </div>

      <div class="space-y-2 py-6">
        <span class={fieldLabelClass}>{t("mcp.jsonConfig")}</span>
        <div class="items-start {codeBoxClass}">
          <pre class="overflow-x-auto {codeTextClass}"><code>{mcpJsonConfig}</code></pre>
          <button type="button" class={copyButtonClass} aria-label={t("mcp.copyJsonConfig")} title={t("mcp.copyJsonConfig")} onclick={() => void copyJsonConfig()}>
            {#if configCopied}
              <Check size={17} />
            {:else}
              <Copy size={17} />
            {/if}
          </button>
        </div>
        {#if configCopied}<span class="block {fieldHintClass}">{t("mcp.copied")}</span>{/if}
      </div>
    </div>

    <button type="button" disabled={saveDisabled} class="mt-2 {saveButtonClass}" onclick={() => void handleSave()}>{saving ? t("mcp.saving") : t("mcp.save")}</button>
  {/if}
  {#if formError}<p class="mt-3 text-sm text-red-500">{formError}</p>{/if}
</section>
