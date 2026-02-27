import { execFile } from "node:child_process";
import { logger } from "./logger.js";

export function openInBrowser(url: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    execFile("open", [url], (err) => {
      if (err) logger.error(`Failed to open URL: ${err.message}`);
    });
  } else {
    execFile("xdg-open", [url], (err) => {
      if (err) logger.error(`Failed to open URL: ${err.message}`);
    });
  }
}
