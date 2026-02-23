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

  describe("legacy ORC.md format backwards compatibility", () => {
    it("parses legacy ## Verify section from ORC.md when no orc.config.json exists", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "ORC.md"),
        `# Orc
## Instructions
This is my project.

## Verify
- \`yarn lint\`
- \`yarn test\`
`,
      );
      const config = await loadRepoConfig(tmpDir);
      expect(config.verifyCommands).toEqual(["yarn lint", "yarn test"]);
    });

    it("parses legacy ## Setup section from ORC.md when no orc.config.json exists", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "ORC.md"),
        `# Orc
## Setup
- \`npm install\`
- \`npm run build\`
`,
      );
      const config = await loadRepoConfig(tmpDir);
      expect(config.setupCommands).toEqual(["npm install", "npm run build"]);
    });

    it("parses legacy ## Auto-fix section from ORC.md when no orc.config.json exists", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "ORC.md"),
        `# Orc
## Auto-fix
- must_fix: false
- should_fix: true
- nice_to_have: true
`,
      );
      const config = await loadRepoConfig(tmpDir);
      expect(config.autoFix.must_fix).toBe(false);
      expect(config.autoFix.should_fix).toBe(true);
      expect(config.autoFix.nice_to_have).toBe(true);
    });

    it("parses legacy ## Allowed Commands section from ORC.md when no orc.config.json exists", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "ORC.md"),
        `# Orc
## Allowed Commands
- \`npm *\`
- \`yarn *\`
`,
      );
      const config = await loadRepoConfig(tmpDir);
      expect(config.allowedCommands).toEqual(["npm *", "yarn *"]);
    });

    it("prefers orc.config.json over legacy ORC.md sections when both exist", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "ORC.md"),
        `# Orc
## Verify
- \`yarn lint\`
`,
      );
      fs.writeFileSync(
        path.join(tmpDir, "orc.config.json"),
        JSON.stringify({ verify: ["npm test"] }),
      );
      const config = await loadRepoConfig(tmpDir);
      expect(config.verifyCommands).toEqual(["npm test"]);
    });

    it("ignores legacy sections when empty orc.config.json exists", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "ORC.md"),
        `# Orc
## Verify
- \`yarn lint\`
`,
      );
      fs.writeFileSync(path.join(tmpDir, "orc.config.json"), "{}");
      const config = await loadRepoConfig(tmpDir);
      // orc.config.json exists (even if empty), so we use its defaults, not legacy ORC.md
      expect(config.verifyCommands).toEqual([]);
    });

    it("still returns full ORC.md as instructions when using legacy sections", async () => {
      const orcMdContent = `# Orc
## Instructions
This is my project.

## Verify
- \`yarn lint\`
`;
      fs.writeFileSync(path.join(tmpDir, "ORC.md"), orcMdContent);
      const config = await loadRepoConfig(tmpDir);
      expect(config.instructions).toBe(orcMdContent.trim());
      expect(config.verifyCommands).toEqual(["yarn lint"]);
    });
  });
});
