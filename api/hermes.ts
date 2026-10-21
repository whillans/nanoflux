import { Elysia, t } from "elysia";
import { getHermesPublicConfig, updateHermesConfig } from "../hermes";
import { sendHermesTest } from "../services/hermes/webhook";

function getHermesHandler() {
  try {
    return {
      code: 0,
      message: "ok",
      data: getHermesPublicConfig(),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get hermes config";
    return { code: 500, message };
  }
}

async function updateHermesHandler({
  body,
}: {
  body: { enabled?: boolean; url?: string; secret?: string };
}) {
  try {
    const payload: { enabled?: boolean; url?: string; secret?: string } = {};
    if (typeof body?.enabled === "boolean") {
      payload.enabled = body.enabled;
    }
    if (typeof body?.url === "string") {
      payload.url = body.url;
    }
    if (typeof body?.secret === "string") {
      payload.secret = body.secret;
    }
    const updated = await updateHermesConfig(payload);
    return { code: 0, message: "ok", data: updated };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update hermes config";
    return { code: 400, message };
  }
}

async function testHermesHandler() {
  try {
    await sendHermesTest();
    return { code: 0, message: "ok" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send test event";
    return { code: 502, message };
  }
}

export const routes = new Elysia({ prefix: "/api/hermes" })
  .get("/", getHermesHandler)
  .post("/", updateHermesHandler, {
    body: t.Object({
      enabled: t.Optional(t.Boolean()),
      url: t.Optional(t.String({ maxLength: 2048 })),
      secret: t.Optional(t.String({ maxLength: 1024 })),
    }),
  })
  .post("/test", testHermesHandler);
