import type { Feature, MultiPolygon, Polygon } from "geojson";

export type Symmetry = 1 | 2 | 4 | "radial";
export type BearingSource = "calculado" | "manual";

/** One landmark as produced by scripts/fetch-osm.ts (public/data/cities/<city>/places.json). */
export interface Place {
  id: string;
  name: string;
  /** OSM element the data comes from, e.g. "way/123". */
  osm: string;
  /** Center of mass of the footprint, [lng, lat]. */
  centroid: [number, number];
  footprint: Feature<Polygon | MultiPolygon>;
  /** sqrt(footprint area), in metres. */
  eqDiameterM: number;
  /** Direction the main facade faces, degrees clockwise from north; null = unknown. */
  facadeBearing: number | null;
  bearingSource: BearingSource | null;
  symmetry: Symmetry;
  /** Which modifiers can score this place (false = excluded and compensated). */
  modifiers: { size: boolean; orientation: boolean };
}

export interface PlacesFile {
  city: string;
  generatedAt: string;
  places: Place[];
}
