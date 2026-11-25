import "./styles.css";
import { CITIES, DEFAULT_CITY } from "./cities";
import type { PlacesFile } from "./cities/placeTypes";
import { createMap } from "./map/createMap";
import { applyLevel } from "./map/levels";
import { addResultLayers } from "./map/overlays";
import { GameController } from "./ui/game";
import { createMenu, type Settings } from "./ui/menu";

const app = document.getElementById("app")!;
const city = CITIES[DEFAULT_CITY];
const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;

app.innerHTML = `<div class="layout">
  <div class="map-area"><div class="map" id="map"></div></div>
  <aside class="panel">
    <div class="panel-game" id="game" aria-live="polite"></div>
    <footer class="panel-foot"><button class="btn menu-btn" id="menu-btn" aria-haspopup="dialog">☰ Menú</button></footer>
  </aside>
</div>`;
const mapEl = document.getElementById("map")!;
const gameEl = document.getElementById("game")!;

const { map, loaded } = createMap(mapEl, city, baseUrl);

// Default: the simplest mode (location only, easy map, modifiers off).
let settings: Settings = { level: "easy", size: false, orientation: false, streetNames: false };
let game: GameController | null = null;
let places: PlacesFile["places"] = [];

function start() {
  game?.destroy();
  map.jumpTo({ center: city.center, zoom: city.zoom });
  const { level, size, orientation } = settings;
  game = new GameController(map, mapEl, gameEl, city, places, { level, size, orientation });
}

const menu = createMenu({
  current: () => settings,
  orientationAvailable: false, // phase 5
  onApply: (s) => {
    settings = s;
    applyLevel(map, { level: s.level, streetNames: s.streetNames });
    start();
  },
});
document.getElementById("menu-btn")!.addEventListener("click", () => menu.open());
gameEl.addEventListener("game:restart", start);

(async () => {
  const [data] = await Promise.all([
    fetch(new URL(city.places, baseUrl)).then((r) => r.json() as Promise<PlacesFile>),
    loaded,
  ]);
  places = data.places;
  addResultLayers(map);
  applyLevel(map, { level: settings.level, streetNames: settings.streetNames });
  start();
})().catch((e) => {
  gameEl.innerHTML = `<p class="error">No se pudieron cargar los datos: ${(e as Error).message}</p>`;
});

// Exposed for automated checks (Playwright).
(window as unknown as { __map: typeof map }).__map = map;
