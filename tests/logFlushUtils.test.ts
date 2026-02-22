import { describe, it, expect } from "vitest";
import { processBranchLogBatch, processLogBatch } from "../src/tui/hooks/logFlushUtils.js";
import type { LogEntry } from "../src/utils/logger.js";

function makeEntry(branch: string | null, message = "msg"): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: "info",
    branch,
    message,
  };
}

describe("processBranchLogBatch", () => {
  it("returns unchanged map for empty batch", () => {
    const prev = new Map<string, LogEntry[]>();
    const result = processBranchLogBatch(prev, [], 100);
    expect(result.size).toBe(0);
  });

  it("groups entries by branch", () => {
    const batch = [makeEntry("feat-a"), makeEntry("feat-b"), makeEntry("feat-a")];
    const result = processBranchLogBatch(new Map(), batch, 100);
    expect(result.get("feat-a")?.length).toBe(2);
    expect(result.get("feat-b")?.length).toBe(1);
  });

  it("skips entries with no branch", () => {
    const batch = [makeEntry(null), makeEntry("main")];
    const result = processBranchLogBatch(new Map(), batch, 100);
    expect(result.size).toBe(1);
    expect(result.has("main")).toBe(true);
  });

  it("caps entries per branch at maxPerBranch", () => {
    const batch = Array.from({ length: 5 }, (_, i) => makeEntry("br", `msg-${i}`));
    const result = processBranchLogBatch(new Map(), batch, 3);
    expect(result.get("br")?.length).toBe(3);
  });
});

describe("processLogBatch", () => {
  it("appends entries and updates lastTimestamp", () => {
    const prev = { entries: [] as LogEntry[], lastTimestamp: null as string | null };
    const batch = [makeEntry("x", "hello")];
    const result = processLogBatch(prev, batch, 100);
    expect(result.entries.length).toBe(1);
    expect(result.lastTimestamp).toBe(batch[0].timestamp);
  });

  it("caps total entries at maxEntries", () => {
    const existing = Array.from({ length: 8 }, () => makeEntry("x"));
    const batch = Array.from({ length: 5 }, () => makeEntry("x"));
    const prev = { entries: existing, lastTimestamp: null as string | null };
    const result = processLogBatch(prev, batch, 10);
    expect(result.entries.length).toBe(10);
  });

  it("returns previous lastTimestamp when batch is empty", () => {
    const prev = { entries: [] as LogEntry[], lastTimestamp: "2025-01-01T00:00:00Z" };
    const result = processLogBatch(prev, [], 100);
    expect(result.lastTimestamp).toBe("2025-01-01T00:00:00Z");
  });
});
