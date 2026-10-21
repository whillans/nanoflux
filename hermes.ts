import {
  getHermesState,
  updateHermesState,
  type HermesConfig,
} from "./config";

export type { HermesConfig };

export type HermesPublicConfig = {
  enabled: boolean;
  url: string;
  hasSecret: boolean;
};

export function getHermesPublicConfig(): HermesPublicConfig {
  const { enabled, url, secret } = getHermesState();
  return { enabled, url, hasSecret: secret.length > 0 };
}

export async function updateHermesConfig(partial: {
  enabled?: boolean;
  url?: string;
  secret?: string;
}): Promise<HermesPublicConfig> {
  await updateHermesState(partial);
  return getHermesPublicConfig();
}
