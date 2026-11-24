export type BBox = [west: number, south: number, east: number, north: number];

export interface CityConfig {
  id: string;
  name: string;
  /** Area covered by the tile extract and the playable map. */
  bbox: BBox;
  /** Initial view. */
  center: [number, number];
  zoom: number;
  minZoom: number;
  maxZoom: number;
  /** Paths relative to the site base URL. */
  tiles: string;
  boundary: string;
  majorParks: string;
  places: string;
  /** Street names never shown on the map because they would give away a place. */
  hiddenStreetNames: string[];
}
