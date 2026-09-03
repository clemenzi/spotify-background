import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { clearBackgroundCache, generateNowPlayingImage } from "../src/image-generator";

test("generates a correctly sized PNG and escapes text markup", async () => {
  const artwork = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: "#336699",
    },
  }).png().toBuffer();

  const output = await generateNowPlayingImage(
    artwork,
    { artist: "A & B", track: "<Track>", artworkUrl: "memory://artwork" },
    { width: 640, height: 360, scale: 1 },
    "memory://artwork",
  );
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 360);
  clearBackgroundCache();
});
