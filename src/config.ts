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
