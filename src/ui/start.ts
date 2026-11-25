import { mountSettingsForm, type Settings } from "./menu";

export interface StartScreen {
  show: (current: Settings) => void;
  hide: () => void;
  /** Enable "Empezar" once the map and the data are loaded. */
  setReady: (ready: boolean) => void;
}

/** Welcome screen over the (blurred) map: what the game is, first options, start. */
export function createStartScreen(parent: HTMLElement, cityName: string, onStart: (s: Settings) => void): StartScreen {
  const el = document.createElement("div");
  el.className = "start";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "start-title");
  parent.appendChild(el);
  let draft: Settings;
  let ready = false;

  const button = () => el.querySelector<HTMLButtonElement>("[data-start]")!;

  return {
    show(current) {
      draft = { ...current };
      el.innerHTML = `
        <div class="start-card">
          <header class="start-head">
            <h1 id="start-title">Geo Locator</h1>
            <p class="start-city">${cityName}</p>
          </header>
          <ul class="start-how">
            <li><span aria-hidden="true">📍</span><span>Arrastrá cada lugar icónico al mapa, donde creas que está.</span></li>
            <li><span aria-hidden="true">📐</span><span>Si querés más desafío, acertá también su <strong>tamaño</strong> y hacia dónde mira su <strong>fachada</strong>.</span></li>
            <li><span aria-hidden="true">🏆</span><span>Cuanto más cerca, más puntos. Los mapas más vacíos multiplican el puntaje.</span></li>
          </ul>
          <div class="settings"></div>
          <button class="btn primary start-btn" data-start ${ready ? "" : "disabled"}>${ready ? "Empezar" : "Cargando mapa…"}</button>
        </div>`;
      mountSettingsForm(el.querySelector(".settings")!, draft, (s) => (draft = s));
      button().addEventListener("click", () => onStart({ ...draft }));
      el.hidden = false;
      document.body.classList.add("on-start");
      if (ready) button().focus();
    },
    hide() {
      el.hidden = true;
      document.body.classList.remove("on-start");
    },
    setReady(r) {
      ready = r;
      const b = el.querySelector<HTMLButtonElement>("[data-start]");
      if (!b) return;
      b.disabled = !r;
      b.textContent = r ? "Empezar" : "Cargando mapa…";
      if (r && !el.hidden) b.focus();
    },
  };
}
