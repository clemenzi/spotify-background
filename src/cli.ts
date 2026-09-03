#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startWatcher, cleanup, requestShutdown } from "./watcher";

const execFileAsync = promisify(execFile);

const PLIST_NAME = "me.vcz.spotify-background";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);
const PID_FILE = join(homedir(), ".spotify-background.pid");

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function readPid(): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(PID_FILE, "utf8")).trim(), 10);
    return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isSpotifyBackgroundProcess(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    const command = stdout.trim();
    return command.includes(PLIST_NAME)
      || command.includes(fileURLToPath(import.meta.url))
      || /(?:^|\/)spotify-background(?:\s|$)/.test(command);
  } catch {
    return false;
  }
}

/**
 * Creates a launchd plist for auto-start.
 */
function createPlist(): string {
  const scriptPath = escapeXml(fileURLToPath(import.meta.url));
  const environmentPath = escapeXml(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin");
  const logsDirectory = escapeXml(join(homedir(), "Library", "Logs"));

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${environmentPath}</string>
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
    <string>${logsDirectory}/spotify-background.log</string>
    <key>StandardErrorPath</key>
    <string>${logsDirectory}/spotify-background.error.log</string>
</dict>
</plist>`;
}

/**
 * Watch command - starts the Spotify background watcher.
 */
async function watchCommand(): Promise<void> {
  const existingPid = await readPid();
  if (existingPid && await isSpotifyBackgroundProcess(existingPid)) {
    throw new Error(`spotify-background is already running (PID: ${existingPid})`);
  }

  process.title = PLIST_NAME;
  await writeFile(PID_FILE, process.pid.toString());

  let isExiting = false;
  const shutdown = async (): Promise<void> => {
    if (isExiting) return;
    isExiting = true;
    requestShutdown();
    await cleanup();
    await unlink(PID_FILE).catch(() => undefined);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    await startWatcher();
  } catch (error) {
    console.error("❌ Fatal error:", error);
    requestShutdown();
    await cleanup();
    await unlink(PID_FILE).catch(() => undefined);
    process.exit(1);
  }
}

/**
 * Stop command - stops the running daemon.
 */
async function stopCommand(): Promise<void> {
  const pid = await readPid();
  if (!pid) {
    console.log("⚠️  No running process found.");
    await unlink(PID_FILE).catch(() => undefined);
    return;
  }

  if (!(await isSpotifyBackgroundProcess(pid))) {
    console.log("⚠️  Removed a stale PID file; no matching process was stopped.");
    await unlink(PID_FILE).catch(() => undefined);
    return;
  }

  try {
    process.kill(pid, 0);
    console.log(`🛑 Stopping process (PID: ${pid})...`);
    process.kill(pid, "SIGTERM");

    const deadline = Date.now() + 5_000;
    while (isProcessRunning(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (isProcessRunning(pid)) {
      console.warn("⚠️  The process is still shutting down.");
    } else {
      console.log("✅ Process stopped successfully.");
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      console.log("⚠️  Process is no longer running.");
    } else {
      console.error("❌ Error stopping process:", error);
    }
  }

  await unlink(PID_FILE).catch(() => undefined);
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
  const plistContent = createPlist();
  await writeFile(PLIST_PATH, plistContent);
  console.log(`📄 Created: ${PLIST_PATH}`);

  // Load the launchd service
  try {
    await execFileAsync("launchctl", ["load", PLIST_PATH]);
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

  if (!(await pathExists(PLIST_PATH))) {
    console.log("⚠️  Service is not installed.");
    return;
  }

  try {
    // Unload the service
    await execFileAsync("launchctl", ["unload", PLIST_PATH]).catch(() => undefined);
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

try {
  await program.parseAsync();
} catch (error) {
  console.error("❌ Command failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
