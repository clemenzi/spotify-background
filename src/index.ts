import { startWatcher, cleanup, requestShutdown } from "./watcher";

// Graceful shutdown handlers
process.on("SIGINT", async () => {
  // Immediately stop polling to prevent SIGINT propagation errors
  requestShutdown();
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  requestShutdown();
  await cleanup();
  process.exit(0);
});

// Start the watcher
startWatcher().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
