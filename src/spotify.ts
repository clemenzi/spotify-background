import { runAppleScript } from "run-applescript";
import type { SpotifyTrack } from "./config";

/**
 * Fetches current track info from Spotify via AppleScript.
 * Returns null if Spotify isn't running or no track is playing.
 */
export async function getSpotifyInfo(): Promise<SpotifyTrack | null> {
  const result = await runAppleScript(`
    tell application "Spotify"
      if it is running then
        if player state is playing then
          return (artist of current track) & "|||" & (name of current track) & "|||" & (artwork url of current track)
        else
          return "paused"
        end if
      else
        return "null"
      end if
    end tell
  `);

  if (result === "null" || result === "paused") return null;

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

  return { artist, track, artworkUrl };
}

/**
 * Creates a unique identifier for a track (used for change detection).
 */
export function getTrackId(track: SpotifyTrack): string {
  return `${track.artist}::${track.track}::${track.artworkUrl}`;
}
