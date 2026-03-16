import { runAppleScript } from "run-applescript";
import type { SpotifyTrack } from "./config";

/**
 * Splits an artist string by common multi-artist word delimiters (e.g. " & ", "and", "feat.")
 * and returns a trimmed list of individual artist names.
 */
function parseArtistList(artistStr: string): string[] {
  if (!artistStr || !artistStr.trim()) return [];
  return artistStr
    .split(/\s+(?:&|and|feat\.?|ft\.?)\s+/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/**
 * Merges two artist strings, preserving order and removing duplicates.
 * The first string is treated as the primary source.
 */
function mergeArtists(primary: string, secondary: string): string {
  const primaryList = parseArtistList(primary);
  const secondaryList = parseArtistList(secondary);

  const seen = new Set(primaryList.map((a) => a.toLowerCase()));
  for (const a of secondaryList) {
    if (!seen.has(a.toLowerCase())) {
      primaryList.push(a);
      seen.add(a.toLowerCase());
    }
  }

  return primaryList.join(", ");
}

/**
 * Fetches current track info from Spotify via AppleScript.
 * Returns null if Spotify isn't running or no track is playing.
 */
export async function getSpotifyInfo(): Promise<SpotifyTrack | null> {
  const result = await runAppleScript(`
    tell application "Spotify"
      if it is running then
        if player state is playing then
          return (artist of current track) & "|||" & (name of current track) & "|||" & (artwork url of current track) & "|||" & (album artist of current track)
        else
          return "paused"
        end if
      else
        return "null"
      end if
    end tell
  `);

  if (result === "null" || result === "paused") return null;

  const [artistRaw, trackRaw, artworkUrl, albumArtistRaw] = result.split("|||");

  // Merge the track artist(s) with the album artist field, which on Spotify
  // often contains all collaborating artists (e.g. "LDA & Aka7Even") while
  // `artist` may only carry the primary one (e.g. "LDA").
  let artist = mergeArtists(artistRaw, albumArtistRaw ?? "");
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
      artist = mergeArtists(artist, featMatch[1].trim());
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
