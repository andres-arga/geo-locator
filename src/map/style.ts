import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapLevel } from "../config/game";
import type { CityConfig } from "../cities";

/**
 * A single style for every difficulty. Each layer declares in which levels it is
 * visible via metadata["geo:levels"]; levels.ts toggles visibility at runtime.
 *
 * Anti-spoiler rule: no POIs, buildings, place/neighbourhood labels or park names
 * are ever drawn. Land uses that would give a landmark away (stadiums, pitches)
 * are omitted; cemeteries are painted as generic green.
 *
 * Source schema: Protomaps basemap v4 (layers earth, water, landuse, roads, ...).
 */

export const COLORS = {
  paper: "#f7f4ec",
  earth: "#efeadf",
  water: "#a9cde0",
  green: "#cfe3bf",
  minor: "#ffffff",
  minorCasing: "#ddd6c8",
  major: "#fbe3a6",
  majorCasing: "#d8bd7a",
  highway: "#f4b860",
  highwayCasing: "#c98a2e",
  rail: "#8f8a80",
  boundary: "#5b4a8b",
  cityBlank: "#ffffff",
  label: "#5a5448",
};

type GeoMeta = { "geo:levels": MapLevel[]; "geo:streetNames"?: boolean };
type GeoLayer = LayerSpecification & { metadata: GeoMeta };

const ALL: MapLevel[] = ["easy", "medium", "hard"];
const EASY: MapLevel[] = ["easy"];
const EASY_HARD: MapLevel[] = ["easy", "hard"];

// No "grass": stadium pitches are often tagged landuse=grass and would reveal them.
const GREEN_KINDS = [
  "park", "garden", "recreation_ground", "nature_reserve",
  "village_green", "cemetery", "golf_course", "playground", "wood", "forest",
];

// Road classes, matched on the Protomaps `kind_detail` (OSM highway=*) property.
const HIGHWAYS = ["motorway", "motorway_link"];
const AVENUES = ["trunk", "trunk_link", "primary", "primary_link"];
const SECONDARY = ["secondary", "secondary_link", "tertiary", "tertiary_link"];
const MINOR = ["residential", "unclassified", "living_street"];

function meta(levels: MapLevel[], extra: Partial<GeoMeta> = {}): GeoMeta {
  return { "geo:levels": levels, ...extra };
}

export function buildStyle(city: CityConfig, baseUrl: string): StyleSpecification {
  const abs = (p: string) => new URL(p, baseUrl).href;
  const hidden = city.hiddenStreetNames;

  const layers: GeoLayer[] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": COLORS.paper },
      metadata: meta(ALL),
    },
    {
      id: "earth",
      type: "fill",
      source: "osm",
      "source-layer": "earth",
      paint: { "fill-color": COLORS.earth },
      metadata: meta(ALL),
    },
    {
      id: "landuse-green",
      type: "fill",
      source: "osm",
      "source-layer": "landuse",
      filter: ["in", ["get", "kind"], ["literal", GREEN_KINDS]],
      paint: { "fill-color": COLORS.green },
      metadata: meta(EASY_HARD),
    },
    {
      id: "major-parks",
      type: "fill",
      source: "major-parks",
      paint: { "fill-color": COLORS.green },
      metadata: meta(["medium"]),
    },
    {
      id: "water",
      type: "fill",
      source: "osm",
      "source-layer": "water",
      // Areas only, and no fountains/pools (they would mark landmarks such as Floralis).
      filter: [
        "all",
        ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        ["in", ["get", "kind"], ["literal", ["water", "ocean", "lake", "river"]]],
      ],
      paint: { "fill-color": COLORS.water },
      metadata: meta(ALL),
    },
    roadLine("roads-minor-casing", MINOR, COLORS.minorCasing, [[12.5, 0.5], [17, 9]], EASY, 12.5),
    roadLine("roads-minor", MINOR, COLORS.minor, [[12.5, 0.3], [17, 7]], EASY, 12.5),
    {
      id: "rail",
      type: "line",
      source: "osm",
      "source-layer": "roads",
      // Surface railways only: no subway, platforms or dismantled lines.
      filter: ["all", ["==", ["get", "kind"], "rail"], ["==", ["get", "kind_detail"], "rail"]],
      paint: {
        "line-color": COLORS.rail,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 17, 2],
        "line-dasharray": [3, 2],
      },
      metadata: meta(EASY_HARD),
    },
    roadLine("roads-secondary-casing", SECONDARY, COLORS.majorCasing, [[11, 0.6], [17, 12]], EASY),
    roadLine("roads-secondary", SECONDARY, COLORS.major, [[11, 0.4], [17, 9.5]], EASY),
    roadLine("roads-major-casing", AVENUES, COLORS.majorCasing, [[11, 0.9], [17, 15]], ALL),
    roadLine("roads-major", AVENUES, COLORS.major, [[11, 0.6], [17, 12]], ALL),
    roadLine("roads-highway-casing", HIGHWAYS, COLORS.highwayCasing, [[10, 1.2], [17, 17]], ALL),
    roadLine("roads-highway", HIGHWAYS, COLORS.highway, [[10, 0.8], [17, 13]], ALL),
    {
      // Hard level: the outskirts keep land, water, greens, main roads and rail for
      // context, and this mask blanks out the whole city territory above them.
      id: "city-mask",
      type: "fill",
      source: "boundary",
      paint: { "fill-color": COLORS.cityBlank },
      metadata: meta(["hard"]),
    },
    {
      id: "city-boundary",
      type: "line",
      source: "boundary",
      paint: {
        "line-color": COLORS.boundary,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 3.5],
      },
      metadata: meta(ALL),
    },
    {
      id: "street-names",
      type: "symbol",
      source: "osm",
      "source-layer": "roads",
      minzoom: 13.5,
      filter: [
        "all",
        ["in", ["get", "kind"], ["literal", ["highway", "major_road", "minor_road", "other"]]],
        ["has", "name"],
        ["!", ["in", ["get", "name"], ["literal", hidden]]],
      ],
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 17, 13],
        "text-max-angle": 30,
      },
      paint: {
        "text-color": COLORS.label,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
      metadata: meta(EASY, { "geo:streetNames": true }),
    },
  ];

  return {
    version: 8,
    // Built by concatenation: new URL() would percent-encode the {tokens}.
    glyphs: `${abs("fonts/")}{fontstack}/{range}.pbf`,
    sources: {
      osm: {
        type: "vector",
        url: `pmtiles://${abs(city.tiles)}`,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> (ODbL) · <a href="https://protomaps.com" target="_blank">Protomaps</a>',
      },
      boundary: { type: "geojson", data: abs(city.boundary) },
      "major-parks": { type: "geojson", data: abs(city.majorParks) },
    },
    layers,
  };
}

function roadLine(
  id: string,
  details: string[],
  color: string,
  widths: [number, number][],
  levels: MapLevel[],
  minzoom?: number,
): GeoLayer {
  return {
    id,
    type: "line",
    source: "osm",
    "source-layer": "roads",
    ...(minzoom !== undefined ? { minzoom } : {}),
    filter: ["in", ["get", "kind_detail"], ["literal", details]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], ...widths.flat()],
    },
    metadata: meta(levels),
  } as GeoLayer;
}
