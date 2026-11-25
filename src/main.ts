import "./styles.css";
import type { Map as MlMap } from "maplibre-gl";
import { CITIES, CITY_LIST, DEFAULT_CITY, type CityConfig } from "./cities";
import type { Place, PlacesFile } from "./cities/placeTypes";
import { createMap } from "./map/createMap";
import { applyLevel } from "./map/levels";
import { addResultLayers, addReviewLayers } from "./map/overlays";
import { GameController } from "./ui/game";
import { createMenu, loadSettings, saveSettings, type PlaceCounts, type Settings } from "./ui/menu";
import { countBySet, filterPlaces } from "./game/state";
import { getBest, recordKey } from "./game/records";
import { createStartScreen } from "./ui/start";

const app = document.getElementById("app")!;
const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;

app.innerHTML = `<div class="layout">
  <div class="map-area" id="map-area"></div>
  <aside class="panel">
    <div class="panel-game" id="game" aria-live="polite"></div>
    <footer class="panel-foot"><button class="btn menu-btn" id="menu-btn" aria-haspopup="dialog">☰ Menú</button></footer>
  </aside>
</div>`;
const mapArea = document.getElementById("map-area")!;
const gameEl = document.getElementById("game")!;

// Last used options (or the simplest mode: location only, easy map, modifiers off).
let settings: Settings = loadSettings();
let game: GameController | null = null;
/** Places of every city, loaded once at startup. */
const placesByCity: Record<string, Place[]> = {};
let counts: PlaceCounts = null;

// ------------------------------------------------------------------ map per city

interface CityMap {
  city: CityConfig;
  map: MlMap;
  el: HTMLElement;
  ready: Promise<void>;
}
let current: CityMap | null = null;

/** The map shows one city; switching city rebuilds it with that city's style and data. */
function showCity(cityId: string): CityMap {
  if (current?.city.id === cityId) return current;
  game?.destroy();
  game = null;
  current?.map.remove();
  mapArea.innerHTML = "";
  const city = CITIES[cityId] ?? CITIES[DEFAULT_CITY];
  const el = document.createElement("div");
  el.className = "map";
  mapArea.appendChild(el);
  const { map, loaded } = createMap(el, city, baseUrl);
  const ready = loaded.then(() => {
    addResultLayers(map);
    addReviewLayers(map);
    applyLevel(map, { level: settings.level, streetNames: settings.streetNames });
  });
  current = { city, map, el, ready };
  // Exposed for automated checks (Playwright).
  (window as unknown as { __map: MlMap }).__map = map;
  return current;
}

async function start() {
  const cm = showCity(settings.city);
  await cm.ready;
  game?.destroy();
  cm.map.jumpTo({ center: cm.city.center, zoom: cm.city.zoom });
  const { level, size, orientation } = settings;
  const places = filterPlaces(placesByCity[cm.city.id] ?? [], settings.placeSet);
  game = new GameController(cm.map, cm.el, gameEl, cm.city, places, { level, size, orientation }, recordKey(cm.city.id, settings));
}

function useSettings(s: Settings) {
  settings = s;
  saveSettings(s);
  if (current?.city.id === s.city) applyLevel(current.map, { level: s.level, streetNames: s.streetNames });
}

const best = (s: Settings) => getBest(recordKey(s.city, s));

const startScreen = createStartScreen(app, (s) => {
  useSettings(s);
  startScreen.hide();
  void start();
}, best, (draft) => {
  // Preview the chosen city behind the welcome card.
  if (counts?.[draft.city]?.all) showCity(draft.city);
});

function goHome() {
  game?.destroy();
  game = null;
  if (current) current.map.jumpTo({ center: current.city.center, zoom: current.city.zoom });
  startScreen.show(settings);
}

const menu = createMenu({
  current: () => settings,
  counts: () => counts,
  best,
  onApply: (s) => {
    useSettings(s);
    void start();
  },
  onHome: goHome,
});
document.getElementById("menu-btn")!.addEventListener("click", () => menu.open());
gameEl.addEventListener("game:restart", () => void start());

// ------------------------------------------------------------------ startup

showCity(settings.city);
startScreen.show(settings);

(async () => {
  // A city whose data is not generated yet simply has no places (shown as "próximamente").
  const files = await Promise.all(
    CITY_LIST.map((c) =>
      fetch(new URL(c.places, baseUrl))
        .then((r) => (r.ok ? (r.json() as Promise<PlacesFile>) : null))
        .catch(() => null),
    ),
  );
  const all: Record<string, ReturnType<typeof countBySet>> = {};
  CITY_LIST.forEach((c, i) => {
    placesByCity[c.id] = files[i]?.places ?? [];
    all[c.id] = countBySet(placesByCity[c.id]);
  });
  counts = all;
  if (!(counts[settings.city]?.all > 0)) {
    // Saved city has no data (yet): fall back to the default one.
    settings = { ...settings, city: DEFAULT_CITY };
    showCity(settings.city);
    startScreen.show(settings);
  }
  await (current as CityMap | null)?.ready; // assigned inside showCity()
  startScreen.setReady(counts);
})().catch((e) => {
  gameEl.innerHTML = `<p class="error">No se pudieron cargar los datos: ${(e as Error).message}</p>`;
});
