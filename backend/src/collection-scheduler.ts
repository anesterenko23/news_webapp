import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { collectMany } from "./collector.js";
export function startCollectionScheduler(db: PrismaClient, config: Config) {
  if (config.COLLECTION_AUTO_ENABLED !== "true") return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await collectMany(db, {
        maxArticles: config.COLLECTION_MAX_ARTICLES,
        requestBudget: config.COLLECTION_REQUEST_BUDGET,
      });
    } catch (e) {
      console.warn(
        JSON.stringify({
          service: "collection-scheduler",
          error: String(e).slice(0, 300),
        }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(
    () => void tick(),
    config.COLLECTION_INTERVAL_MINUTES * 60000,
  );
  timer.unref();
  return () => clearInterval(timer);
}
