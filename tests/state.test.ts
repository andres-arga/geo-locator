import { describe, expect, it } from "vitest";
import { confirmPiece, countBySet, filterPlaces, newGame, nextRound, pickPlaces, placePiece, totalScore } from "../src/game/state";
import type { Place } from "../src/cities/placeTypes";

// Synthetic places (not real data).
const places: Place[] = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`, name: `P${i}`, category: i < 3 ? "stadium" : "landmark", osm: `way/${i}`,
  centroid: [-58.4 + i * 0.01, -34.6],
  footprint: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } },
  eqDiameterM: 100, facadeBearing: 0, bearingSource: "manual", symmetry: 1,
  modifiers: { size: true, orientation: true },
}));

// Deterministic RNG for reproducible tests.
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe("pickPlaces", () => {
  it("returns N distinct places and leaves the input untouched", () => {
    const before = places.map((p) => p.id);
    const picked = pickPlaces(places, 7, seeded(42));
    expect(picked).toHaveLength(7);
    expect(new Set(picked.map((p) => p.id)).size).toBe(7);
    expect(places.map((p) => p.id)).toEqual(before);
  });
  it("caps at the number of available places", () => {
    expect(pickPlaces(places.slice(0, 3), 7)).toHaveLength(3);
  });
});

describe("game flow", () => {
  const options = { level: "easy" as const, size: false, orientation: false };

  it("goes placing -> adjusting -> result -> next round -> finished", () => {
    let s = newGame(places, options, seeded(1), 2);
    expect(s.phase).toBe("placing");
    expect(confirmPiece(s)).toBe(s); // cannot confirm before dropping

    s = placePiece(s, { center: s.rounds[0].place.centroid });
    expect(s.phase).toBe("adjusting");
    s = placePiece(s, { center: [-58.5, -34.7] }); // moving again keeps adjusting
    s = placePiece(s, { center: s.rounds[0].place.centroid });
    s = confirmPiece(s);
    expect(s.phase).toBe("result");
    expect(s.rounds[0].score!.total).toBe(1000);
    expect(placePiece(s, { center: [0, 0] })).toBe(s); // locked after confirming

    s = nextRound(s);
    expect(s.current).toBe(1);
    expect(s.phase).toBe("placing");
    s = confirmPiece(placePiece(s, { center: s.rounds[1].place.centroid }));
    s = nextRound(s);
    expect(s.phase).toBe("finished");
    expect(totalScore(s)).toBe(2000);
  });
});

describe("place sets", () => {
  it("splits stadiums and landmarks without overlap", () => {
    const stadiums = filterPlaces(places, "stadiums");
    const landmarks = filterPlaces(places, "landmarks");
    expect(stadiums.every((p) => p.category === "stadium")).toBe(true);
    expect(landmarks.some((p) => p.category === "stadium")).toBe(false);
    expect(stadiums.length + landmarks.length).toBe(places.length);
    expect(countBySet(places)).toEqual({ all: 12, stadiums: 3, landmarks: 9 });
  });
  it("a game with fewer places than rounds plays them all once", () => {
    const g = newGame(filterPlaces(places, "stadiums"), { level: "easy", size: false, orientation: false });
    expect(g.rounds).toHaveLength(3);
    expect(new Set(g.rounds.map((r) => r.place.id)).size).toBe(3);
  });
});
