import { optimizeDatabase, reclaimStorage } from "../db/database";
import { clearItems } from "../db/items";
import { fetchDueFeeds } from "./feeds/fetcher";

const TICK_CRON = "* * * * *";
const CLEANUP_CRON = "0 1 * * *";

let fetchCronJob: Bun.CronJob | null = null;
let cleanupCronJob: Bun.CronJob | null = null;

export async function startScheduler() {
  // Register cron first so a long startup fetch cannot block later ticks.
  fetchCronJob = Bun.cron(TICK_CRON, async () => {
    try {
      await fetchDueFeeds("cron");
    } catch (error) {
      console.error("[fetch:cron]", error);
    }
  });

  cleanupCronJob = Bun.cron(CLEANUP_CRON, async () => {
    try {
      clearItems();
      console.log("[cleanup:cron] Removed items older than 90 days");
      reclaimStorage();
      console.log("[cleanup:cron] Reclaimed free pages and truncated WAL");
      optimizeDatabase();
      console.log("[cleanup:cron] Refreshed query planner statistics");
    } catch (error) {
      console.error("[cleanup:cron]", error);
    }
  });

  console.log(
    `Fetch feeds scheduler: Bun.cron (cron ${TICK_CRON} UTC, per-feed 5–30 min)`,
  );
  console.log(
    `Cleanup items scheduler: Bun.cron (cron ${CLEANUP_CRON} UTC, items older than 90 days)`,
  );

  try {
    await fetchDueFeeds("startup");
  } catch (error) {
    console.error("[fetch:startup]", error);
  }
}

export async function stopScheduler() {
  if (fetchCronJob) {
    fetchCronJob.stop();
    fetchCronJob = null;
  }
  if (cleanupCronJob) {
    cleanupCronJob.stop();
    cleanupCronJob = null;
  }
}
