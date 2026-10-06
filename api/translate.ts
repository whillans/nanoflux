import { Elysia, t } from "elysia";
import {
  getTranslateConfig,
  parseTranslateTargetLang,
  updateTranslateConfig,
  type TranslateTargetLang,
} from "../translate";
import { getTranslatePrompts } from "../services/translate/ai";

function getTranslateHandler() {
  try {
    return {
      code: 0,
      message: "ok",
      data: { ...getTranslateConfig(), prompts: getTranslatePrompts() },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get translate config";
    return { code: 500, message };
  }
}

async function updateTranslateHandler({
  body,
}: {
  body: {
    enabled?: boolean;
    targetLang?: TranslateTargetLang;
  };
}) {
  try {
    const payload: {
      enabled?: boolean;
      targetLang?: TranslateTargetLang;
    } = {};
    if (typeof body?.enabled === "boolean") {
      payload.enabled = body.enabled;
    }
    const targetLang = parseTranslateTargetLang(body?.targetLang);
    if (targetLang) {
      payload.targetLang = targetLang;
    }
    const updated = await updateTranslateConfig(payload);
    return {
      code: 0,
      message: "ok",
      data: { ...updated, prompts: getTranslatePrompts() },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update translate config";
    return { code: 500, message };
  }
}

export const routes = new Elysia({ prefix: "/api/translate" })
  .get("/", getTranslateHandler)
  .post("/", updateTranslateHandler, {
    body: t.Object({
      enabled: t.Optional(t.Boolean()),
      targetLang: t.Optional(
        t.Union([
          t.Literal("en"),
          t.Literal("zh"),
          t.Literal("zh-Hans"),
          t.Literal("zh-Hant"),
        ]),
      ),
    }),
  });
