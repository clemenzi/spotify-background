import { runAppleScript } from "run-applescript";
import type { SpotifyTrack } from "./config";

/**
 * The status returned by getSpotifyInfo:
 * - SpotifyTrack: Spotify is running and a track is playing
 * - "paused":     Spotify is running but playback is paused/stopped
 * - "not_running": Spotify is not running
 */
export type SpotifyStatus = SpotifyTrack | "paused" | "not_running";

/**
 * Fetches current track info from Spotify via AppleScript.
 * Returns "not_running" if Spotify isn't open, "paused" if open but not playing,
 * or a SpotifyTrack object if a track is currently playing.
 */
export async function getSpotifyInfo(): Promise<SpotifyStatus> {
  let result: string;
  try {
    result = await runAppleScript(`
      tell application "Spotify"
        if it is running then
          if player state is playing then
            return (artist of current track) & "|||" & (name of current track) & "|||" & (artwork url of current track)
          else
            return "paused"
          end if
        else
          return "not_running"
        end if
      end tell
    `);
  } catch (error) {
    // Spotify closed mid-query (e.g. AppleScript error -609 "connection is invalid").
    // Log unexpected errors (anything that isn't a known Spotify connection error).
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("-609") && !message.includes("connection is invalid")) {
      console.error("⚠️  AppleScript error (treating as not running):", message);
    }
    return "not_running";
  }

  if (result === "not_running") return "not_running";
  if (result === "paused") return "paused";

  const [artistRaw, trackRaw, artworkUrl] = result.split("|||");

  let artist = artistRaw;
  let track = trackRaw;

  // Extract featured artists from track name
  // Comprehensive regex covering multiple languages and formats:
  // - Keywords: feat, ft, featuring, with, w/, con (IT/ES), avec (FR), mit (DE), c/
  // - Formats: (feat. X), [ft X], - feat X, – featuring X, — with X
  const featPatterns = [
    // Pattern 1: Inside parentheses or brackets - e.g. "(feat. Artist)" or "[ft Artist]"
    /\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with|w\/|con|avec|mit|c\/)\s+([^)\]]+)[\)\]]/i,
    // Pattern 2: After dash/hyphen - e.g. "Track - feat. Artist" or "Track – featuring Artist"
    /\s*[-–—]\s*(?:feat\.?|ft\.?|featuring|with|w\/|con|avec|mit|c\/)\s+(.+)$/i,
    // Pattern 3: Open-ended at end (no delimiter) - e.g. "Track feat. Artist"
    /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i,
  ];

  for (const pattern of featPatterns) {
    const featMatch = track.match(pattern);
    if (featMatch) {
      track = track.replace(featMatch[0], "").trim();
      artist = `${artist}, ${featMatch[1].trim()}`;
      break;
    }
  }

  // Limit to 6 artists maximum
  const artistList = artist.split(/,\s*/);
  if (artistList.length > 6) {
    artist = artistList.slice(0, 6).join(", ") + "...";
  }

  return { artist, track, artworkUrl };
}

/**
 * Creates a unique identifier for a track (used for change detection).
 */
export function getTrackId(track: SpotifyTrack): string {
  return `${track.artist}::${track.track}::${track.artworkUrl}`;
}
