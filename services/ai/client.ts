import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  OpenAIProvider,
  type Questions,
  SystemOneAdapterClient,
  type SystemOneResponse,
} from "system-one-adapter";

const AI_TIMEOUT_MS = 30_000;

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getAiConfig(): AiConfig | null {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL_NAME?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

function createChatModel(
  config: AiConfig,
  options?: { temperature?: number },
): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    // Some Azure-backed models only accept their provider default.  Omit the
    // field unless a caller explicitly opts into a supported value.
    ...(options?.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    timeout: AI_TIMEOUT_MS,
    // Prefer chat completions for OpenAI-compatible providers.
    useResponsesApi: false,
    configuration: {
      baseURL: `${config.baseUrl}/v1`,
    },
  });
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
          ? part.text
          : "",
    )
    .join("")
    .trim();
}

/** Some reasoning models put the final JSON in reasoning when content is empty. */
function textFromReasoning(response: {
  additional_kwargs?: Record<string, unknown>;
}): string {
  const reasoning = response.additional_kwargs?.reasoning_content;
  if (typeof reasoning !== "string" || !reasoning.trim()) return "";
  const jsonMatch = reasoning.match(/\{[\s\S]*"pass"\s*:[\s\S]*\}/);
  return (jsonMatch?.[0] ?? reasoning).trim();
}

export async function chatCompletion(
  system: string,
  user: string,
  options?: { temperature?: number },
): Promise<string> {
  const config = getAiConfig();
  if (!config) {
    throw new Error("AI is not configured");
  }

  const model = createChatModel(config, options);
  const response = await model.invoke([
    new SystemMessage(system),
    new HumanMessage(user),
  ]);

  const text =
    textFromContent(response.content) || textFromReasoning(response);

  if (!text) throw new Error("Empty AI response");
  return text;
}

/** The adapter's OpenAI client has no timeout option; bound each request here. */
const fetchWithTimeout = ((input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(AI_TIMEOUT_MS),
    ]),
  })) as typeof fetch;

/**
 * Whether the configured provider accepts `response_format: json_schema`,
 * keyed by base URL + model. Unknown until the first structured call.
 */
const jsonSchemaSupport = new Map<string, boolean>();

/** Provider rejected the `response_format` type itself (e.g. DeepSeek: json_object only). */
function isResponseFormatUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  if (status !== undefined && status !== 400) return false;
  return /response_format|json_schema/i.test(error.message);
}

const systemOneProviders = new Map<string, OpenAIProvider>();

function getSystemOneProvider(config: AiConfig): OpenAIProvider {
  const key = `${config.baseUrl}|${config.model}|${config.apiKey}`;
  let provider = systemOneProviders.get(key);
  if (!provider) {
    provider = new OpenAIProvider(config.model, {
      baseUrl: `${config.baseUrl}/v1`,
      apiKey: config.apiKey,
      // Prefer chat completions for OpenAI-compatible providers.
      api: "chat_completions",
      fetch: fetchWithTimeout,
    });
    systemOneProviders.set(key, provider);
  }
  return provider;
}

function createSystemOneClient(structuredOutputs: boolean): SystemOneAdapterClient {
  return new SystemOneAdapterClient({
    structuredOutputs,
    llmAnswerMode: "probabilities",
    normalizeProbabilities: true,
    nRetryMalformedStructure: 1,
    retry: { maxRetries: 1 },
  });
}

/** Strict `json_schema` output, and JSON prompted in the system message. */
const structuredClient = createSystemOneClient(true);
const promptedClient = createSystemOneClient(false);

/**
 * Evaluate typed questions (`noul`, `choice`, `score`) against `state` with
 * the configured LLM, System One style: the model only answers the questions,
 * each with a probability. Uses strict `json_schema` output where supported
 * and falls back to prompted JSON (validated by the adapter) where it is not.
 */
export async function systemOne<Q extends Questions>(
  state: unknown,
  questions: Q,
): Promise<SystemOneResponse<Q>["answers"]> {
  const config = getAiConfig();
  if (!config) {
    throw new Error("AI is not configured");
  }

  const request = { state, questions, model: getSystemOneProvider(config) };
  const supportKey = `${config.baseUrl}|${config.model}`;

  if (jsonSchemaSupport.get(supportKey) !== false) {
    try {
      const response = await structuredClient.systemOne(request);
      jsonSchemaSupport.set(supportKey, true);
      return response.answers;
    } catch (error) {
      if (!isResponseFormatUnsupported(error)) throw error;
      jsonSchemaSupport.set(supportKey, false);
      console.warn(
        `[ai] ${config.model} rejects json_schema output; falling back to prompted JSON`,
      );
    }
  }

  return (await promptedClient.systemOne(request)).answers;
}
