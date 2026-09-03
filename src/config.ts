export const CONFIG = {
  // Polling
  POLL_INTERVAL_MS: 1000, // Check every second

  // Image dimensions
  BASE_HEIGHT: 512,
  ALBUM_MARGIN_LEFT: 96,
  TEXT_GAP: 50,
  ALBUM_SIZE: 300,

  // Typography
  TRACK_FONT_SIZE: 32,
  ARTIST_FONT_SIZE: 20,

  // Background effects
  BACKGROUND_BRIGHTNESS: 0.65,
  BACKGROUND_SATURATION: 1.2,
  DARK_OVERLAY_OPACITY: 0.25,

  // Resource limits
  BACKGROUND_WORK_SIZE: 1024,
  BACKGROUND_CACHE_ENTRIES: 3,
  ARTWORK_DOWNLOAD_TIMEOUT_MS: 15_000,
  MAX_ARTWORK_BYTES: 20 * 1024 * 1024,
} as const;

export interface ScreenInfo {
  width: number;
  height: number;
  scale: number;
}

export interface SpotifyTrack {
  artist: string;
  track: string;
  artworkUrl: string;
}
