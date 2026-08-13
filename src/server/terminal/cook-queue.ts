import PQueue from "p-queue";
import { config } from "@/server/config";

// One queue for the whole process so simultaneous cooks degrade gracefully instead of
// thrashing the machine. Concurrency comes from config (Task 6); default 2.
const queue = new PQueue({ concurrency: config.COOK_CONCURRENCY ?? 2 });

export function runOnCookQueue<T>(fn: () => Promise<T>): Promise<T> {
  return queue.add(fn) as Promise<T>;
}
