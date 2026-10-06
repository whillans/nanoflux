<script lang="ts">
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import Segmented from "./settings/Segmented.svelte";
  import SettingRow from "./settings/SettingRow.svelte";
  import { pageHintClass, sectionListClass } from "../lib/formStyles";
  import { fontSizeState, setFontSize, type FontSize } from "../lib/fontSize.svelte";
  import { localeState, setLocale, t } from "../lib/locale.svelte";
  import { themeState, setTheme, type Theme } from "../lib/theme.svelte";
  import type { Locale } from "../lib/i18n/messages";

  // Glyph sizes are fixed so the preview does not scale with the setting itself.
  const fontGlyphClass: Record<FontSize, string> = {
    small: "text-[12px]",
    medium: "text-[15px]",
    large: "text-[18px]",
  };
</script>

<section class="mb-10">
  <p class={pageHintClass}>{t("prefs.hint")}</p>
  <div class={sectionListClass}>
    <SettingRow label={t("prefs.fontSize")}>
      <Segmented
        label={t("prefs.fontSize")}
        value={fontSizeState.mode}
        options={[
          { value: "small" as FontSize, label: t("font.small") },
          { value: "medium" as FontSize, label: t("font.medium") },
          { value: "large" as FontSize, label: t("font.large") },
        ]}
        onchange={setFontSize}
      >
        {#snippet item(size: FontSize)}
          <span class="{fontGlyphClass[size]} leading-none" aria-hidden="true">A</span>
        {/snippet}
      </Segmented>
    </SettingRow>

    <!-- Languages are shown in their own names so they stay recognisable in any locale. -->
    <SettingRow label={t("prefs.language")}>
      <Segmented
        label={t("prefs.language")}
        value={localeState.locale}
        options={[
          { value: "en" as Locale, label: "English", title: t("lang.en"), lang: "en" },
          { value: "zh-Hans" as Locale, label: "简体中文", title: t("lang.zhHans"), lang: "zh-Hans" },
          { value: "zh-Hant" as Locale, label: "繁體中文", title: t("lang.zhHant"), lang: "zh-Hant" },
        ]}
        onchange={setLocale}
      />
    </SettingRow>

    <SettingRow label={t("prefs.theme")}>
      <Segmented
        label={t("prefs.theme")}
        value={themeState.mode}
        options={[
          { value: "light" as Theme, label: t("theme.lightMode") },
          { value: "dark" as Theme, label: t("theme.darkMode") },
        ]}
        onchange={setTheme}
      >
        {#snippet item(mode: Theme)}
          {#if mode === "dark"}
            <Moon size={15} strokeWidth={1.5} aria-hidden="true" />
            {t("theme.darkMode")}
          {:else}
            <Sun size={15} strokeWidth={1.5} aria-hidden="true" />
            {t("theme.lightMode")}
          {/if}
        {/snippet}
      </Segmented>
    </SettingRow>
  </div>
</section>
