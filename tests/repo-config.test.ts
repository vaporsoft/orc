import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadRepoConfig } from "../src/core/repo-config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orc-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadRepoConfig", () => {
  it("returns defaults when no files exist", async () => {
    const config = await loadRepoConfig(tmpDir);
    expect(config.instructions).toBe("");
    expect(config.setupCommands).toEqual([]);
    expect(config.verifyCommands).toEqual([]);
    expect(config.allowedCommands).toEqual([]);
    expect(config.autoFix.must_fix).toBe(true);
    expect(config.autoFix.nice_to_have).toBe(false);
  });

  it("loads instructions from ORC.md", async () => {
    fs.writeFileSync(path.join(tmpDir, "ORC.md"), "Use strict typing.\nAlways run tests.");
    const config = await loadRepoConfig(tmpDir);
    expect(config.instructions).toBe("Use strict typing.\nAlways run tests.");
  });

  it("trims whitespace from ORC.md", async () => {
    fs.writeFileSync(path.join(tmpDir, "ORC.md"), "\n\n  Hello  \n\n");
    const config = await loadRepoConfig(tmpDir);
    expect(config.instructions).toBe("Hello");
  });

  it("loads structured config from orc.config.json", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "orc.config.json"),
      JSON.stringify({
        setup: ["cargo build"],
        verify: ["cargo test", "cargo clippy"],
        allowedCommands: ["cargo *"],
        autoFix: { nice_to_have: true },
      }),
    );
    const config = await loadRepoConfig(tmpDir);
    expect(config.setupCommands).toEqual(["cargo build"]);
    expect(config.verifyCommands).toEqual(["cargo test", "cargo clippy"]);
    expect(config.allowedCommands).toEqual(["cargo *"]);
    expect(config.autoFix.nice_to_have).toBe(true);
    // Other autoFix fields should still have defaults
    expect(config.autoFix.must_fix).toBe(true);
  });

  it("applies defaults for missing fields in orc.config.json", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "orc.config.json"),
      JSON.stringify({ verify: ["make test"] }),
    );
    const config = await loadRepoConfig(tmpDir);
    expect(config.verifyCommands).toEqual(["make test"]);
    expect(config.setupCommands).toEqual([]);
    expect(config.allowedCommands).toEqual([]);
    expect(config.autoFix.must_fix).toBe(true);
  });

  it("falls back to defaults on invalid JSON", async () => {
    fs.writeFileSync(path.join(tmpDir, "orc.config.json"), "not valid json{{{");
    const config = await loadRepoConfig(tmpDir);
    expect(config.setupCommands).toEqual([]);
    expect(config.autoFix.must_fix).toBe(true);
  });

  it("falls back to defaults on schema violation", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "orc.config.json"),
      JSON.stringify({ setup: 123 }), // should be an array
    );
    const config = await loadRepoConfig(tmpDir);
    expect(config.setupCommands).toEqual([]);
  });

  it("loads both ORC.md and orc.config.json together", async () => {
    fs.writeFileSync(path.join(tmpDir, "ORC.md"), "This is a Rust project.");
    fs.writeFileSync(
      path.join(tmpDir, "orc.config.json"),
      JSON.stringify({
        setup: ["cargo build"],
        verify: ["cargo test"],
        allowedCommands: ["cargo *"],
      }),
    );
    const config = await loadRepoConfig(tmpDir);
    expect(config.instructions).toBe("This is a Rust project.");
    expect(config.setupCommands).toEqual(["cargo build"]);
    expect(config.verifyCommands).toEqual(["cargo test"]);
    expect(config.allowedCommands).toEqual(["cargo *"]);
  });

  it("handles empty orc.config.json object", async () => {
    fs.writeFileSync(path.join(tmpDir, "orc.config.json"), "{}");
    const config = await loadRepoConfig(tmpDir);
    expect(config.setupCommands).toEqual([]);
    expect(config.verifyCommands).toEqual([]);
    expect(config.autoFix.must_fix).toBe(true);
    expect(config.autoFix.should_fix).toBe(true);
    expect(config.autoFix.nice_to_have).toBe(false);
    expect(config.autoFix.verify_and_fix).toBe(true);
    expect(config.autoFix.needs_clarification).toBe(true);
  });
});
