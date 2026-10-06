<script lang="ts">
  import type { Snippet } from "svelte";
  import { fieldHintClass, fieldLabelClass } from "../../lib/formStyles";

  interface Props {
    label: string;
    hint?: string;
    // id of the control this row labels, when it is a single form field.
    for?: string;
    children: Snippet;
  }

  let { label, hint, for: htmlFor, children }: Props = $props();
</script>

<div class="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
  <div class="min-w-0 space-y-1">
    {#if htmlFor}
      <label for={htmlFor} class={fieldLabelClass}>{label}</label>
    {:else}
      <span class={fieldLabelClass}>{label}</span>
    {/if}
    {#if hint}
      <p class={fieldHintClass}>{hint}</p>
    {/if}
  </div>
  {@render children()}
</div>
