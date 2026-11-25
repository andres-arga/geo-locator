import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

/**
 * Footprint transforms in a local metric plane (equirectangular approximation
 * around the reference point: error well under 0.1 % at city scale).
 */
// Same sphere as turf (earthRadius 6371008.8 m), so local metres agree with the
// distances used for scoring.
const M_PER_DEG_LAT = (6_371_008.8 * Math.PI) / 180;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** [lng, lat] -> metres east/north of `origin`. */
export function toLocal(p: Position, origin: Position): [number, number] {
  return [(p[0] - origin[0]) * mPerDegLon(origin[1]), (p[1] - origin[1]) * M_PER_DEG_LAT];
}

/** Metres east/north of `origin` -> [lng, lat]. */
export function fromLocal([x, y]: [number, number], origin: Position): [number, number] {
  return [origin[0] + x / mPerDegLon(origin[1]), origin[1] + y / M_PER_DEG_LAT];
}

/**
 * Copy of `footprint` moved from `from` to `to`, scaled by `scale` and rotated
 * `rotationDeg` clockwise (compass sense) around its reference point.
 */
export function transformFootprint<G extends Polygon | MultiPolygon>(
  footprint: Feature<G>,
  from: Position,
  to: Position,
  scale: number,
  rotationDeg: number,
): Feature<G> {
  const t = (-rotationDeg * Math.PI) / 180; // clockwise on screen = negative math angle
  const c = Math.cos(t), s = Math.sin(t);
  const map = (p: Position): Position => {
    const [x, y] = toLocal(p, from);
    const xs = x * scale, ys = y * scale;
    return fromLocal([xs * c - ys * s, xs * s + ys * c], to);
  };
  const g = footprint.geometry;
  const coordinates =
    g.type === "Polygon"
      ? g.coordinates.map((ring) => ring.map(map))
      : g.coordinates.map((poly) => poly.map((ring) => ring.map(map)));
  return { ...footprint, geometry: { ...g, coordinates } as G };
}

/** Every vertex of a (Multi)Polygon, flattened. */
export function vertices(f: Feature<Polygon | MultiPolygon>): Position[] {
  const g = f.geometry;
  return g.type === "Polygon" ? g.coordinates.flat() : g.coordinates.flat(2);
}
