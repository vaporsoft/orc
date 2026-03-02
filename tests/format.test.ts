import { describe, it, expect } from "vitest";
import { formatCompact } from "../src/utils/format.js";

describe("formatCompact", () => {
  it("returns raw number below 1000", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(42)).toBe("42");
    expect(formatCompact(999)).toBe("999");
  });

  it("uses k suffix at 1000", () => {
    expect(formatCompact(1000)).toBe("1k");
  });

  it("shows one decimal for 1000-9999", () => {
    expect(formatCompact(1200)).toBe("1.2k");
    expect(formatCompact(1050)).toBe("1.1k");
    expect(formatCompact(9999)).toBe("10k");
  });

  it("rounds to integer k for 10000+", () => {
    expect(formatCompact(10000)).toBe("10k");
    expect(formatCompact(15600)).toBe("16k");
    expect(formatCompact(100000)).toBe("100k");
  });
});
