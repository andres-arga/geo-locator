import "./styles.css";
import { CITIES, DEFAULT_CITY } from "./cities";
import { MAP_LEVELS, type MapLevel } from "./config/game";
import { createMap } from "./map/createMap";
import { applyLevel, type LevelOptions } from "./map/levels";

// Phase 1 demo: map + temporary level switcher. The game screens arrive in later phases.
const app = document.getElementById("app")!;
const city = CITIES[DEFAULT_CITY];
const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;

const mapEl = document.createElement("div");
mapEl.className = "map";
app.appendChild(mapEl);

const { map, loaded } = createMap(mapEl, city, baseUrl);
const opts: LevelOptions = { level: "easy", streetNames: false };

const toolbar = document.createElement("div");
toolbar.className = "dev-toolbar";
app.appendChild(toolbar);

function renderToolbar() {
  toolbar.innerHTML = "";
  for (const [id, { label }] of Object.entries(MAP_LEVELS) as [MapLevel, { label: string }][]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("aria-pressed", String(opts.level === id));
    b.onclick = () => { opts.level = id; update(); };
    toolbar.appendChild(b);
  }
  const lbl = document.createElement("label");
  lbl.innerHTML = `<input type="checkbox" ${opts.streetNames ? "checked" : ""} ${opts.level !== "easy" ? "disabled" : ""}> Nombres de calles`;
  lbl.querySelector("input")!.onchange = (e) => { opts.streetNames = (e.target as HTMLInputElement).checked; update(); };
  toolbar.appendChild(lbl);
}

function update() {
  renderToolbar();
  applyLevel(map, opts);
}

renderToolbar();
loaded.then(() => applyLevel(map, opts));

// Tell the developer when the generated assets are missing instead of failing silently.
(async () => {
  const missing: string[] = [];
  for (const [path, cmd] of [[city.tiles, "npm run tiles"], [city.boundary, "npm run data"]] as const) {
    const r = await fetch(new URL(path, baseUrl), { method: "HEAD" }).catch(() => null);
    const type = r?.headers.get("content-type") ?? "";
    if (!r?.ok || type.includes("text/html")) missing.push(`${path} (${cmd})`);
  }
  if (missing.length) {
    const n = document.createElement("div");
    n.className = "notice";
    n.textContent = `Faltan datos generados: ${missing.join(", ")}.`;
    app.appendChild(n);
  }
})();

// Exposed for automated checks (Playwright).
(window as unknown as { __map: typeof map }).__map = map;
