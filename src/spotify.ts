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
  const featMatch = track.match(/\s*[\(\[](?:feat\.?|ft\.?)\s+([^)\]]+)[\)\]]/i);

  if (featMatch) {
    track = track.replace(featMatch[0], "").trim();
    artist = `${artist}, ${featMatch[1]}`;
  }

  return { artist, track, artworkUrl };
}

/**
 * Creates a unique identifier for a track (used for change detection).
 */
export function getTrackId(track: SpotifyTrack): string {
  return `${track.artist}::${track.track}::${track.artworkUrl}`;
}
