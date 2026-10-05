import {
  DEFAULT_TRANSLATE_TARGET_LANG,
  getTranslateState,
  loadAppConfig,
  parseTranslateTargetLang,
  TRANSLATE_TARGET_LANGS,
  updateTranslateState,
  type TranslateConfig,
  type TranslateTargetLang,
} from "./config";

export {
  DEFAULT_TRANSLATE_TARGET_LANG,
  parseTranslateTargetLang,
  TRANSLATE_TARGET_LANGS,
};
export type { TranslateConfig, TranslateTargetLang };

export async function loadTranslateConfig(): Promise<void> {
  await loadAppConfig();
}

export function getTranslateConfig(): TranslateConfig {
  return getTranslateState();
}

/** Whether title translation runs on newly fetched items. */
export function isTranslateEnabled(): boolean {
  return getTranslateState().enabled;
}

export async function updateTranslateConfig(partial: {
  enabled?: boolean;
  targetLang?: TranslateTargetLang;
}): Promise<TranslateConfig> {
  return updateTranslateState(partial);
}
