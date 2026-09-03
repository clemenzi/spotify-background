import { runAppleScript } from "run-applescript";
import type { SpotifyTrack } from "./config";

/**
 * The status returned by getSpotifyInfo:
 * - SpotifyTrack: Spotify is running and a track is playing
 * - "paused":     Spotify is running but playback is paused/stopped
 * - "not_running": Spotify is not running
 */
export type SpotifyStatus = SpotifyTrack | "paused" | "not_running";

// Known Apple Events / Spotify connection error codes that indicate Spotify quit:
//   -609 connection is invalid, -600 process is not running, -1743 permission denied
const KNOWN_CONNECTION_ERRORS = new Set(["-609", "-600", "-1743"]);

// Matches AppleScript error codes in formats like "(-609)" or "error -609"
const APPLESCRIPT_ERROR_CODE_RE = /(?:\(|error\s+)(-\d+)\)?/;

const FEATURED_ARTIST_PATTERNS = [
  /\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with|w\/|con|avec|mit|c\/)\s+([^)\]]+)[\)\]]/i,
  /\s*[-–—]\s*(?:feat\.?|ft\.?|featuring|with|w\/|con|avec|mit|c\/)\s+(.+)$/i,
  /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i,
];

const MAX_ARTISTS = 6;

/** Converts Spotify's AppleScript response into validated track metadata. */
export function parseSpotifyTrack(result: string): SpotifyTrack {
  const parts = result.split("|||");
  if (parts.length !== 3 || parts.some((part) => part.trim().length === 0)) {
    throw new Error("Spotify returned incomplete track metadata");
  }

  let [artist, track, artworkUrl] = parts.map((part) => part.trim()) as [string, string, string];

  for (const pattern of FEATURED_ARTIST_PATTERNS) {
    const featuredArtist = track.match(pattern);
    const featuredName = featuredArtist?.[1];
    if (!featuredArtist || !featuredName) continue;

    track = track.replace(featuredArtist[0], "").trim();
    artist = `${artist}, ${featuredName.trim()}`;
    break;
  }

  const artists = artist.split(/,\s*/);
  if (artists.length > MAX_ARTISTS) {
    artist = `${artists.slice(0, MAX_ARTISTS).join(", ")}...`;
  }

  return { artist, track, artworkUrl };
}

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
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = message.match(APPLESCRIPT_ERROR_CODE_RE)?.[1];
    if (!errorCode || !KNOWN_CONNECTION_ERRORS.has(errorCode)) {
      console.warn("⚠️  AppleScript error (treating as not running):", message);
    }
    return "not_running";
  }

  if (result === "not_running") return "not_running";
  if (result === "paused") return "paused";

  return parseSpotifyTrack(result);
}

/**
 * Creates a unique identifier for a track (used for change detection).
 */
export function getTrackId(track: SpotifyTrack): string {
  return `${track.artist}::${track.track}::${track.artworkUrl}`;
}
