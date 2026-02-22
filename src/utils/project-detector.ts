/**
 * Detects the project ecosystem from marker files and returns
 * sensible defaults for ORC.md sections (setup, verify, allowed commands).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface DetectedProject {
  ecosystem: string;
  setupCommands: string[];
  verifyCommands: string[];
  allowedCommands: string[];
}

export function detectProject(cwd: string): DetectedProject {
  const has = (file: string) => fs.existsSync(path.join(cwd, file));

  // Node.js — check lock files first for specificity
  if (has("package.json") && has("yarn.lock")) {
    return {
      ecosystem: "node (yarn)",
      setupCommands: ["yarn install"],
      verifyCommands: ["yarn lint", "yarn typecheck", "yarn test"],
      allowedCommands: ["yarn *"],
    };
  }
  if (has("package.json") && has("pnpm-lock.yaml")) {
    return {
      ecosystem: "node (pnpm)",
      setupCommands: ["pnpm install"],
      verifyCommands: ["pnpm lint", "pnpm typecheck", "pnpm test"],
      allowedCommands: ["pnpm *"],
    };
  }
  if (has("package.json")) {
    return {
      ecosystem: "node (npm)",
      setupCommands: ["npm install"],
      verifyCommands: ["npm run lint", "npm run typecheck", "npm test"],
      allowedCommands: ["npm *", "npx *"],
    };
  }

  // Rust
  if (has("Cargo.toml")) {
    return {
      ecosystem: "rust",
      setupCommands: ["cargo build"],
      verifyCommands: ["cargo clippy -- -D warnings", "cargo test"],
      allowedCommands: ["cargo *"],
    };
  }

  // Go
  if (has("go.mod")) {
    return {
      ecosystem: "go",
      setupCommands: ["go mod download"],
      verifyCommands: ["go vet ./...", "go test ./..."],
      allowedCommands: ["go *"],
    };
  }

  // Python
  if (has("pyproject.toml") || has("requirements.txt")) {
    return {
      ecosystem: "python",
      setupCommands: ["pip install -e .[dev]"],
      verifyCommands: ["ruff check .", "mypy .", "pytest"],
      allowedCommands: ["python *", "pip *", "ruff *", "mypy *", "pytest *"],
    };
  }

  // Ruby
  if (has("Gemfile")) {
    return {
      ecosystem: "ruby",
      setupCommands: ["bundle install"],
      verifyCommands: ["bundle exec rubocop", "bundle exec rspec"],
      allowedCommands: ["bundle *", "ruby *", "rake *"],
    };
  }

  // Elixir
  if (has("mix.exs")) {
    return {
      ecosystem: "elixir",
      setupCommands: ["mix deps.get"],
      verifyCommands: ["mix compile --warnings-as-errors", "mix test"],
      allowedCommands: ["mix *"],
    };
  }

  // JVM — Gradle
  if (has("build.gradle") || has("build.gradle.kts")) {
    return {
      ecosystem: "gradle",
      setupCommands: ["./gradlew build"],
      verifyCommands: ["./gradlew check", "./gradlew test"],
      allowedCommands: ["./gradlew *", "gradle *"],
    };
  }

  // JVM — Maven
  if (has("pom.xml")) {
    return {
      ecosystem: "maven",
      setupCommands: ["mvn compile"],
      verifyCommands: ["mvn verify"],
      allowedCommands: ["mvn *"],
    };
  }

  // CMake
  if (has("CMakeLists.txt")) {
    return {
      ecosystem: "cmake",
      setupCommands: ["cmake -B build", "cmake --build build"],
      verifyCommands: ["cmake --build build --target test"],
      allowedCommands: ["cmake *", "make *"],
    };
  }

  // Makefile (generic)
  if (has("Makefile")) {
    return {
      ecosystem: "make",
      setupCommands: ["make"],
      verifyCommands: ["make test"],
      allowedCommands: ["make *"],
    };
  }

  // Unknown
  return {
    ecosystem: "unknown",
    setupCommands: [],
    verifyCommands: [],
    allowedCommands: [],
  };
}
