#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { startWatcher, cleanup, requestShutdown } from "./watcher";

const execAsync = promisify(exec);

const PLIST_NAME = "me.vcz.spotify-background";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);
const PID_FILE = join(homedir(), ".spotify-background.pid");



/**
 * Gets the path to the cli.ts script.
 */
function getScriptPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  return __filename;
}

/**
 * Creates a launchd plist for auto-start.
 */
async function createPlist(): Promise<string> {
  const scriptPath = getScriptPath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${process.env.PATH}</string>
    </dict>
    <key>ProgramArguments</key>
    <array>
        <string>${scriptPath}</string>
        <string>watch</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${homedir()}/Library/Logs/spotify-background.log</string>
    <key>StandardErrorPath</key>
    <string>${homedir()}/Library/Logs/spotify-background.error.log</string>
</dict>
</plist>`;
}

/**
 * Watch command - starts the Spotify background watcher.
 */
async function watchCommand(): Promise<void> {
  // Write PID file
  await writeFile(PID_FILE, process.pid.toString());

  // Graceful shutdown handlers
  process.on("SIGINT", async () => {
    requestShutdown();
    await cleanup();
    await unlink(PID_FILE).catch(() => { });
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    requestShutdown();
    await cleanup();
    await unlink(PID_FILE).catch(() => { });
    process.exit(0);
  });

  // Start the watcher
  try {
    await startWatcher();
  } catch (error) {
    console.error("❌ Fatal error:", error);
    await unlink(PID_FILE).catch(() => { });
    process.exit(1);
  }
}

/**
 * Stop command - stops the running daemon.
 */
async function stopCommand(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log("⚠️  No running process found.");
    return;
  }

  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);

  try {
    // Check if process exists
    process.kill(pid, 0);

    // Send SIGTERM
    console.log(`🛑 Stopping process (PID: ${pid})...`);
    process.kill(pid, "SIGTERM");

    // Wait a bit for cleanup
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("✅ Process stopped successfully.");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      console.log("⚠️  Process is no longer running.");
    } else {
      console.error("❌ Error stopping process:", error);
    }
  }

  // Clean up PID file
  await unlink(PID_FILE).catch(() => { });
}

/**
 * Setup install - adds the daemon to launchd for auto-start.
 */
async function setupInstallCommand(): Promise<void> {
  console.log("🔧 Configuring auto-start...\n");

  // Create LaunchAgents directory if needed
  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  await mkdir(launchAgentsDir, { recursive: true });

  // Write the plist file
  const plistContent = await createPlist();
  await writeFile(PLIST_PATH, plistContent);
  console.log(`📄 Created: ${PLIST_PATH}`);

  // Load the launchd service
  try {
    await execAsync(`launchctl load ${PLIST_PATH}`);
    console.log("✅ Service loaded into launchd.");
    console.log("\n🎉 The app will start automatically on next login.");
    console.log("   To start now, run: spotify-background watch");
  } catch (error) {
    console.error("❌ Error loading service:", error);
  }
}

/**
 * Setup uninstall - removes the daemon from launchd.
 */
async function setupUninstallCommand(): Promise<void> {
  console.log("🔧 Removing auto-start...\n");

  if (!existsSync(PLIST_PATH)) {
    console.log("⚠️  Service is not installed.");
    return;
  }

  try {
    // Unload the service
    await execAsync(`launchctl unload ${PLIST_PATH}`).catch(() => { });
    console.log("✅ Service removed from launchd.");

    // Remove the plist file
    await unlink(PLIST_PATH);
    console.log(`🗑️  Removed: ${PLIST_PATH}`);

    console.log("\n✅ Auto-start has been disabled.");
  } catch (error) {
    console.error("❌ Error removing service:", error);
  }
}

// CLI setup
const program = new Command();

program
  .name("spotify-background")
  .description("🎧 Spotify Now Playing desktop background for macOS")
  .version("1.0.0");

program
  .command("watch")
  .description("Start the Spotify background watcher")
  .action(watchCommand);

program
  .command("stop")
  .description("Stop the running process")
  .action(stopCommand);

const setup = program
  .command("setup")
  .description("Manage auto-start settings");

setup
  .command("install")
  .description("Enable auto-start on login")
  .action(setupInstallCommand);

setup
  .command("uninstall")
  .description("Disable auto-start")
  .action(setupUninstallCommand);

program.parse();
