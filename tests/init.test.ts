import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;
let originalCwd: () => string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orc-init-"));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;
});

afterEach(() => {
  process.cwd = originalCwd;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initCommand", () => {
  it("creates ORC.md and orc.config.json for a rust project", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");

    const { initCommand } = await import("../src/commands/init.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await initCommand();
    spy.mockRestore();

    expect(fs.existsSync(path.join(tmpDir, "ORC.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "orc.config.json"))).toBe(true);

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, "orc.config.json"), "utf-8"));
    expect(config.setup).toEqual(["cargo build"]);
    expect(config.verify).toContain("cargo test");
    expect(config.allowedCommands).toEqual(["cargo *"]);
    expect(config.autoFix.must_fix).toBe(true);
  });

  it("creates config for an unknown project with empty arrays", async () => {
    const { initCommand } = await import("../src/commands/init.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await initCommand();
    spy.mockRestore();

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, "orc.config.json"), "utf-8"));
    expect(config.setup).toEqual([]);
    expect(config.verify).toEqual([]);
    expect(config.allowedCommands).toEqual([]);
  });

  it("skips creating ORC.md if it already exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "ORC.md"), "My custom instructions");

    const { initCommand } = await import("../src/commands/init.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await initCommand();
    spy.mockRestore();

    // ORC.md should be untouched
    expect(fs.readFileSync(path.join(tmpDir, "ORC.md"), "utf-8")).toBe("My custom instructions");
    // But config should be created
    expect(fs.existsSync(path.join(tmpDir, "orc.config.json"))).toBe(true);
  });

  it("skips creating orc.config.json if it already exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "orc.config.json"), '{"setup":["custom"]}');

    const { initCommand } = await import("../src/commands/init.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await initCommand();
    spy.mockRestore();

    // Config should be untouched
    const raw = fs.readFileSync(path.join(tmpDir, "orc.config.json"), "utf-8");
    expect(JSON.parse(raw).setup).toEqual(["custom"]);
    // But ORC.md should be created
    expect(fs.existsSync(path.join(tmpDir, "ORC.md"))).toBe(true);
  });

  it("exits when both files already exist", async () => {
    fs.writeFileSync(path.join(tmpDir, "ORC.md"), "existing");
    fs.writeFileSync(path.join(tmpDir, "orc.config.json"), "{}");

    const { initCommand } = await import("../src/commands/init.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);

    await expect(initCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    spy.mockRestore();
    exitSpy.mockRestore();
  });
});
