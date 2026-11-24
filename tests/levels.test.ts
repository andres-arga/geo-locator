import { describe, expect, it } from "vitest";
import { isLayerVisible } from "../src/map/levels";
import { buildStyle } from "../src/map/style";
import { caba } from "../src/cities/caba";

const style = buildStyle(caba, "http://localhost/");
const visibleIds = (level: "easy" | "medium" | "hard", streetNames = false) =>
  style.layers.filter((l) => isLayerVisible(l.metadata, { level, streetNames })).map((l) => l.id);

describe("map levels", () => {
  it("hard shows only the background and the city outline", () => {
    expect(visibleIds("hard")).toEqual(["background", "city-boundary"]);
  });

  it("medium shows main roads, water, big parks and outline, without labels or minor streets", () => {
    const ids = visibleIds("medium", true);
    expect(ids).toEqual(expect.arrayContaining(["roads-major", "roads-highway", "water", "major-parks", "city-boundary"]));
    expect(ids).not.toContain("roads-minor");
    expect(ids).not.toContain("rail");
    expect(ids).not.toContain("street-names");
  });

  it("easy shows everything; street names depend on the toggle", () => {
    expect(visibleIds("easy")).toEqual(expect.arrayContaining(["roads-minor", "rail", "landuse-green"]));
    expect(visibleIds("easy")).not.toContain("street-names");
    expect(visibleIds("easy", true)).toContain("street-names");
  });

  it("never includes spoiler layers", () => {
    const sourceLayers = style.layers.map((l) => ("source-layer" in l ? l["source-layer"] : undefined));
    for (const banned of ["pois", "buildings", "places"]) expect(sourceLayers).not.toContain(banned);
  });

  it("layers without level metadata (game overlays) are always visible", () => {
    expect(isLayerVisible(undefined, { level: "hard", streetNames: false })).toBe(true);
  });
});
