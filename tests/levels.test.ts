import { describe, expect, it } from "vitest";
import { isLayerVisible } from "../src/map/levels";
import { buildStyle } from "../src/map/style";
import { caba } from "../src/cities/caba";

const style = buildStyle(caba, "http://localhost/");
const visibleIds = (level: "easy" | "medium" | "hard", streetNames = false) =>
  style.layers.filter((l) => isLayerVisible(l.metadata, { level, streetNames })).map((l) => l.id);

describe("map levels", () => {
  it("hard blanks the whole city with a mask drawn above every map layer", () => {
    const ids = visibleIds("hard");
    // Outskirts keep context...
    expect(ids).toEqual(expect.arrayContaining(["earth", "water", "roads-highway", "roads-major", "rail"]));
    // ...but nothing of the street detail, and no labels.
    expect(ids).not.toContain("roads-minor");
    expect(ids).not.toContain("roads-secondary");
    expect(ids).not.toContain("street-names");
    // The mask sits above all the base layers and right below the city outline.
    const all = style.layers.map((l) => l.id);
    const mask = all.indexOf("city-mask");
    expect(mask).toBeGreaterThan(-1);
    for (const id of ids.filter((x) => x !== "city-mask" && x !== "city-boundary")) {
      expect(all.indexOf(id)).toBeLessThan(mask);
    }
    expect(all.indexOf("city-boundary")).toBe(mask + 1);
  });

  it("the city mask is only used in hard", () => {
    expect(visibleIds("easy", true)).not.toContain("city-mask");
    expect(visibleIds("medium")).not.toContain("city-mask");
  });

  it("medium shows main roads, water, big parks and outline, without labels or minor streets", () => {
    const ids = visibleIds("medium", true);
    expect(ids).toEqual(expect.arrayContaining(["roads-major", "roads-highway", "water", "major-parks", "city-boundary"]));
    expect(ids).not.toContain("roads-minor");
    expect(ids).not.toContain("rail");
    expect(ids).not.toContain("roads-secondary");
    expect(ids).not.toContain("street-names");
  });

  it("easy shows everything; street names depend on the toggle", () => {
    expect(visibleIds("easy")).toEqual(expect.arrayContaining(["roads-minor", "roads-secondary", "rail", "landuse-green"]));
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

describe("hard level reference roads (per city)", () => {
  it("CABA keeps the city completely blank", () => {
    expect(style.layers.map((l) => l.id)).not.toContain("hard-roads");
  });
  it("Córdoba draws Circunvalación and the entry routes above the blank city", async () => {
    const { cordoba } = await import("../src/cities/cordoba");
    const s = buildStyle(cordoba, "http://localhost/");
    const ids = s.layers.map((l) => l.id);
    const visible = s.layers.filter((l) => isLayerVisible(l.metadata, { level: "hard", streetNames: false })).map((l) => l.id);
    expect(visible).toContain("hard-roads");
    expect(ids.indexOf("hard-roads")).toBeGreaterThan(ids.indexOf("city-mask"));
    expect(isLayerVisible(s.layers[ids.indexOf("hard-roads")].metadata, { level: "easy", streetNames: true })).toBe(false);
  });
});
