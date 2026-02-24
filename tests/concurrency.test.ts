import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../src/utils/concurrency.js";

describe("mapWithConcurrency", () => {
  it("processes all items and returns results in order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("handles concurrency=1 (serial execution)", async () => {
    const order: number[] = [];
    const items = [1, 2, 3];
    await mapWithConcurrency(items, 1, async (n) => {
      order.push(n);
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("handles concurrency larger than item count", async () => {
    const items = [1, 2];
    const results = await mapWithConcurrency(items, 10, async (n) => n + 1);
    expect(results).toEqual([2, 3]);
  });

  it("handles empty array", async () => {
    const results = await mapWithConcurrency([], 3, async () => "x");
    expect(results).toEqual([]);
  });

  it("propagates errors and stops processing", async () => {
    const processed: number[] = [];
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    await expect(
      mapWithConcurrency(items, 1, async (n) => {
        if (n === 3) throw new Error("boom");
        processed.push(n);
        return n;
      }),
    ).rejects.toThrow("boom");

    // Should have processed 1 and 2 before the error on 3
    expect(processed).toEqual([1, 2]);
  });

  it("respects concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await mapWithConcurrency(items, 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return n;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
