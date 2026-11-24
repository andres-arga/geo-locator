/**
 * Data review page (/debug.html): footprints, centroids and facade arrows of every
 * place on top of the easy-level map, so calculated/manual bearings can be checked.
 * Green arrow = calculated from entrance=main, orange = manual, none = missing.
 */
import "./styles.css";
import { destination } from "@turf/turf";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { CITIES, DEFAULT_CITY } from "./cities";
import type { PlacesFile } from "./cities/placeTypes";
import { createMap } from "./map/createMap";
import { applyLevel } from "./map/levels";

const city = CITIES[DEFAULT_CITY];
const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;
const app = document.getElementById("app")!;
app.innerHTML = `<div class="debug"><aside class="debug-list"><h1>Datos: ${city.name}</h1><p class="debug-legend">
  <span class="sw calc"></span> rumbo calculado · <span class="sw manual"></span> manual · ✘ = excluido del modificador</p>
  <ol id="list"></ol></aside><div class="debug-map"><div class="map" id="map"></div></div></div>`;

const { map, loaded } = createMap(document.getElementById("map")!, city, baseUrl);

(async () => {
  const data: PlacesFile = await (await fetch(new URL(city.places, baseUrl))).json();
  await loaded;
  applyLevel(map, { level: "easy", streetNames: true });

  const footprints: FeatureCollection = {
    type: "FeatureCollection",
    features: data.places.map((p) => ({ ...p.footprint, properties: { id: p.id } })),
  };
  const centroids: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: data.places.map((p) => ({
      type: "Feature", properties: { id: p.id, label: p.name },
      geometry: { type: "Point", coordinates: p.centroid },
    })),
  };
  const arrows: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features: data.places
      .filter((p) => p.facadeBearing !== null)
      .map((p): Feature<LineString> => {
        const len = Math.max(40, p.eqDiameterM * 0.9);
        const tip = destination(p.centroid, len, p.facadeBearing!, { units: "meters" }).geometry.coordinates;
        const l = destination(tip, len * 0.25, p.facadeBearing! + 150, { units: "meters" }).geometry.coordinates;
        const r = destination(tip, len * 0.25, p.facadeBearing! - 150, { units: "meters" }).geometry.coordinates;
        return {
          type: "Feature", properties: { source: p.bearingSource },
          geometry: { type: "LineString", coordinates: [p.centroid, tip, l, tip, r] },
        };
      }),
  };

  map.addSource("dbg-footprints", { type: "geojson", data: footprints });
  map.addSource("dbg-centroids", { type: "geojson", data: centroids });
  map.addSource("dbg-arrows", { type: "geojson", data: arrows });
  map.addLayer({ id: "dbg-fill", type: "fill", source: "dbg-footprints", paint: { "fill-color": "#5b4a8b", "fill-opacity": 0.35 } });
  map.addLayer({ id: "dbg-line", type: "line", source: "dbg-footprints", paint: { "line-color": "#3b2d66", "line-width": 1.5 } });
  map.addLayer({
    id: "dbg-arrows", type: "line", source: "dbg-arrows",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": 3, "line-color": ["match", ["get", "source"], "calculado", "#1e8a4c", "#e07b00"] },
  });
  map.addLayer({ id: "dbg-centroid", type: "circle", source: "dbg-centroids", paint: { "circle-radius": 4, "circle-color": "#c0392b", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
  map.addLayer({
    id: "dbg-label", type: "symbol", source: "dbg-centroids",
    layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top" },
    paint: { "text-color": "#2b2540", "text-halo-color": "#fff", "text-halo-width": 2 },
  });

  const list = document.getElementById("list")!;
  for (const p of data.places) {
    const li = document.createElement("li");
    const bearing = p.facadeBearing === null ? "—" : `${p.facadeBearing.toFixed(0)}°`;
    const src = p.bearingSource ? `<span class="sw ${p.bearingSource === "calculado" ? "calc" : "manual"}"></span>${p.bearingSource}` : "⚠️ falta";
    li.innerHTML = `<button><strong>${p.name}</strong></button>
      <div><a href="https://www.openstreetmap.org/${p.osm}" target="_blank" rel="noopener">${p.osm}</a></div>
      <div>Ø eq. ${p.eqDiameterM.toFixed(1)} m · simetría ${p.symmetry}</div>
      <div>Rumbo ${bearing} ${p.symmetry === "radial" ? "(no aplica)" : src}</div>
      <div>Tamaño ${p.modifiers.size ? "✔" : "✘"} · Orientación ${p.modifiers.orientation ? "✔" : "✘"}</div>`;
    li.querySelector("button")!.onclick = () =>
      map.flyTo({ center: p.centroid, zoom: Math.min(17.5, 19.5 - Math.log2(Math.max(p.eqDiameterM, 20) / 10)) });
    list.appendChild(li);
  }
})();

(window as unknown as { __map: typeof map }).__map = map;
