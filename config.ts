import { open, readFile, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { passwordStrengthError } from "./shared/password-strength";

export const TRANSLATE_TARGET_LANGS = ["en", "zh-Hans", "zh-Hant"] as const;
export type TranslateTargetLang = (typeof TRANSLATE_TARGET_LANGS)[number];
export const DEFAULT_TRANSLATE_TARGET_LANG: TranslateTargetLang = "zh-Hans";

export type FilterConfig = {
  /** Yes/no question the AI filter asks about each item; empty uses the default. */
  question: string;
  /** What a "yes" answer looks like: news to keep. */
  keepCriteria: string;
  /** What a "no" answer looks like: news to reject. */
  rejectCriteria: string;
  enabled: boolean;
  /** Comma-separated title keywords that pass without blocklist or AI checks. */
  allowKeywords: string;
  /** Comma-separated title keywords that reject an item. */
  blockKeywords: string;
  sources: string[];
};

export type TranslateConfig = {
  enabled: boolean;
  targetLang: TranslateTargetLang;
};

export type DedupConfig = {
  enabled: boolean;
  /** Only items published within this many days of each other are compared. */
  windowDays: number;
  /** Title-token similarity a candidate must exceed before the LLM sees it. */
  minSimilarity: number;
  /** Most similar candidates sent to the LLM per item. */
  maxCandidates: number;
};

export const DEDUP_LIMITS = {
  windowDays: { min: 1, max: 30 },
  minSimilarity: { min: 0, max: 1 },
  maxCandidates: { min: 1, max: 20 },
} as const;

export type FeverConfig = {
  enabled: boolean;
  user: string;
  password: string;
};

export type McpConfig = {
  /** Allow clients other than localhost to reach the MCP endpoint. */
  remoteAccess: boolean;
  /** Bearer token required only while remote access is enabled. */
  authorization: string;
};

export type TokenizerConfig = {
  /** Tokens dropped from `title_tokens`, matched case-insensitively. */
  stopwords: string[];
};

export function parseTranslateTargetLang(
  value: unknown,
): TranslateTargetLang | null {
  if (value === "zh") return "zh-Hans";
  if (value === "en" || value === "zh-Hans" || value === "zh-Hant") {
    return value;
  }
  return null;
}

const CONFIG_PATH = resolve(process.cwd(), "config.json");

export type AppConfig = {
  filter: FilterConfig;
  translate: TranslateConfig;
  dedup: DedupConfig;
  fever: FeverConfig;
  mcp: McpConfig;
  tokenizer: TokenizerConfig;
};

const DEFAULT_STOPWORDS = [
  "的", "了", "是", "在", "和", "与", "及", "或", "等", "也", "都", "就",
  "被", "把", "将", "对", "从", "为", "于", "以", "之", "其", "这", "那",
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is",
  "are", "was", "were", "be", "at", "by", "with", "as", "from", "it",
];

function normalizeFilterSource(source: string): string {
  const trimmed = source.trim().toLocaleLowerCase();
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
      .hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "");
  }
}

function normalizeFilterSources(sources: string[]): string[] {
  return [...new Set(sources.map(normalizeFilterSource).filter(Boolean))];
}

function normalizeStopwords(values: string[]): string[] {
  return [
    ...new Set(
      values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean),
    ),
  ];
}

/** A number clamped into `limits`; missing values take `fallback`. */
function clampedNumber(
  limits: { min: number; max: number },
  fallback: number,
  integer = false,
) {
  return z
    .number()
    .default(fallback)
    .transform((value) => {
      const bounded = Math.min(limits.max, Math.max(limits.min, value));
      return integer ? Math.round(bounded) : bounded;
    });
}

// Each section fills missing fields with defaults; a field of the wrong type
// is an error, so a hand-edited mistake is reported instead of dropped.
const FilterSchema = z
  .object({
    question: z.string().default(""),
    keepCriteria: z.string().default(""),
    rejectCriteria: z.string().default(""),
    /** Legacy free-form criteria, now `keepCriteria`; read once and dropped on the next save. */
    prompt: z.string().optional(),
    enabled: z.boolean().default(false),
    allowKeywords: z.string().default(""),
    blockKeywords: z.string().default(""),
    /** Legacy name of `blockKeywords`; read once and dropped on the next save. */
    keywords: z.string().optional(),
    sources: z.array(z.string()).default(() => []).transform(normalizeFilterSources),
  })
  .transform(({ keywords, prompt, ...filter }) => ({
    ...filter,
    keepCriteria: filter.keepCriteria || prompt || "",
    blockKeywords: filter.blockKeywords || keywords || "",
  }));

const TranslateSchema = z.object({
  enabled: z.boolean().default(false),
  targetLang: z.enum(TRANSLATE_TARGET_LANGS).default(DEFAULT_TRANSLATE_TARGET_LANG),
});

const DedupSchema = z.object({
  enabled: z.boolean().default(true),
  windowDays: clampedNumber(DEDUP_LIMITS.windowDays, 3, true),
  minSimilarity: clampedNumber(DEDUP_LIMITS.minSimilarity, 0.6),
  maxCandidates: clampedNumber(DEDUP_LIMITS.maxCandidates, 5, true),
});

const FeverSchema = z.object({
  enabled: z.boolean().default(false),
  user: z.string().default(""),
  password: z.string().default(""),
});

const McpSchema = z.object({
  remoteAccess: z.boolean().default(false),
  authorization: z.string().default(""),
});

const TokenizerSchema = z.object({
  stopwords: z
    .array(z.string())
    .default(() => [...DEFAULT_STOPWORDS])
    .transform(normalizeStopwords),
});

const AppConfigSchema = z.object({
  filter: FilterSchema.prefault({}),
  translate: TranslateSchema.prefault({}),
  dedup: DedupSchema.prefault({}),
  fever: FeverSchema.prefault({}),
  mcp: McpSchema.prefault({}),
  tokenizer: TokenizerSchema.prefault({}),
});

let loaded = false;
let config: AppConfig = AppConfigSchema.parse({});
let writeLock: Promise<void> = Promise.resolve();

async function readJsonFile(path: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid JSON: ${message}`);
  }
}

const RENAME_ATTEMPTS = 3;

/**
 * Write via a synced temp file and rename, so a crash leaves either the old
 * or the new file, never a truncated one. Windows can briefly refuse the
 * rename while another process (antivirus, indexer) has the target open.
 */
async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  const handle = await open(tmp, "w", 0o600);
  try {
    await handle.writeFile(data, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!retryable || attempt >= RENAME_ATTEMPTS) {
        await rm(tmp, { force: true }).catch(() => {});
        throw error;
      }
      await Bun.sleep(50 * attempt);
    }
  }
}

async function persistUnlocked(): Promise<void> {
  await writeFileAtomic(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function persist(): Promise<void> {
  const pending = writeLock.then(persistUnlocked, persistUnlocked);
  writeLock = pending.then(
    () => undefined,
    () => undefined,
  );
  await pending;
}

/**
 * Load `config.json`, filling missing sections and fields with defaults.
 * An unreadable or invalid file throws rather than falling back to defaults,
 * since the next save would then overwrite the user's settings.
 */
export async function loadAppConfig(): Promise<void> {
  if (loaded) return;

  const raw = await readJsonFile(CONFIG_PATH);
  if (raw === null) {
    loaded = true;
    return;
  }

  const result = AppConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid ${CONFIG_PATH}:\n${z.prettifyError(result.error)}`);
  }
  config = result.data;
  loaded = true;

  // Write back filled-in defaults and normalized values.
  if (JSON.stringify(config) !== JSON.stringify(raw)) {
    await persist();
  }
}


export function getFilterState(): FilterConfig {
  return { ...config.filter };
}

export function getTranslateState(): TranslateConfig {
  return { ...config.translate };
}

export function getDedupState(): DedupConfig {
  return { ...config.dedup };
}

export function getFeverState(): FeverConfig {
  return { ...config.fever };
}

export function getMcpState(): McpConfig {
  return { ...config.mcp };
}

export function getTokenizerState(): TokenizerConfig {
  return { stopwords: [...config.tokenizer.stopwords] };
}

/** Create a high-entropy bearer token without changing the saved config. */
export function generateMcpAuthorization(): string {
  return `mcp_${randomBytes(32).toString("base64url")}`;
}

export async function updateFilterState(partial: {
  question?: string;
  keepCriteria?: string;
  rejectCriteria?: string;
  enabled?: boolean;
  allowKeywords?: string;
  blockKeywords?: string;
  sources?: string[];
}): Promise<FilterConfig> {
  if (typeof partial.question === "string") {
    config.filter.question = partial.question;
  }
  if (typeof partial.keepCriteria === "string") {
    config.filter.keepCriteria = partial.keepCriteria;
  }
  if (typeof partial.rejectCriteria === "string") {
    config.filter.rejectCriteria = partial.rejectCriteria;
  }
  if (typeof partial.enabled === "boolean") {
    config.filter.enabled = partial.enabled;
  }
  if (typeof partial.allowKeywords === "string") {
    config.filter.allowKeywords = partial.allowKeywords;
  }
  if (typeof partial.blockKeywords === "string") {
    config.filter.blockKeywords = partial.blockKeywords;
  }
  if (Array.isArray(partial.sources)) {
    config.filter.sources = normalizeFilterSources(
      partial.sources.filter((source): source is string => typeof source === "string"),
    );
  }
  await persist();
  return getFilterState();
}

export async function updateTranslateState(partial: {
  enabled?: boolean;
  targetLang?: TranslateConfig["targetLang"];
}): Promise<TranslateConfig> {
  if (typeof partial.enabled === "boolean") {
    config.translate.enabled = partial.enabled;
  }
  const nextLang = parseTranslateTargetLang(partial.targetLang);
  if (nextLang) {
    config.translate.targetLang = nextLang;
  }
  await persist();
  return getTranslateState();
}

export async function updateDedupState(
  partial: Partial<DedupConfig>,
): Promise<DedupConfig> {
  config.dedup = DedupSchema.parse({ ...config.dedup, ...partial });
  await persist();
  return getDedupState();
}

export async function updateFeverState(partial: {
  enabled?: boolean;
  user?: string;
  password?: string;
}): Promise<FeverConfig> {
  const nextUser =
    typeof partial.user === "string" ? partial.user.trim() : config.fever.user;
  const nextPassword =
    typeof partial.password === "string" && partial.password.length > 0
      ? partial.password
      : config.fever.password;
  const nextEnabled =
    typeof partial.enabled === "boolean" ? partial.enabled : config.fever.enabled;

  if (nextEnabled && (!nextUser || !nextPassword)) {
    throw new Error("Fever API requires a user and password when enabled");
  }

  const settingPassword =
    typeof partial.password === "string" && partial.password.length > 0;
  if (settingPassword || (nextEnabled && nextPassword)) {
    const strengthError = passwordStrengthError(nextPassword, "Fever password");
    if (strengthError) {
      throw new Error(strengthError);
    }
  }

  config.fever.user = nextUser;
  config.fever.password = nextPassword;
  config.fever.enabled = nextEnabled;
  await persist();
  return getFeverState();
}

export async function updateMcpState(partial: {
  remoteAccess?: boolean;
  authorization?: string;
}): Promise<McpConfig> {
  const nextRemoteAccess =
    typeof partial.remoteAccess === "boolean"
      ? partial.remoteAccess
      : config.mcp.remoteAccess;

  const nextAuthorization =
    typeof partial.authorization === "string"
      ? partial.authorization.trim()
      : config.mcp.authorization;

  if (nextRemoteAccess && !nextAuthorization) {
    throw new Error("Generate an MCP authorization token before enabling remote access");
  }

  config.mcp.remoteAccess = nextRemoteAccess;
  config.mcp.authorization = nextAuthorization;
  await persist();
  return getMcpState();
}
