import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { CITY_LIST } from "../src/cities";
import type { PlacesFile } from "../src/cities/placeTypes";
import { MAX_DIAMETER_M, MIN_DIAMETER_M } from "../src/map/piece";
import { SCORING } from "../src/config/scoring";

// Checks the generated data of every city (skips cities not generated yet).
for (const city of CITY_LIST) {
  const path = `public/${city.places}`;
  describe.skipIf(!existsSync(path))(`data: ${city.id}`, () => {
    const data: PlacesFile = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { city: city.id, generatedAt: "", places: [] };

    it("ids are unique", () => {
      const ids = data.places.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("every resizable place can be matched and overshot with the size controls", () => {
      // Room for the player to go 1.5x over or under the real size.
      for (const p of data.places.filter((p) => p.modifiers.size)) {
        expect(p.eqDiameterM * 1.5, `${p.id} (${p.eqDiameterM} m)`).toBeLessThanOrEqual(MAX_DIAMETER_M);
        expect(p.eqDiameterM / 1.5, `${p.id} (${p.eqDiameterM} m)`).toBeGreaterThanOrEqual(MIN_DIAMETER_M);
        expect(p.eqDiameterM).toBeGreaterThanOrEqual(SCORING.minSizeDiameterM);
      }
    });

    it("places that score orientation have a facade bearing", () => {
      for (const p of data.places.filter((p) => p.modifiers.orientation)) {
        expect(p.facadeBearing, p.id).not.toBeNull();
        expect(p.symmetry, p.id).not.toBe("radial");
      }
    });

    it("centroids lie inside the city bbox", () => {
      const [w, s, e, n] = city.bbox;
      for (const p of data.places) {
        const [x, y] = p.centroid;
        expect(x >= w && x <= e && y >= s && y <= n, p.id).toBe(true);
      }
    });
  });
}
