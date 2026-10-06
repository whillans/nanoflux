<script lang="ts" generics="T extends string | boolean">
  import type { Snippet } from "svelte";

  interface Option {
    value: T;
    label: string;
    title?: string;
    lang?: string;
  }

  interface Props {
    value: T;
    options: Option[];
    label: string;
    disabled?: boolean;
    onchange: (value: T) => void;
    // Custom option content; the option's label is then used as its accessible name.
    item?: Snippet<[T]>;
  }

  let { value, options, label, disabled = false, onchange, item }: Props = $props();

  function optionClass(active: boolean): string {
    return `inline-flex h-8 min-w-10 items-center justify-center gap-1.5 rounded-md px-3 text-[14px] leading-none transition-colors disabled:opacity-60 ${
      active
        ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
        : "text-neutral-500 enabled:hover:text-neutral-900 dark:text-neutral-400 dark:enabled:hover:text-neutral-100"
    }`;
  }
</script>

<div
  class="inline-flex shrink-0 self-start rounded-lg bg-neutral-100 p-0.5 sm:self-auto dark:bg-neutral-900"
  role="group"
  aria-label={label}
>
  {#each options as option (option.value)}
    <button
      type="button"
      class={optionClass(option.value === value)}
      aria-pressed={option.value === value}
      aria-label={item ? option.label : undefined}
      title={option.title ?? (item ? option.label : undefined)}
      lang={option.lang}
      {disabled}
      onclick={() => onchange(option.value)}
    >
      {#if item}
        {@render item(option.value)}
      {:else}
        {option.label}
      {/if}
    </button>
  {/each}
</div>
