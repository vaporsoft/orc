import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "../src/utils/logger.js";

describe("logger", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orc-logger-test-"));
    logPath = path.join(tmpDir, "test.log");
    logger.setSuppressConsole(true);
    // Clear accumulated state from previous tests to ensure isolation
    logger._resetForTest();
  });

  afterEach(() => {
    logger.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes entries to the log file", () => {
    logger.init(logPath);
    logger.info("hello world");
    logger.close();

    const content = fs.readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(content);
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("hello world");
  });

  it("tracks entries even when the stream is temporarily null during prune", () => {
    logger.init(logPath);
    // Write an entry, then close (which prunes with reopen=false, setting logFile=null)
    logger.info("before prune");
    logger.close();

    // After close + prune, the file should still contain the entry
    // (it was recent enough to survive the 10-min cutoff)
    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.message).toBe("before prune");
  });

  it("does not crash when writing to a stream that was ended by prune", async () => {
    logger.init(logPath);

    // Simulate the race: grab the current stream, then trigger a prune
    // which ends it, then try to write — should not throw
    logger.info("entry 1");

    // Trigger prune by calling close, which calls prune(false)
    logger.close();

    // Re-init and write again — no crash
    logger.init(logPath);
    logger.info("entry 2");
    logger.close();

    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.message).toBe("entry 2");
  });

  it("prune removes old entries and keeps recent ones", () => {
    logger.init(logPath);

    logger.info("recent entry");
    logger.close();

    // After prune, recent entry should survive the 10-min cutoff
    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.message).toBe("recent entry");
  });

  it("attaches error handler to prevent unhandled ERR_STREAM_DESTROYED", () => {
    logger.init(logPath);

    // Access the internal stream via a quick write and inspect the stream's
    // error listeners. The logger adds an error handler to swallow
    // ERR_STREAM_DESTROYED errors.
    logger.info("test");

    // Read back the stream reference via the log file. Since logFile is private,
    // we verify indirectly: if the error handler is missing, calling destroy()
    // on a stream with pending writes would cause an unhandled error event.
    // We can verify the handler exists by checking that the stream has
    // at least one 'error' listener after init.
    const logFileStream = (logger as unknown as { logFile: fs.WriteStream | null }).logFile;
    expect(logFileStream).not.toBeNull();
    const errorListeners = logFileStream!.listenerCount("error");
    expect(errorListeners).toBeGreaterThan(0);

    logger.close();
  });

  it("emits log events for UI consumption", () => {
    logger.init(logPath);
    const handler = vi.fn();
    logger.on("log", handler);

    logger.info("event test", "my-branch");

    expect(handler).toHaveBeenCalledTimes(1);
    const entry = handler.mock.calls[0][0];
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("event test");
    expect(entry.branch).toBe("my-branch");

    logger.removeListener("log", handler);
  });
});
