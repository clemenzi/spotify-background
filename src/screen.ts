import { runAppleScript } from "run-applescript";
import type { ScreenInfo } from "./config";

let cachedScreenInfo: ScreenInfo | null = null;

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
  cachedScreenInfo = {
    width: parseInt(w, 10),
    height: parseInt(h, 10),
    scale: parseFloat(s),
  };

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
  await runAppleScript(`
    tell application "System Events"
      tell every desktop
        set picture to "${imagePath}"
      end tell
    end tell
  `);
}
