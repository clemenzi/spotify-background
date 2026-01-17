import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { CONFIG, type SpotifyTrack, type ScreenInfo } from "./config";
import { getSpotifyInfo, getTrackId } from "./spotify";
import { getScreenInfo, getDesktopBackground, setDesktopBackground } from "./screen";
import { generateNowPlayingImage, downloadArtwork, clearBackgroundCache } from "./image-generator";

interface WatcherState {
  lastTrackId: string | null;
  lastArtworkUrl: string | null;
  cachedArtwork: Buffer | null;
  outputPath: string | null;
  isUpdating: boolean;
  originalBackground: string | null;
  isShuttingDown: boolean;
  pollIntervalId: ReturnType<typeof setInterval> | null;
}

const state: WatcherState = {
  lastTrackId: null,
  lastArtworkUrl: null,
  cachedArtwork: null,
  outputPath: null,
  isUpdating: false,
  originalBackground: null,
  isShuttingDown: false,
  pollIntervalId: null,
};

/**
 * Updates the desktop background with the current track.
 */
async function updateBackground(track: SpotifyTrack, screen: ScreenInfo): Promise<void> {
  if (state.isUpdating) return; // Prevent concurrent updates
  state.isUpdating = true;

  try {
    // Use cached artwork or download new
    const artwork = (track.artworkUrl === state.lastArtworkUrl && state.cachedArtwork)
      ? state.cachedArtwork
      : await (async () => {
        console.log("📥 Downloading new artwork...");
        const newArtwork = await downloadArtwork(track.artworkUrl);
        state.cachedArtwork = newArtwork;
        state.lastArtworkUrl = track.artworkUrl;
        return newArtwork;
      })();

    // Generate the image
    console.log("🎨 Generating image...");
    const image = await generateNowPlayingImage(artwork, track, screen, track.artworkUrl);

    const filename = `now_playing_${Date.now()}.png`;
    const newOutputPath = join(process.cwd(), filename);

    await writeFile(newOutputPath, image);

    // Set as background
    await setDesktopBackground(newOutputPath);
    console.log(`✅ Background updated: "${track.track}" by ${track.artist}`);

    if (state.outputPath && state.outputPath !== newOutputPath) {
      await unlink(state.outputPath).catch(() => { });
    }
    state.outputPath = newOutputPath;
  } finally {
    state.isUpdating = false;
  }
}

/**
 * Single poll iteration - checks for track changes and updates if needed.
 */
async function poll(screen: ScreenInfo): Promise<void> {
  // Skip polling if shutting down
  if (state.isShuttingDown) return;

  try {
    const track = await getSpotifyInfo();

    // Check again after async call
    if (state.isShuttingDown) return;

    if (!track) {
      // Spotify not playing - restore original background
      if (state.lastTrackId !== null) {
        console.log("⏸️  Playback stopped");
        state.lastTrackId = null;

        // Restore original background
        if (state.originalBackground) {
          try {
            await setDesktopBackground(state.originalBackground);
            console.log("🖼️  Restored original background");
          } catch {
            console.error("❌ Failed to restore original background");
          }
        }
      }
      return;
    }

    const trackId = getTrackId(track);

    // Check if track changed
    if (trackId !== state.lastTrackId) {
      console.log(`\n🎵 Track changed: "${track.track}" by ${track.artist}`);
      state.lastTrackId = trackId;
      await updateBackground(track, screen);
    }
  } catch (error) {
    // Suppress errors during shutdown (e.g., SIGINT interrupting osascript)
    if (state.isShuttingDown) return;

    // Check for SIGINT signal error (user pressed Ctrl+C)
    if (error instanceof Error && error.message.includes('SIGINT')) {
      return; // Silently ignore - shutdown handler will take care of cleanup
    }

    console.error("❌ Poll error:", error);
  }
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

  // Initial check
  await poll(screen);

  // Start polling loop and save interval ID for cleanup
  state.pollIntervalId = setInterval(() => poll(screen), CONFIG.POLL_INTERVAL_MS);

  console.log("👀 Watching for track changes... (Ctrl+C to stop)\n");
}

/**
 * Request graceful shutdown - stops polling immediately.
 */
export function requestShutdown(): void {
  state.isShuttingDown = true;
  if (state.pollIntervalId) {
    clearInterval(state.pollIntervalId);
    state.pollIntervalId = null;
  }
}

/**
 * Cleanup function for graceful shutdown.
 */
export async function cleanup(): Promise<void> {
  // Mark as shutting down to stop any in-flight operations
  requestShutdown();

  console.log("\n🧹 Cleaning up...");

  // Wait briefly for any in-flight operations to complete
  if (state.isUpdating) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Restore original background
  if (state.originalBackground) {
    try {
      await setDesktopBackground(state.originalBackground);
      console.log(`🖼️  Restored original background`);
    } catch {
      console.error("❌ Failed to restore original background");
    }
  }

  if (state.outputPath) {
    await unlink(state.outputPath).catch(() => { });
    console.log("🗑️  Removed temporary file");
  }

  clearBackgroundCache();
}
