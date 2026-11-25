import { MAP_LEVELS, ROUNDS_PER_GAME, type MapLevel } from "../config/game";
import { maxPointsPerGame, type GameOptions } from "../game/scoring";
import { formatPoints } from "./format";

/** Everything the menu controls. Street names only matter on the easy level. */
export interface Settings extends GameOptions {
  streetNames: boolean;
}

export const DEFAULT_SETTINGS: Settings = { level: "easy", size: false, orientation: false, streetNames: false };

export function sameSettings(a: Settings, b: Settings): boolean {
  return a.level === b.level && a.size === b.size && a.orientation === b.orientation && a.streetNames === b.streetNames;
}

// ------------------------------------------------------------------ storage

const KEY = "geo-locator:settings";

/** Last used settings (per-browser convenience; falls back to defaults). */
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && raw.level in MAP_LEVELS) {
      return { level: raw.level, size: !!raw.size, orientation: !!raw.orientation, streetNames: !!raw.streetNames };
    }
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ form

const LEVEL_HELP: Record<MapLevel, string> = {
  easy: "Mapa completo: calles, verdes, río y vías.",
  medium: "Solo avenidas, autopistas, parques grandes y el río.",
  hard: "La ciudad en blanco: solo el contorno.",
};

/**
 * The options form (level, street names, modifiers, max score). Shared by the
 * start screen and the in-game menu. Calls onChange with every edit.
 */
export function mountSettingsForm(root: HTMLElement, initial: Settings, onChange: (s: Settings) => void) {
  let draft = { ...initial };
  const render = (focusName?: string, focusValue?: string) => {
    const levels = (Object.entries(MAP_LEVELS) as [MapLevel, { label: string; multiplier: number }][])
      .map(([id, l]) => `<label class="choice"><input type="radio" name="level" value="${id}" ${draft.level === id ? "checked" : ""}>
          <span><strong>${l.label}</strong> <span class="muted">×${l.multiplier}</span><br><span class="muted">${LEVEL_HELP[id]}</span></span></label>`)
      .join("");
    root.innerHTML = `
      <fieldset><legend>Dificultad del mapa</legend>${levels}
        <label class="toggle ${draft.level !== "easy" ? "disabled" : ""}"><input type="checkbox" name="streetNames" ${draft.streetNames ? "checked" : ""} ${draft.level !== "easy" ? "disabled" : ""}>
          Mostrar nombres de calles <span class="muted">(solo en Fácil)</span></label>
      </fieldset>
      <fieldset><legend>Modificadores</legend>
        <label class="toggle"><input type="checkbox" name="size" ${draft.size ? "checked" : ""}> Acertar tamaño <span class="muted">+400 pts por lugar</span></label>
        <label class="toggle"><input type="checkbox" name="orientation" ${draft.orientation ? "checked" : ""}> Acertar orientación <span class="muted">+400 pts por lugar</span></label>
      </fieldset>
      <p class="menu-max">Puntaje máximo: <strong>${formatPoints(maxPointsPerGame(draft))}</strong> pts
        <span class="muted">(${ROUNDS_PER_GAME} lugares)</span></p>`;
    root.querySelectorAll<HTMLInputElement>("input").forEach((input) =>
      input.addEventListener("change", () => {
        if (input.name === "level") draft = { ...draft, level: input.value as MapLevel };
        else draft = { ...draft, [input.name]: input.checked };
        render(input.name, input.type === "radio" ? input.value : undefined);
        onChange({ ...draft });
      }),
    );
    if (focusName) {
      root.querySelector<HTMLInputElement>(`input[name="${focusName}"]${focusValue ? `[value="${focusValue}"]` : ""}`)?.focus();
    }
  };
  render();
}

// ------------------------------------------------------------------ in-game menu

export interface MenuOptions {
  current: () => Settings;
  /** Called only after the player confirms "Aplicar y reiniciar juego". */
  onApply: (s: Settings) => void;
  /** "Volver al inicio" link. */
  onHome: () => void;
}

/**
 * Settings menu in a modal <dialog>. Changes are kept as a draft: nothing touches
 * the running game until the player presses "Aplicar y reiniciar juego".
 */
export function createMenu(o: MenuOptions): { open: () => void } {
  const dlg = document.createElement("dialog");
  dlg.className = "menu";
  dlg.setAttribute("aria-labelledby", "menu-title");
  document.body.appendChild(dlg);
  let draft: Settings = o.current();

  const renderActions = () => {
    const changed = !sameSettings(draft, o.current());
    dlg.querySelector(".menu-actions")!.innerHTML = changed
      ? `<p class="menu-warn">Aplicar los cambios reinicia la partida actual.</p>
         <button class="btn" value="close">Cancelar</button>
         <button class="btn primary" value="apply">Aplicar y reiniciar juego</button>`
      : `<button class="btn link home-link" value="home" type="submit">Volver al inicio</button>
         <button class="btn" value="close">Cerrar</button>`;
  };

  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "apply" && !sameSettings(draft, o.current())) o.onApply({ ...draft });
    if (dlg.returnValue === "home") o.onHome();
  });
  // Click on the backdrop closes without applying.
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close("close");
  });

  return {
    open() {
      draft = o.current();
      dlg.returnValue = "";
      dlg.innerHTML = `
        <form method="dialog" class="menu-form">
          <header class="menu-head"><h2 id="menu-title">Opciones de partida</h2>
            <button class="icon-btn" value="close" aria-label="Cerrar">✕</button></header>
          <div class="settings"></div>
          <footer class="menu-actions"></footer>
        </form>`;
      mountSettingsForm(dlg.querySelector(".settings")!, draft, (s) => {
        draft = s;
        renderActions();
      });
      renderActions();
      dlg.showModal();
    },
  };
}
