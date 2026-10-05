import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

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

/**
 * Chat completion whose reply is validated against `schema`.
 * Uses strict `json_schema` output where supported and falls back to
 * `json_object` (valid JSON, schema enforced only by zod) where it is not.
 */
export async function chatCompletionJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  name: string,
  options?: { temperature?: number },
): Promise<T> {
  const config = getAiConfig();
  if (!config) {
    throw new Error("AI is not configured");
  }

  const model = createChatModel(config, options);
  const messages = [new SystemMessage(system), new HumanMessage(user)];
  const supportKey = `${config.baseUrl}|${config.model}`;

  const invokeJsonObject = () =>
    model.invoke(messages, { response_format: { type: "json_object" } });

  let response;
  if (jsonSchemaSupport.get(supportKey) === false) {
    response = await invokeJsonObject();
  } else {
    const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema);
    try {
      response = await model.invoke(messages, {
        // json_schema goes through the SDK's `parse`, so malformed output
        // throws inside LangChain's retry loop; cap it at one retry.
        maxRetries: 1,
        response_format: {
          type: "json_schema",
          json_schema: { name, strict: true, schema: jsonSchema },
        },
      });
      jsonSchemaSupport.set(supportKey, true);
    } catch (error) {
      if (!isResponseFormatUnsupported(error)) throw error;
      jsonSchemaSupport.set(supportKey, false);
      console.warn(
        `[ai] ${config.model} rejects json_schema output; falling back to json_object`,
      );
      response = await invokeJsonObject();
    }
  }

  const text = textFromContent(response.content);
  if (!text) throw new Error("Empty AI response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`AI response is not JSON: ${text.slice(0, 100)}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `AI response does not match schema: ${result.error.message.slice(0, 200)}`,
    );
  }
  return result.data;
}
