import { describe, expect, it } from "vitest";
import { destination } from "@turf/turf";
import {
  angularError, maxPointsPerGame, maxPointsPerItem, orientationPoints,
  positionPoints, scorePlacement, sizeError, sizePoints, type GameOptions,
} from "../src/game/scoring";
import type { Place } from "../src/cities/placeTypes";

// Synthetic place (not real data): only the fields scoring reads matter.
const place = (over: Partial<Place> = {}): Place => ({
  id: "test", name: "Test", category: "landmark", osm: "way/1",
  centroid: [-58.4, -34.6],
  footprint: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } },
  eqDiameterM: 100, facadeBearing: 90, bearingSource: "manual", symmetry: 1,
  modifiers: { size: true, orientation: true },
  ...over,
});
const at = (meters: number, bearing = 0) =>
  destination([-58.4, -34.6], meters, bearing, { units: "meters" }).geometry.coordinates as [number, number];
const opts = (o: Partial<GameOptions> = {}): GameOptions => ({ level: "easy", size: false, orientation: false, ...o });

describe("position", () => {
  it("is 1000 at distance 0 and 1000/e at k = 1000 m", () => {
    expect(positionPoints(0)).toBe(1000);
    expect(positionPoints(1000)).toBeCloseTo(367.88, 1);
    expect(positionPoints(10000)).toBeLessThan(1);
  });
  it("uses the real geodesic distance between placement and centroid", () => {
    const r = scorePlacement(place(), { center: at(1000, 37), sizeRatio: 1, bearing: 0 }, opts());
    expect(r.distanceM).toBeCloseTo(1000, 0);
    expect(r.position.points).toBeCloseTo(367.88, 0);
  });
});

describe("size", () => {
  it("full score within ±0.15 log2 and zero beyond 1.5", () => {
    expect(sizePoints(1)).toBe(400);
    expect(sizePoints(2 ** 0.15)).toBe(400);
    expect(sizePoints(2 ** -0.15)).toBe(400);
    expect(sizePoints(2 ** 1.5)).toBe(0);
    expect(sizePoints(1 / 4)).toBe(0);
  });
  it("is symmetric in log space (x2 scores like x0.5) and linear in between", () => {
    expect(sizeError(2)).toBe(1);
    expect(sizePoints(2)).toBeCloseTo(sizePoints(0.5), 9);
    expect(sizePoints(2)).toBeCloseTo((400 * (1.5 - 1)) / (1.5 - 0.15), 6);
  });
  it("treats invalid ratios as zero points", () => {
    expect(sizePoints(0)).toBe(0);
    expect(sizePoints(-1)).toBe(0);
  });
});

describe("orientation", () => {
  it("wraps around north: 350° vs 10° is 20°", () => {
    expect(angularError(350, 10)).toBe(20);
    expect(angularError(10, 350)).toBe(20);
    expect(angularError(0, 180)).toBe(180);
    expect(angularError(720 + 5, -5)).toBe(10);
  });
  it("applies rotational symmetry", () => {
    expect(angularError(0, 92, 4)).toBe(2);
    expect(angularError(0, 135, 4)).toBe(45);
    expect(angularError(10, 190, 2)).toBe(0);
    expect(angularError(0, 100, 2)).toBe(80);
    expect(angularError(0, 123, "radial")).toBe(0);
  });
  it("full score up to 15°, zero from 90°, linear in between", () => {
    expect(orientationPoints(0)).toBe(400);
    expect(orientationPoints(15)).toBe(400);
    expect(orientationPoints(52.5)).toBeCloseTo(200, 6);
    expect(orientationPoints(90)).toBe(0);
    expect(orientationPoints(180)).toBe(0);
  });
});

describe("scorePlacement", () => {
  const perfect = { center: [-58.4, -34.6] as [number, number], sizeRatio: 1, bearing: 90 };

  it("only includes the active components", () => {
    const r = scorePlacement(place(), perfect, opts());
    expect(r.size).toBeUndefined();
    expect(r.orientation).toBeUndefined();
    expect(r.total).toBe(1000);
  });

  it("adds components and applies the map multiplier", () => {
    const r = scorePlacement(place(), perfect, opts({ level: "hard", size: true, orientation: true }));
    expect(r.subtotal).toBe(1800);
    expect(r.total).toBe(3600);
  });

  it("compensates excluded modifiers proportionally to position", () => {
    const tiny = place({ modifiers: { size: false, orientation: false }, symmetry: "radial" });
    const r = scorePlacement(tiny, { center: at(500), sizeRatio: 3, bearing: 0 }, opts({ size: true, orientation: true }));
    const frac = r.position.points / 1000;
    expect(r.size).toMatchObject({ compensated: true });
    expect(r.size!.points).toBeCloseTo(400 * frac, 6);
    expect(r.orientation!.points).toBeCloseTo(400 * frac, 6);
  });

  it("compensates orientation when the facade bearing is unknown", () => {
    const r = scorePlacement(place({ facadeBearing: null }), perfect, opts({ orientation: true }));
    expect(r.orientation).toMatchObject({ compensated: true, points: 400 });
  });

  it("reports size error as a percentage", () => {
    const r = scorePlacement(place(), { ...perfect, sizeRatio: 1.25 }, opts({ size: true }));
    expect(r.size!.errorPct).toBeCloseTo(25, 9);
  });
});

describe("maximums", () => {
  it("per item and per game (7 rounds)", () => {
    expect(maxPointsPerItem(opts())).toBe(1000);
    expect(maxPointsPerItem(opts({ level: "medium", size: true }))).toBe(2100);
    expect(maxPointsPerGame(opts({ level: "hard", size: true, orientation: true }))).toBe(25200);
  });
});

describe("contrarreloj", () => {
  const perfect = { center: [-58.4, -34.6] as [number, number], sizeRatio: 1, bearing: 90 };

  it("adds up to +20 % for leftover time and applies the timer multiplier", () => {
    const o = opts({ timer: "normal" }); // 60 s, ×1.5
    const full = scorePlacement(place(), perfect, o, 60);
    expect(full.timeBonus).toMatchObject({ secondsLeft: 60, seconds: 60 });
    expect(full.timeBonus!.points).toBeCloseTo(200, 6);
    expect(full.total).toBe(1800); // (1000 + 200) × 1.5
    const half = scorePlacement(place(), perfect, o, 30);
    expect(half.total).toBe(1650); // (1000 + 100) × 1.5
    expect(scorePlacement(place(), perfect, o, 0).total).toBe(1500);
  });

  it("clamps the leftover time and ignores it without a clock", () => {
    expect(scorePlacement(place(), perfect, opts({ timer: "hard" }), 999).timeBonus!.secondsLeft).toBe(30);
    expect(scorePlacement(place(), perfect, opts(), 40).timeBonus).toBeUndefined();
    expect(scorePlacement(place(), perfect, opts({ timer: "off" }), 40).total).toBe(1000);
  });

  it("combines map level and timer multipliers in the maximum", () => {
    // hard map ×2, exigente ×2, with the 20 % bonus: 1000 × 1.2 × 4
    expect(maxPointsPerItem(opts({ level: "hard", timer: "hard" }))).toBeCloseTo(4800, 6);
    expect(maxPointsPerItem(opts({ timer: "relaxed", size: true }))).toBeCloseTo(1400 * 1.2 * 1.25, 6);
  });
});
