import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { CityConfig } from "../cities";
import { buildStyle } from "./style";
import { createCompass } from "./compass";

let protocolRegistered = false;

export interface CreateMapResult {
  map: MlMap;
  loaded: Promise<void>;
}

export function createMap(container: HTMLElement, city: CityConfig, baseUrl: string): CreateMapResult {
  if (!protocolRegistered) {
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    protocolRegistered = true;
  }

  const [w, s, e, n] = city.bbox;
  const map = new maplibregl.Map({
    container,
    style: buildStyle(city, baseUrl),
    center: city.center,
    zoom: city.zoom,
    minZoom: city.minZoom,
    maxZoom: city.maxZoom,
    maxBounds: [
      [w - 0.05, s - 0.04],
      [e + 0.05, n + 0.04],
    ],
    // North always up: no rotation, no pitch, by any input.
    bearing: 0,
    pitch: 0,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    attributionControl: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-left");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  container.appendChild(createCompass());

  const loaded = new Promise<void>((resolve) => map.once("load", () => resolve()));
  return { map, loaded };
}
