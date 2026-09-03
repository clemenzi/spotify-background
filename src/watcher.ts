import { rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, type SpotifyTrack, type ScreenInfo } from "./config";
import { getSpotifyInfo, getTrackId } from "./spotify";
import { getScreenInfo, getDesktopBackground, setDesktopBackground } from "./screen";
import { generateNowPlayingImage, downloadArtwork, clearBackgroundCache } from "./image-generator";

interface WatcherState {
  lastTrackId: string | null;
  lastArtworkUrl: string | null;
  cachedArtwork: Buffer | null;
  outputPath: string | null;
  originalBackground: string | null;
  isShuttingDown: boolean;
  pollTimeoutId: ReturnType<typeof setTimeout> | null;
  activePoll: Promise<void> | null;
  isWaitingForSpotify: boolean;
}

const state: WatcherState = {
  lastTrackId: null,
  lastArtworkUrl: null,
  cachedArtwork: null,
  outputPath: null,
  originalBackground: null,
  isShuttingDown: false,
  pollTimeoutId: null,
  activePoll: null,
  isWaitingForSpotify: false,
};

// Alternate between two stable URLs: macOS does not reload a wallpaper when
// its path is unchanged, while timestamped paths fill Recent Wallpapers.
const OUTPUT_PATHS = [
  join(tmpdir(), "spotify-background-now-playing-1.png"),
  join(tmpdir(), "spotify-background-now-playing-2.png"),
] as const;
const STAGING_OUTPUT_PATHS = [
  `${OUTPUT_PATHS[0]}.tmp`,
  `${OUTPUT_PATHS[1]}.tmp`,
] as const;
let cleanupPromise: Promise<void> | null = null;

function shouldAbortWork(): boolean {
  return state.isWaitingForSpotify || state.isShuttingDown;
}

async function removeGeneratedFiles(): Promise<void> {
  await Promise.all(
    [...OUTPUT_PATHS, ...STAGING_OUTPUT_PATHS].map((path) =>
      unlink(path).catch(() => undefined),
    ),
  );
}

async function restoreOriginalBackground(): Promise<void> {
  if (!state.originalBackground) return;

  try {
    await setDesktopBackground(state.originalBackground);
    console.log("🖼️  Restored original background");
  } catch (error) {
    console.error("❌ Failed to restore original background:", error);
  }
}

/**
 * Updates the desktop background with the current track.
 */
async function updateBackground(track: SpotifyTrack, screen: ScreenInfo): Promise<void> {
  try {
    if (shouldAbortWork()) return;

    let artwork = state.cachedArtwork;
    if (track.artworkUrl !== state.lastArtworkUrl || !artwork) {
      console.log("📥 Downloading new artwork...");
      artwork = await downloadArtwork(track.artworkUrl);
      state.cachedArtwork = artwork;
      state.lastArtworkUrl = track.artworkUrl;
    }

    if (shouldAbortWork()) return;

    console.log("🎨 Generating image...");
    const image = await generateNowPlayingImage(artwork, track, screen, track.artworkUrl);

    if (shouldAbortWork()) return;

    const currentIndex = OUTPUT_PATHS.findIndex((path) => path === state.outputPath);
    const nextIndex: 0 | 1 = currentIndex === 0 ? 1 : 0;
    const nextOutputPath = OUTPUT_PATHS[nextIndex];
    const stagingOutputPath = STAGING_OUTPUT_PATHS[nextIndex];

    await writeFile(stagingOutputPath, image);
    await rename(stagingOutputPath, nextOutputPath);

    await setDesktopBackground(nextOutputPath);
    console.log(`✅ Background updated: "${track.track}" by ${track.artist}`);

    state.outputPath = nextOutputPath;
  } finally {
    await Promise.all(STAGING_OUTPUT_PATHS.map((path) => unlink(path).catch(() => undefined)));
  }
}

/**
 * Single poll iteration - checks for track changes and updates if needed.
 */
async function poll(screen: ScreenInfo): Promise<void> {
  // Skip polling if shutting down
  if (state.isShuttingDown) return;

  try {
    const status = await getSpotifyInfo();

    // Check again after async call
    if (state.isShuttingDown) return;

    if (status === "not_running") {
      if (!state.isWaitingForSpotify) {
        state.isWaitingForSpotify = true;
        state.lastTrackId = null;
        console.log("⏳ Waiting for Spotify to open...");
        await restoreOriginalBackground();
      }
      return;
    }

    // Spotify is running (playing or paused)
    if (state.isWaitingForSpotify) {
      state.isWaitingForSpotify = false;
      console.log("✅ Spotify detected! Resuming...");
    }

    if (status === "paused") {
      if (state.lastTrackId !== null) {
        console.log("⏸️  Playback stopped");
        state.lastTrackId = null;
        await restoreOriginalBackground();
      }
      return;
    }

    if (status === "unavailable") {
      if (state.lastTrackId !== null) {
        console.log("📢 Current item has no artwork (possibly an ad)");
        state.lastTrackId = null;
        await restoreOriginalBackground();
      }
      return;
    }

    // status is a SpotifyTrack
    const track = status;
    const trackId = getTrackId(track);

    if (trackId !== state.lastTrackId) {
      console.log(`\n🎵 Track changed: "${track.track}" by ${track.artist}`);
      await updateBackground(track, screen);
      // Only mark the track as handled after the wallpaper was applied. Failed
      // downloads or renders are retried on the next poll.
      if (!shouldAbortWork()) state.lastTrackId = trackId;
    }
  } catch (error) {
    // Suppress errors during shutdown (e.g., SIGINT interrupting osascript)
    if (state.isShuttingDown) return;

    // Check for SIGINT signal error (user pressed Ctrl+C)
    if (error instanceof Error && error.message.includes("SIGINT")) {
      return; // Silently ignore - shutdown handler will take care of cleanup
    }

    console.error("❌ Poll error:", error);
  }
}

function runPoll(screen: ScreenInfo): Promise<void> {
  const activePoll = poll(screen).finally(() => {
    if (state.activePoll === activePoll) state.activePoll = null;
  });
  state.activePoll = activePoll;
  return activePoll;
}

function scheduleNextPoll(screen: ScreenInfo): void {
  if (state.isShuttingDown) return;

  state.pollTimeoutId = setTimeout(async () => {
    state.pollTimeoutId = null;
    await runPoll(screen);
    scheduleNextPoll(screen);
  }, CONFIG.POLL_INTERVAL_MS);
}

/**
 * Starts the watcher loop.
 */
export async function startWatcher(): Promise<void> {
  console.log("🎧 Spotify Background - Now Playing Desktop Background\n");

  // Save original background to restore later
  state.originalBackground = await getDesktopBackground();
  console.log(`💾 Saved original background: ${state.originalBackground}`);

  const screen = await getScreenInfo();
  console.log(`📺 Screen: ${screen.width}x${screen.height} @ ${screen.scale}x`);
  console.log(`⏱️  Polling every ${CONFIG.POLL_INTERVAL_MS}ms\n`);

  await runPoll(screen);

  scheduleNextPoll(screen);

  console.log("👀 Watching for track changes... (Ctrl+C to stop)\n");
}

/**
 * Request graceful shutdown - stops polling immediately.
 */
export function requestShutdown(): void {
  state.isShuttingDown = true;
  if (state.pollTimeoutId) {
    clearTimeout(state.pollTimeoutId);
    state.pollTimeoutId = null;
  }
}

/**
 * Cleanup function for graceful shutdown.
 */
async function performCleanup(): Promise<void> {
  requestShutdown();

  console.log("\n🧹 Cleaning up...");

  // Await the real in-flight operation instead of relying on an arbitrary delay.
  await state.activePoll?.catch(() => undefined);

  await restoreOriginalBackground();

  await removeGeneratedFiles();
  if (state.outputPath) {
    console.log("🗑️  Removed temporary file");
  }

  clearBackgroundCache();
}

export function cleanup(): Promise<void> {
  cleanupPromise ??= performCleanup();
  return cleanupPromise;
}
