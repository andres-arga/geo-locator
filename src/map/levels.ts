import type { Map as MlMap } from "maplibre-gl";
import type { MapLevel } from "../config/game";

export interface LevelOptions {
  level: MapLevel;
  /** Only meaningful in "easy"; ignored in other levels. */
  streetNames: boolean;
}

/** Pure decision: should a layer with this metadata be visible? (unit-tested) */
export function isLayerVisible(metadata: unknown, opts: LevelOptions): boolean {
  const m = (metadata ?? {}) as { "geo:levels"?: string[]; "geo:streetNames"?: boolean };
  const levels = m["geo:levels"];
  if (!levels) return true; // layers not managed by levels (e.g. game overlays)
  if (!levels.includes(opts.level)) return false;
  if (m["geo:streetNames"] && !opts.streetNames) return false;
  return true;
}

/** Same data source for every level: only layer visibility changes. */
export function applyLevel(map: MlMap, opts: LevelOptions): void {
  for (const layer of map.getStyle().layers) {
    const visible = isLayerVisible(layer.metadata, opts);
    map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
  }
}
