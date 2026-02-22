import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectProject } from "../src/utils/project-detector.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orc-detect-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function touch(...files: string[]) {
  for (const f of files) {
    fs.writeFileSync(path.join(tmpDir, f), "");
  }
}

describe("detectProject", () => {
  it("detects yarn from package.json + yarn.lock", () => {
    touch("package.json", "yarn.lock");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("node (yarn)");
    expect(result.setupCommands).toEqual(["yarn install"]);
    expect(result.allowedCommands).toEqual(["yarn *"]);
  });

  it("detects pnpm from package.json + pnpm-lock.yaml", () => {
    touch("package.json", "pnpm-lock.yaml");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("node (pnpm)");
    expect(result.setupCommands).toEqual(["pnpm install"]);
  });

  it("detects npm from package.json alone", () => {
    touch("package.json");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("node (npm)");
    expect(result.allowedCommands).toContain("npx *");
  });

  it("detects rust from Cargo.toml", () => {
    touch("Cargo.toml");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("rust");
    expect(result.setupCommands).toEqual(["cargo build"]);
    expect(result.verifyCommands).toContain("cargo test");
  });

  it("detects go from go.mod", () => {
    touch("go.mod");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("go");
    expect(result.setupCommands).toEqual(["go mod download"]);
  });

  it("detects python from pyproject.toml", () => {
    touch("pyproject.toml");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("python");
    expect(result.allowedCommands).toContain("pytest *");
  });

  it("detects python from requirements.txt", () => {
    touch("requirements.txt");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("python");
  });

  it("detects ruby from Gemfile", () => {
    touch("Gemfile");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("ruby");
    expect(result.setupCommands).toEqual(["bundle install"]);
  });

  it("detects elixir from mix.exs", () => {
    touch("mix.exs");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("elixir");
    expect(result.allowedCommands).toEqual(["mix *"]);
  });

  it("detects gradle from build.gradle", () => {
    touch("build.gradle");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("gradle");
  });

  it("detects gradle from build.gradle.kts", () => {
    touch("build.gradle.kts");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("gradle");
  });

  it("detects maven from pom.xml", () => {
    touch("pom.xml");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("maven");
    expect(result.setupCommands).toEqual(["mvn compile"]);
  });

  it("detects cmake from CMakeLists.txt", () => {
    touch("CMakeLists.txt");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("cmake");
  });

  it("detects make from Makefile", () => {
    touch("Makefile");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("make");
    expect(result.verifyCommands).toEqual(["make test"]);
  });

  it("returns unknown for empty directory", () => {
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("unknown");
    expect(result.setupCommands).toEqual([]);
    expect(result.verifyCommands).toEqual([]);
    expect(result.allowedCommands).toEqual([]);
  });

  it("prefers yarn over npm when both lock files exist", () => {
    touch("package.json", "yarn.lock");
    const result = detectProject(tmpDir);
    expect(result.ecosystem).toBe("node (yarn)");
  });
});
