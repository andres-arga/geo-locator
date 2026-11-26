import type { CityConfig } from "./types";

export const cordoba: CityConfig = {
  id: "cordoba",
  name: "Córdoba",
  // Envelope of the municipality (a ~24 km square) plus a margin; keep in sync with
  // scripts/sources/cordoba.places.json. The real limit comes from OSM.
  bbox: [-64.37, -31.57, -64.01, -31.26],
  center: [-64.188, -31.415],
  zoom: 11.4,
  minZoom: 10.3,
  maxZoom: 17.5,
  tiles: "tiles/cordoba.pmtiles",
  boundary: "data/cities/cordoba/boundary.geojson",
  majorParks: "data/cities/cordoba/parks-major.geojson",
  places: "data/cities/cordoba/places.json",
  hiddenStreetNames: [],
  // Hard level: Circunvalación and the motorways/national routes that enter the city.
  hardRoads: ["motorway", "trunk"],
};
