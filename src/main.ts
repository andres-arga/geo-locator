import "./styles.css";
import { CITIES, DEFAULT_CITY } from "./cities";
import type { PlacesFile } from "./cities/placeTypes";
import { MAP_LEVELS, type MapLevel } from "./config/game";
import type { GameOptions } from "./game/scoring";
import { createMap } from "./map/createMap";
import { applyLevel } from "./map/levels";
import { addResultLayers } from "./map/overlays";
import { GameController } from "./ui/game";

const app = document.getElementById("app")!;
const city = CITIES[DEFAULT_CITY];
const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;

app.innerHTML = `<div class="layout">
  <div class="map-area"><div class="map" id="map"></div><div class="dev-toolbar" id="dev"></div></div>
  <aside class="panel" id="panel" aria-live="polite"></aside>
</div>`;
const mapEl = document.getElementById("map")!;
const panel = document.getElementById("panel")!;
const dev = document.getElementById("dev")!;

const { map, loaded } = createMap(mapEl, city, baseUrl);

// Temporary until the options screen (phase 7): level switcher that restarts the game.
const options: GameOptions = { level: "easy", size: false, orientation: false };
let streetNames = false;
let game: GameController | null = null;
let places: PlacesFile["places"] = [];

function renderDev() {
  dev.innerHTML = "";
  for (const [id, { label }] of Object.entries(MAP_LEVELS) as [MapLevel, { label: string }][]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("aria-pressed", String(options.level === id));
    b.onclick = () => { options.level = id; renderDev(); applyLevel(map, { level: id, streetNames }); start(); };
    dev.appendChild(b);
  }
  const lbl = document.createElement("label");
  lbl.innerHTML = `<input type="checkbox" ${streetNames ? "checked" : ""} ${options.level !== "easy" ? "disabled" : ""}> Nombres`;
  lbl.querySelector("input")!.onchange = (e) => {
    streetNames = (e.target as HTMLInputElement).checked;
    applyLevel(map, { level: options.level, streetNames });
  };
  dev.appendChild(lbl);
}

function start() {
  game?.destroy();
  map.easeTo({ center: city.center, zoom: city.zoom, duration: 0 });
  game = new GameController(map, mapEl, panel, city, places, { ...options });
}

panel.addEventListener("game:restart", start);

(async () => {
  const [data] = await Promise.all([
    fetch(new URL(city.places, baseUrl)).then((r) => r.json() as Promise<PlacesFile>),
    loaded,
  ]);
  places = data.places;
  addResultLayers(map);
  applyLevel(map, { level: options.level, streetNames });
  renderDev();
  start();
})().catch((e) => {
  panel.innerHTML = `<p class="error">No se pudieron cargar los datos: ${(e as Error).message}</p>`;
});

// Exposed for automated checks (Playwright).
(window as unknown as { __map: typeof map }).__map = map;
