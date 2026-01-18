import sharp from "sharp";
import { CONFIG, type ScreenInfo, type SpotifyTrack } from "./config";

// Cache for blurred backgrounds by artwork URL
const backgroundCache = new Map<string, Buffer>();

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function createBlurredBackground(
  artwork: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  return sharp(artwork)
    .resize(width * 2, height * 2, { fit: "cover", kernel: "cubic" })
    .blur(100)
    .resize(width, height, { kernel: "cubic" })
    .modulate({
      brightness: CONFIG.BACKGROUND_BRIGHTNESS,
      saturation: CONFIG.BACKGROUND_SATURATION,
    })
    .composite([
      {
        input: await sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: CONFIG.DARK_OVERLAY_OPACITY },
          },
        })
          .png()
          .toBuffer(),
        blend: "over",
      },
    ])
    .png()
    .toBuffer();
}

function createTextOverlay(
  track: string,
  artist: string,
  width: number,
  height: number,
  textX: number,
  sizeFactor: number
): Buffer {
  const centerY = height / 2;
  const fontFamily =
    "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'SF Pro Display', sans-serif";

  // Calculate available width for text (with right margin)
  const rightMargin = Math.round(80 * sizeFactor);
  const maxTextWidth = width - textX - rightMargin;

  // Estimate character width ratio for the font (approximately 0.55 for this font family)
  const charWidthRatio = 0.55;

  // Calculate base font sizes
  let trackSize = Math.round(CONFIG.TRACK_FONT_SIZE * sizeFactor);
  let artistSize = Math.round(CONFIG.ARTIST_FONT_SIZE * sizeFactor);

  // Estimate text widths
  const estimatedTrackWidth = track.length * trackSize * charWidthRatio;
  const estimatedArtistWidth = artist.length * artistSize * charWidthRatio;

  // Calculate scale factors for each text element
  const trackScaleFactor = estimatedTrackWidth > maxTextWidth
    ? maxTextWidth / estimatedTrackWidth
    : 1;
  const artistScaleFactor = estimatedArtistWidth > maxTextWidth
    ? maxTextWidth / estimatedArtistWidth
    : 1;

  // Use the smaller scale factor to maintain visual harmony
  const textScaleFactor = Math.min(trackScaleFactor, artistScaleFactor, 1);

  // Apply dynamic scaling with a minimum size floor
  const minScaleFactor = 0.5; // Don't go below 50% of original size
  const finalScaleFactor = Math.max(textScaleFactor, minScaleFactor);

  trackSize = Math.round(trackSize * finalScaleFactor);
  artistSize = Math.round(artistSize * finalScaleFactor);

  return Buffer.from(`
    <svg width="${width}" height="${height}">
      <style>
        .track { font-family: ${fontFamily}; font-size: ${trackSize}px; font-weight: 700; fill: white; }
        .artist { font-family: ${fontFamily}; font-size: ${artistSize}px; font-weight: 500; fill: rgba(255,255,255,0.9); }
      </style>
      <text x="${textX}" y="${centerY - Math.round(8 * sizeFactor * finalScaleFactor)}" class="track">${escapeXml(track)}</text>
      <text x="${textX}" y="${centerY + Math.round(22 * sizeFactor * finalScaleFactor)}" class="artist">${escapeXml(artist)}</text>
    </svg>
  `);
}

export async function generateNowPlayingImage(
  artwork: Buffer,
  track: SpotifyTrack,
  screen: ScreenInfo,
  artworkUrl: string
): Promise<Buffer> {
  const width = Math.round(screen.width * screen.scale);
  const height = Math.round(screen.height * screen.scale);
  const sizeFactor = height / CONFIG.BASE_HEIGHT;

  const albumSize = Math.round(CONFIG.ALBUM_SIZE * sizeFactor);
  const albumX = Math.round(CONFIG.ALBUM_MARGIN_LEFT * sizeFactor);
  const albumY = Math.floor((height - albumSize) / 2);
  const textX = albumX + albumSize + Math.round(CONFIG.TEXT_GAP * sizeFactor);

  // Get or create cached background
  let background = backgroundCache.get(artworkUrl);
  if (!background) {
    background = await createBlurredBackground(artwork, width, height);
    backgroundCache.set(artworkUrl, background);

    // Limit cache to last 5 artworks
    if (backgroundCache.size > 5) {
      const firstKey = backgroundCache.keys().next().value;
      if (firstKey) backgroundCache.delete(firstKey);
    }
  }

  // Prepare album art
  const albumArt = await sharp(artwork)
    .resize(albumSize, albumSize, { kernel: "cubic" })
    .sharpen({ sigma: 0.5 })
    .toBuffer();

  // Create text overlay (synchronous)
  const textOverlay = createTextOverlay(track.track, track.artist, width, height, textX, sizeFactor);

  return sharp(background)
    .composite([
      { input: albumArt, top: albumY, left: albumX },
      { input: textOverlay, top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}

/**
 * Clears the background cache (useful when screen size changes).
 */
export function clearBackgroundCache(): void {
  backgroundCache.clear();
}

/**
 * Downloads an image from URL and returns it as a Buffer.
 */
export async function downloadArtwork(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
