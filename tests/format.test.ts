import { describe, expect, it } from "vitest";
import { formatBearing, formatDistance } from "../src/ui/format";

describe("formatBearing", () => {
  it("uses the 8-point Spanish compass and wraps around", () => {
    expect(formatBearing(0)).toBe("N · 0°");
    expect(formatBearing(47)).toBe("NE · 47°");
    expect(formatBearing(90)).toBe("E · 90°");
    expect(formatBearing(225)).toBe("SO · 225°");
    expect(formatBearing(270)).toBe("O · 270°");
    expect(formatBearing(337.6)).toBe("N · 338°");
    expect(formatBearing(359.7)).toBe("N · 0°");
    expect(formatBearing(-10)).toBe("N · 350°");
  });
});

describe("formatDistance", () => {
  it("switches to km from 1000 m", () => {
    expect(formatDistance(320)).toBe("320 m");
    expect(formatDistance(1234)).toBe("1,2 km");
  });
});
