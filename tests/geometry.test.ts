import { describe, expect, it } from "vitest";
import { area, centerOfMass, distance } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { fromLocal, toLocal, transformFootprint, vertices } from "../src/game/geometry";

// Synthetic 100 m x 50 m rectangle (long side east-west) centred at `o`.
const o: [number, number] = [-58.4, -34.6];
const rect: Feature<Polygon> = {
  type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[-50, -25], [50, -25], [50, 25], [-50, 25], [-50, -25]].map((p) => fromLocal(p as [number, number], o))] },
};

describe("local plane", () => {
  it("round-trips and matches geodesic distances", () => {
    const p = fromLocal([300, -400], o);
    const [x, y] = toLocal(p, o);
    expect(x).toBeCloseTo(300, 6);
    expect(y).toBeCloseTo(-400, 6);
    expect(distance(o, p, { units: "meters" })).toBeCloseTo(500, -0.5);
  });
});

describe("transformFootprint", () => {
  it("moves without changing area", () => {
    const to = fromLocal([2000, 1000], o);
    const moved = transformFootprint(rect, o, to, 1, 0);
    expect(area(moved)).toBeCloseTo(area(rect), -1);
    const c = centerOfMass(moved).geometry.coordinates;
    expect(distance(c, to, { units: "meters" })).toBeLessThan(0.5);
  });

  it("scales area by scale²", () => {
    expect(area(transformFootprint(rect, o, o, 2, 0)) / area(rect)).toBeCloseTo(4, 2);
    expect(area(transformFootprint(rect, o, o, 0.5, 0)) / area(rect)).toBeCloseTo(0.25, 2);
  });

  it("rotates clockwise: 90° turns an east-west rectangle north-south", () => {
    const r = transformFootprint(rect, o, o, 1, 90);
    const local = vertices(r).map((p) => toLocal(p, o));
    const xs = local.map((p) => p[0]);
    const ys = local.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 3);
    // The east end of the rectangle (x = +50) ends up south (y = -50).
    const east = fromLocal([50, 0], o);
    const pt = transformFootprint({ ...rect, geometry: { type: "Polygon", coordinates: [[east, east, east, east]] } }, o, o, 1, 90);
    const [x, y] = toLocal(pt.geometry.coordinates[0][0], o);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(-50, 6);
  });
});
