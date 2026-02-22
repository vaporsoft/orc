import { useState, useEffect } from "react";

const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

/**
 * Tracks whether the terminal window has focus using
 * xterm focus event reporting (CSI ?1004h).
 *
 * When the terminal doesn't support focus reporting the hook
 * stays in the default `true` state — no behaviour change.
 */
export function useTerminalFocus(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    const out = process.stdout;
    const stdin = process.stdin;

    // Enable focus reporting
    if (out.isTTY) {
      out.write(ENABLE_FOCUS_REPORTING);
    }

    const onData = (data: Buffer) => {
      const str = data.toString("utf8");

      // Find the last occurrence of either focus sequence
      const lastFocusIn = str.lastIndexOf(FOCUS_IN);
      const lastFocusOut = str.lastIndexOf(FOCUS_OUT);

      // Only update state if we found at least one focus sequence
      if (lastFocusIn !== -1 || lastFocusOut !== -1) {
        // Use whichever sequence appears last in the string
        setFocused(lastFocusIn > lastFocusOut);
      }
    };

    stdin.on("data", onData);

    return () => {
      stdin.off("data", onData);
      if (out.isTTY) {
        out.write(DISABLE_FOCUS_REPORTING);
      }
    };
  }, []);

  return focused;
}
