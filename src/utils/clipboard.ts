import { execFile } from "node:child_process";
import { logger } from "./logger.js";

export function copyToClipboard(text: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    const child = execFile("pbcopy", [], (err) => {
      if (err) logger.error(`Clipboard copy failed: ${err.message}`);
    });
    child.stdin?.write(text);
    child.stdin?.end();
    return;
  }

  // Linux: try xclip first, fall back to xsel
  const child = execFile("xclip", ["-selection", "clipboard"], (err) => {
    if (err) {
      const fallback = execFile("xsel", ["--clipboard", "--input"], (err2) => {
        if (err2) logger.error(`Clipboard copy failed: ${err2.message}`);
      });
      fallback.stdin?.write(text);
      fallback.stdin?.end();
    }
  });
  child.stdin?.write(text);
  child.stdin?.end();
}
