import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { Place } from "../cities/placeTypes";

/** DOM for a map pin with the place illustration; the tip is the anchor point. */
export function createPinElement(imgUrl: string | undefined, label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "pin";
  el.setAttribute("aria-label", label);
  el.innerHTML = `<div class="pin-head">${imgUrl ? `<img src="${imgUrl}" alt="" draggable="false">` : ""}</div>`;
  return el;
}

/** Draggable pin used in the base mode (no size/orientation modifiers). */
export class PiecePin {
  private marker: maplibregl.Marker;

  constructor(map: MlMap, imgUrl: string | undefined, label: string, at: [number, number], onMove: (c: [number, number]) => void) {
    this.marker = new maplibregl.Marker({ element: createPinElement(imgUrl, label), anchor: "bottom", draggable: true })
      .setLngLat(at)
      .addTo(map);
    this.marker.on("dragend", () => {
      const { lng, lat } = this.marker.getLngLat();
      onMove([lng, lat]);
    });
  }

  setLocked(locked: boolean) {
    this.marker.setDraggable(!locked);
    this.marker.getElement().classList.toggle("locked", locked);
  }

  remove() {
    this.marker.remove();
  }
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
    id: "result-real", type: "circle", source: "result", filter: ["==", ["get", "kind"], "real"],
    paint: { "circle-radius": 6, "circle-color": "#1e8a4c", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });
}

export function showResult(map: MlMap, place: Place, placed: [number, number]) {
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      { ...place.footprint, properties: { kind: "footprint" } },
      { type: "Feature", properties: { kind: "error" }, geometry: { type: "LineString", coordinates: [placed, place.centroid] } },
      { type: "Feature", properties: { kind: "real" }, geometry: { type: "Point", coordinates: place.centroid } },
    ],
  };
  (map.getSource("result") as GeoJSONSource).setData(data);
}

export function clearResult(map: MlMap) {
  (map.getSource("result") as GeoJSONSource | undefined)?.setData(EMPTY);
}
