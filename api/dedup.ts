import { Elysia, t } from "elysia";
import {
  getDedupState,
  updateDedupState,
  type DedupConfig,
} from "../config";
import { getDedupPrompt } from "../services/dedup/ai";

function getDedupHandler() {
  try {
    return {
      code: 0,
      message: "ok",
      data: { ...getDedupState(), prompt: getDedupPrompt() },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get dedup config";
    return { code: 500, message };
  }
}

async function updateDedupHandler({ body }: { body: Partial<DedupConfig> }) {
  try {
    const payload: Partial<DedupConfig> = {};
    if (typeof body?.enabled === "boolean") payload.enabled = body.enabled;
    if (typeof body?.windowDays === "number") payload.windowDays = body.windowDays;
    if (typeof body?.minSimilarity === "number") {
      payload.minSimilarity = body.minSimilarity;
    }
    if (typeof body?.maxCandidates === "number") {
      payload.maxCandidates = body.maxCandidates;
    }
    const updated = await updateDedupState(payload);
    return { code: 0, message: "ok", data: { ...updated, prompt: getDedupPrompt() } };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update dedup config";
    return { code: 500, message };
  }
}

export const routes = new Elysia({ prefix: "/api/dedup" })
  .get("/", getDedupHandler)
  .post("/", updateDedupHandler, {
    body: t.Object({
      enabled: t.Optional(t.Boolean()),
      windowDays: t.Optional(t.Number()),
      minSimilarity: t.Optional(t.Number()),
      maxCandidates: t.Optional(t.Number()),
    }),
  });
