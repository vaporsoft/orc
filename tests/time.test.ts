import { describe, it, expect } from "vitest";
import { formatTime } from "../src/utils/time.js";

describe("formatTime", () => {
  it("returns HH:MM format for a valid ISO string", () => {
    const result = formatTime("2025-06-15T14:30:00Z");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("handles midnight", () => {
    const result = formatTime("2025-01-01T00:00:00Z");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});
