import { describe, it, expect } from "vitest";
import { ConfigSchema, DEFAULT_CONFIG } from "../src/types/config.js";

describe("ConfigSchema", () => {
  it("applies defaults when parsing an empty object", () => {
    const config = ConfigSchema.parse({});
    expect(config.pollInterval).toBe(30);
    expect(config.confidence).toBe(0.75);
    expect(config.model).toBe("sonnet");
    expect(config.dryRun).toBe(false);
    expect(config.theme).toBe("dark");
  });

  it("accepts valid overrides", () => {
    const config = ConfigSchema.parse({
      pollInterval: 60,
      confidence: 0.5,
      theme: "light",
    });
    expect(config.pollInterval).toBe(60);
    expect(config.confidence).toBe(0.5);
    expect(config.theme).toBe("light");
  });

  it("rejects invalid values", () => {
    expect(() => ConfigSchema.parse({ pollInterval: -1 })).toThrow();
    expect(() => ConfigSchema.parse({ confidence: 2 })).toThrow();
    expect(() => ConfigSchema.parse({ theme: "neon" })).toThrow();
  });

  it("exports DEFAULT_CONFIG with all defaults", () => {
    expect(DEFAULT_CONFIG.pollInterval).toBe(30);
    expect(DEFAULT_CONFIG.sessionTimeout).toBe(0);
    expect(DEFAULT_CONFIG.claudeTimeout).toBe(900);
    expect(DEFAULT_CONFIG.verbose).toBe(false);
  });
});
