/**
 * Collects PREvents and waits for activity to settle before emitting.
 *
 * When new events arrive, the debounce timer resets. Once the timer
 * expires without new events, all collected events are flushed.
 */

import type { PREvent } from "../types/index.js";
import { logger } from "../utils/logger.js";

export class EventDebouncer {
  private debounceMs: number;
  private pending: PREvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolveFlush: ((events: PREvent[]) => void) | null = null;
  private branch: string;

  constructor(debounceMs: number, branch: string) {
    this.debounceMs = debounceMs;
    this.branch = branch;
  }

  /**
   * Add new events and reset the debounce timer.
   * If there's no active wait, events just accumulate.
   */
  add(events: PREvent[]): void {
    if (events.length === 0) return;

    this.pending.push(...events);
    logger.debug(
      `Debouncer: ${events.length} new events, ${this.pending.length} pending total`,
      this.branch,
    );

    // Reset the timer if we're in a debounce cycle
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.resolveFlush) {
      this.startTimer();
    }
  }

  /**
   * Wait for the debounce window to expire after events have been
   * added. Returns immediately if events are already pending and no
   * timer is running.
   *
   * Returns the collected events, clearing the buffer.
   */
  waitForFlush(): Promise<PREvent[]> {
    if (this.pending.length > 0 && !this.timer) {
      // Events already queued, start debounce
      return new Promise((resolve) => {
        this.resolveFlush = resolve;
        this.startTimer();
      });
    }

    if (this.pending.length > 0 && this.timer) {
      // Timer already running, just wait for it
      return new Promise((resolve) => {
        this.resolveFlush = resolve;
      });
    }

    // No events yet — caller should poll first
    return new Promise((resolve) => {
      this.resolveFlush = resolve;
    });
  }

  /** Check if there are pending events without waiting. */
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Cancel any active debounce. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.resolveFlush = null;
    this.pending = [];
  }

  private startTimer(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const events = [...this.pending];
      this.pending = [];
      logger.info(
        `Debounce expired: flushing ${events.length} events`,
        this.branch,
      );
      if (this.resolveFlush) {
        const resolve = this.resolveFlush;
        this.resolveFlush = null;
        resolve(events);
      }
    }, this.debounceMs);
  }
}
