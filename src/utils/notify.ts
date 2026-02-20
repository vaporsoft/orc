import notifier from "node-notifier";

/**
 * Send a desktop notification. Falls back to terminal bell if
 * node-notifier isn't available.
 */
export function notify(title: string, message: string): void {
  try {
    notifier.notify({ title, message, sound: true });
  } catch {
    // Fallback: terminal bell
    process.stderr.write("\x07");
  }
}
