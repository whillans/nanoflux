import { Elysia, t } from "elysia";
import { getFilterConfig, updateFilterConfig } from "../filter";

function getFilterHandler() {
  try {
    return {
      code: 0,
      message: "ok",
      data: getFilterConfig(),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get filter";
    return { code: 500, message };
  }
}

async function updateFilterHandler({
  body,
}: {
  body: {
    question?: string;
    keepCriteria?: string;
    rejectCriteria?: string;
    enabled?: boolean;
    allowKeywords?: string;
    blockKeywords?: string;
    sources?: string[];
  };
}) {
  try {
    const payload: {
      question?: string;
      keepCriteria?: string;
      rejectCriteria?: string;
      enabled?: boolean;
      allowKeywords?: string;
      blockKeywords?: string;
      sources?: string[];
    } = {};
    if (typeof body?.question === "string") {
      payload.question = body.question;
    }
    if (typeof body?.keepCriteria === "string") {
      payload.keepCriteria = body.keepCriteria;
    }
    if (typeof body?.rejectCriteria === "string") {
      payload.rejectCriteria = body.rejectCriteria;
    }
    if (typeof body?.enabled === "boolean") {
      payload.enabled = body.enabled;
    }
    if (typeof body?.allowKeywords === "string") {
      payload.allowKeywords = body.allowKeywords;
    }
    if (typeof body?.blockKeywords === "string") {
      payload.blockKeywords = body.blockKeywords;
    }
    if (Array.isArray(body?.sources)) {
      payload.sources = body.sources;
    }
    const updated = await updateFilterConfig(payload);
    return { code: 0, message: "ok", data: updated };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update filter";
    return { code: 500, message };
  }
}

export const routes = new Elysia({ prefix: "/api/filter" })
  .get("/", getFilterHandler)
  .post("/", updateFilterHandler, {
    body: t.Object({
      question: t.Optional(t.String()),
      keepCriteria: t.Optional(t.String()),
      rejectCriteria: t.Optional(t.String()),
      enabled: t.Optional(t.Boolean()),
      allowKeywords: t.Optional(t.String()),
      blockKeywords: t.Optional(t.String()),
      sources: t.Optional(t.Array(t.String())),
    }),
  });
