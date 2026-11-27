import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { destination } from "@turf/turf";
import type { Place } from "../cities/placeTypes";

/** DOM for a map pin with the place illustration; the tip is the anchor point. */
export function createPinElement(imgUrl: string | undefined, label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "pin";
  el.setAttribute("aria-label", label);
  el.innerHTML = `<div class="pin-head">${imgUrl ? `<img src="${imgUrl}" alt="" draggable="false">` : ""}</div>`;
  return el;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** Layers that reveal the real place after confirming. Added once, data swapped per round. */
export function addResultLayers(map: MlMap) {
  map.addSource("result", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "result-footprint", type: "fill", source: "result", filter: ["==", ["get", "kind"], "footprint"], paint: { "fill-color": "#1e8a4c", "fill-opacity": 0.45 } });
  map.addLayer({ id: "result-footprint-line", type: "line", source: "result", filter: ["==", ["get", "kind"], "footprint"], paint: { "line-color": "#13693a", "line-width": 2 } });
  map.addLayer({
    id: "result-line", type: "line", source: "result", filter: ["==", ["get", "kind"], "error"],
    layout: { "line-cap": "round" },
    paint: { "line-color": "#c0392b", "line-width": 2.5, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "result-facade", type: "line", source: "result", filter: ["==", ["get", "kind"], "facade"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#13693a", "line-width": 3 },
  });
  map.addLayer({
    id: "result-real", type: "circle", source: "result", filter: ["==", ["get", "kind"], "real"],
    paint: { "circle-radius": 6, "circle-color": "#1e8a4c", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });
}

export function showResult(map: MlMap, place: Place, placed: [number, number] | null, showFacade = false) {
  const facade: Feature[] = [];
  if (showFacade && place.facadeBearing !== null && place.symmetry !== "radial") {
    // Real facade direction as an arrow from the centroid.
    const len = Math.max(40, place.eqDiameterM * 0.8);
    const b = place.facadeBearing;
    const tip = destination(place.centroid, len, b, { units: "meters" }).geometry.coordinates;
    const l = destination(tip, len * 0.25, b + 150, { units: "meters" }).geometry.coordinates;
    const r = destination(tip, len * 0.25, b - 150, { units: "meters" }).geometry.coordinates;
    facade.push({ type: "Feature", properties: { kind: "facade" }, geometry: { type: "LineString", coordinates: [place.centroid, tip, l, tip, r] } });
  }
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      ...facade,
      { ...place.footprint, properties: { kind: "footprint" } },
      ...(placed
        ? [{ type: "Feature" as const, properties: { kind: "error" }, geometry: { type: "LineString" as const, coordinates: [placed, place.centroid] } }]
        : []),
      { type: "Feature", properties: { kind: "real" }, geometry: { type: "Point", coordinates: place.centroid } },
    ],
  };
  (map.getSource("result") as GeoJSONSource).setData(data);
}

export function clearResult(map: MlMap) {
  (map.getSource("result") as GeoJSONSource | undefined)?.setData(EMPTY);
}

// ------------------------------------------------------------------ final review

export interface ReviewItem {
  index: number; // 1-based round number, used as label
  place: Place;
  /** null when the clock ran out before the piece was dropped. */
  placed: [number, number] | null;
  /** Player's silhouette when a modifier was on; null = the base mode pin. */
  playerFootprint: Feature<Polygon | MultiPolygon> | null;
}

/** Review layers: every round at once (or one), numbered. Added once. */
export function addReviewLayers(map: MlMap) {
  map.addSource("review", { type: "geojson", data: EMPTY });
  const kind = (k: string) => ["==", ["get", "kind"], k] as ["==", ["get", string], string];
  map.addLayer({ id: "review-real-fill", type: "fill", source: "review", filter: kind("real-fp"), paint: { "fill-color": "#1e8a4c", "fill-opacity": 0.45 } });
  map.addLayer({ id: "review-real-line", type: "line", source: "review", filter: kind("real-fp"), paint: { "line-color": "#13693a", "line-width": 1.5 } });
  map.addLayer({ id: "review-mine-fill", type: "fill", source: "review", filter: kind("mine-fp"), paint: { "fill-color": "#5b4a8b", "fill-opacity": 0.4 } });
  map.addLayer({ id: "review-mine-line", type: "line", source: "review", filter: kind("mine-fp"), paint: { "line-color": "#3b2d66", "line-width": 1.5 } });
  map.addLayer({
    id: "review-error", type: "line", source: "review", filter: kind("error"),
    layout: { "line-cap": "round" }, paint: { "line-color": "#c0392b", "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "review-mine-pt", type: "circle", source: "review", filter: kind("mine-pt"),
    paint: { "circle-radius": 5, "circle-color": "#5b4a8b", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 },
  });
  map.addLayer({
    id: "review-real-pt", type: "circle", source: "review", filter: kind("real-pt"),
    paint: { "circle-radius": 9, "circle-color": "#1e8a4c", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });
  map.addLayer({
    id: "review-label", type: "symbol", source: "review", filter: kind("real-pt"),
    layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": true },
    paint: { "text-color": "#ffffff" },
  });
}

export function showReview(map: MlMap, items: ReviewItem[]) {
  const features: Feature[] = [];
  for (const it of items) {
    features.push({ ...it.place.footprint, properties: { kind: "real-fp" } });
    if (it.playerFootprint) features.push({ ...it.playerFootprint, properties: { kind: "mine-fp" } });
    if (it.placed) {
      features.push({ type: "Feature", properties: { kind: "error" }, geometry: { type: "LineString", coordinates: [it.placed, it.place.centroid] } });
      features.push({ type: "Feature", properties: { kind: "mine-pt" }, geometry: { type: "Point", coordinates: it.placed } });
    }
    features.push({ type: "Feature", properties: { kind: "real-pt", label: String(it.index) }, geometry: { type: "Point", coordinates: it.place.centroid } });
  }
  (map.getSource("review") as GeoJSONSource).setData({ type: "FeatureCollection", features });
}

export function clearReview(map: MlMap) {
  (map.getSource("review") as GeoJSONSource | undefined)?.setData(EMPTY);
}
