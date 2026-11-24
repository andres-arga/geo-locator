import type { CityConfig } from "./types";

export const caba: CityConfig = {
  id: "caba",
  name: "Buenos Aires (CABA)",
  // Approximate envelope of CABA plus a margin; the real limit comes from OSM (phase 2).
  bbox: [-58.56, -34.72, -58.32, -34.51],
  center: [-58.44, -34.615],
  zoom: 11.6,
  minZoom: 10.5,
  maxZoom: 17.5,
  tiles: "tiles/caba.pmtiles",
  boundary: "data/cities/caba/boundary.geojson",
  majorParks: "data/cities/caba/parks-major.geojson",
  places: "data/cities/caba/places.json",
  hiddenStreetNames: ["Puente de la Mujer"],
};
