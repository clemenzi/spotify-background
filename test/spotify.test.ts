import assert from "node:assert/strict";
import test from "node:test";
import { getTrackId, parseSpotifyResponse, parseSpotifyTrack } from "../src/spotify";

test("parses Spotify metadata", () => {
  assert.deepEqual(parseSpotifyTrack("Artist|||Track|||https://example.com/art.jpg"), {
    artist: "Artist",
    track: "Track",
    artworkUrl: "https://example.com/art.jpg",
  });
});

test("moves a featured artist from the title to the artist", () => {
  assert.deepEqual(parseSpotifyTrack("Main|||Song (feat. Guest)|||https://example.com/art.jpg"), {
    artist: "Main, Guest",
    track: "Song",
    artworkUrl: "https://example.com/art.jpg",
  });
});

test("limits unusually long artist lists", () => {
  const track = parseSpotifyTrack("A, B, C, D, E, F, G|||Song|||https://example.com/art.jpg");
  assert.equal(track.artist, "A, B, C, D, E, F...");
});

test("rejects incomplete Spotify metadata", () => {
  assert.throws(() => parseSpotifyTrack("Artist|||Track|||"), /incomplete track metadata/);
  assert.throws(
    () => parseSpotifyTrack("Artist|||Track|||missing value"),
    /incomplete track metadata/,
  );
});

test("treats ads and other items without artwork as unavailable", () => {
  assert.equal(parseSpotifyResponse("unavailable"), "unavailable");
  assert.equal(parseSpotifyResponse("|||Ad|||missing value"), "unavailable");
});

test("track IDs include all fields that affect the wallpaper", () => {
  const first = { artist: "Artist", track: "Track", artworkUrl: "one" };
  const second = { ...first, artworkUrl: "two" };
  assert.notEqual(getTrackId(first), getTrackId(second));
});
