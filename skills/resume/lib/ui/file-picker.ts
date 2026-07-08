/**
 * Native file picker for selecting a résumé.
 *
 * On macOS, pops a real Finder "choose file" dialog via osascript, restricted
 * to résumé-shaped types. Returns the chosen POSIX path, or null if the user
 * cancelled or no native picker is available (non-macOS / headless), so the
 * caller can fall back to a text prompt.
 */
import { spawn } from "node:child_process";
import { platform } from "node:os";

const APPLESCRIPT = `set theFile to choose file with prompt "Select your résumé (PDF, Word, or text)" of type {"pdf", "org.openxmlformats.wordprocessingml.document", "public.plain-text", "net.daringfireball.markdown", "txt", "md"}
POSIX path of theFile`;

export function nativePickerAvailable(): boolean {
  return platform() === "darwin";
}

/**
 * Open a file in the OS default app (the PDF in Preview, etc.). Best-effort and
 * non-blocking: detaches the child and never rejects, so a missing opener can't
 * break the run. Returns true if an opener was launched.
 */
export function openFile(path: string): boolean {
  const cmd =
    platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [path], {
      stdio: "ignore",
      detached: true,
      shell: platform() === "win32",
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function pickResumeFile(): Promise<string | null> {
  if (platform() !== "darwin") return null;
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", APPLESCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      // Cancel → osascript exits non-zero ("User canceled. (-128)").
      if (code !== 0) return resolve(null);
      const path = out.trim();
      resolve(path.length ? path : null);
    });
  });
}
