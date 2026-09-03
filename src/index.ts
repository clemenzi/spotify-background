import { startWatcher, cleanup, requestShutdown } from "./watcher";

let isExiting = false;

async function shutdown(): Promise<void> {
  if (isExiting) return;
  isExiting = true;
  requestShutdown();
  await cleanup();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

// Start the watcher
startWatcher().catch((error) => {
  console.error("❌ Fatal error:", error);
  requestShutdown();
  void cleanup().finally(() => process.exit(1));
});
