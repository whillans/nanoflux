import { getTranslateConfig, isTranslateEnabled } from "../../translate";
import { applyAiTitleTranslate } from "./ai";
import { isTitleInTargetLang } from "./detect";

/**
 * Translate item titles when translation is enabled.
 * Rejected and deleted items are skipped. LLM failure keeps the original title.
 */
export async function translateItemTitles<
  T extends { title: string; status?: "passed" | "rejected" | "deleted" },
>(items: T[]): Promise<T[]> {
  if (items.length === 0) return [];

  if (!isTranslateEnabled()) {
    console.log(
      `[translate] inactive — skip AI for ${items.length} item(s)`,
    );
    return items;
  }

  const { targetLang } = getTranslateConfig();
  const active = items.filter((item) => item.status === undefined || item.status === "passed");
  const toTranslate = active.filter(
    (item) => !isTitleInTargetLang(item.title, targetLang),
  );
  const skipped = active.length - toTranslate.length;
  console.log(
    `[translate] AI titles=${toTranslate.length}/${items.length} skippedSameLang=${skipped} targetLang=${targetLang}`,
  );

  const translated: T[] = [];
  for (const item of items) {
    if (item.status && item.status !== "passed") {
      translated.push(item);
      continue;
    }
    if (isTitleInTargetLang(item.title, targetLang)) {
      translated.push(item);
      continue;
    }
    const title = await applyAiTitleTranslate(item.title, targetLang);
    translated.push({ ...item, title });
  }
  console.log(`[translate] done`);
  return translated;
}
