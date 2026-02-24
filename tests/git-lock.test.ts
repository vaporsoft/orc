import { describe, it, expect } from "vitest";
import { GitLock } from "../src/core/git-lock.js";

describe("GitLock", () => {
  it("serializes concurrent operations", async () => {
    const lock = new GitLock();
    const order: number[] = [];

    const a = lock.run(async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    const b = lock.run(async () => {
      order.push(2);
    });

    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  it("continues after a rejection", async () => {
    const lock = new GitLock();

    await expect(
      lock.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The queue should still work after a failure
    const result = await lock.run(async () => 42);
    expect(result).toBe(42);
  });

  it("preserves ordering after rejections", async () => {
    const lock = new GitLock();
    const order: string[] = [];

    const a = lock.run(async () => {
      order.push("a");
      throw new Error("fail");
    }).catch(() => {});

    const b = lock.run(async () => {
      order.push("b");
    });

    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  it("returns the value from the callback", async () => {
    const lock = new GitLock();
    const result = await lock.run(async () => "hello");
    expect(result).toBe("hello");
  });

  it("handles rapid sequential calls", async () => {
    const lock = new GitLock();
    const results: number[] = [];

    const promises = Array.from({ length: 10 }, (_, i) =>
      lock.run(async () => {
        results.push(i);
        return i;
      }),
    );

    const values = await Promise.all(promises);
    expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
