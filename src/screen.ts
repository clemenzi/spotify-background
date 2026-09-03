import { runAppleScript } from "run-applescript";
import type { ScreenInfo } from "./config";

let cachedScreenInfo: ScreenInfo | null = null;

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Gets screen dimensions and scale factor via AppleScript.
 * Caches the result since screen info rarely changes.
 */
export async function getScreenInfo(): Promise<ScreenInfo> {
  if (cachedScreenInfo) return cachedScreenInfo;

  const result = await runAppleScript(`
    use framework "AppKit"
    set mainScreen to current application's NSScreen's mainScreen()
    set screenFrame to mainScreen's frame()
    set screenWidth to (item 1 of item 2 of screenFrame) as integer
    set screenHeight to (item 2 of item 2 of screenFrame) as integer
    set scaleFactor to mainScreen's backingScaleFactor() as real
    return (screenWidth as text) & "," & (screenHeight as text) & "," & (scaleFactor as text)
  `);

  const [w, h, s] = result.split(",");
  if (w === undefined || h === undefined || s === undefined) {
    throw new Error(`Invalid screen information returned by macOS: ${result}`);
  }
  const width = Number.parseInt(w, 10);
  const height = Number.parseInt(h, 10);
  const scale = Number.parseFloat(s);
  if (![width, height, scale].every(Number.isFinite) || width <= 0 || height <= 0 || scale <= 0) {
    throw new Error(`Invalid screen information returned by macOS: ${result}`);
  }

  cachedScreenInfo = { width, height, scale };

  return cachedScreenInfo;
}

/**
 * Gets the current desktop background path.
 */
export async function getDesktopBackground(): Promise<string> {
  const result = await runAppleScript(`
    tell application "System Events"
      tell desktop 1
        return picture as text
      end tell
    end tell
  `);
  return result.trim();
}

/**
 * Sets the desktop background for all screens.
 */
export async function setDesktopBackground(imagePath: string): Promise<void> {
  const escapedPath = escapeAppleScriptString(imagePath);
  await runAppleScript(`
    tell application "System Events"
      tell every desktop
        set picture to "${escapedPath}"
      end tell
    end tell
  `);
}
