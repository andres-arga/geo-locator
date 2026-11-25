import { MAP_LEVELS, ROUNDS_PER_GAME, type MapLevel } from "../config/game";
import { maxPointsPerGame, type GameOptions } from "../game/scoring";
import { formatPoints } from "./format";

/** Everything the menu controls. Street names only matter on the easy level. */
export interface Settings extends GameOptions {
  streetNames: boolean;
}

export function sameSettings(a: Settings, b: Settings): boolean {
  return a.level === b.level && a.size === b.size && a.orientation === b.orientation && a.streetNames === b.streetNames;
}

export interface MenuOptions {
  current: () => Settings;
  /** Called only after the player confirms "Aplicar y reiniciar juego". */
  onApply: (s: Settings) => void;
  /** Modifiers not implemented yet are shown disabled. */
  orientationAvailable: boolean;
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

  const render = () => {
    const changed = !sameSettings(draft, o.current());
    const levels = (Object.entries(MAP_LEVELS) as [MapLevel, { label: string; multiplier: number }][])
      .map(([id, l]) => `<label class="choice"><input type="radio" name="level" value="${id}" ${draft.level === id ? "checked" : ""}>
          <span><strong>${l.label}</strong> <span class="muted">×${l.multiplier}</span><br><span class="muted">${LEVEL_HELP[id]}</span></span></label>`)
      .join("");
    dlg.innerHTML = `
      <form method="dialog" class="menu-form">
        <header class="menu-head"><h2 id="menu-title">Opciones de partida</h2>
          <button class="icon-btn" value="close" aria-label="Cerrar">✕</button></header>
        <fieldset><legend>Dificultad del mapa</legend>${levels}
          <label class="toggle ${draft.level !== "easy" ? "disabled" : ""}"><input type="checkbox" name="streetNames" ${draft.streetNames ? "checked" : ""} ${draft.level !== "easy" ? "disabled" : ""}>
            Mostrar nombres de calles <span class="muted">(solo en Fácil)</span></label>
        </fieldset>
        <fieldset><legend>Modificadores</legend>
          <label class="toggle"><input type="checkbox" name="size" ${draft.size ? "checked" : ""}> Acertar tamaño <span class="muted">+400 pts por lugar</span></label>
          <label class="toggle ${o.orientationAvailable ? "" : "disabled"}"><input type="checkbox" name="orientation" ${draft.orientation ? "checked" : ""} ${o.orientationAvailable ? "" : "disabled"}>
            Acertar orientación <span class="muted">${o.orientationAvailable ? "+400 pts por lugar" : "(próximamente)"}</span></label>
        </fieldset>
        <p class="menu-max">Puntaje máximo: <strong>${formatPoints(maxPointsPerGame(draft))}</strong> pts
          <span class="muted">(${ROUNDS_PER_GAME} lugares)</span></p>
        <footer class="menu-actions">
          ${changed
            ? `<p class="menu-warn">Aplicar los cambios reinicia la partida actual.</p>
               <button class="btn" value="close">Cancelar</button>
               <button class="btn primary" value="apply">Aplicar y reiniciar juego</button>`
            : `<button class="btn" value="close">Cerrar</button>`}
        </footer>
      </form>`;

    dlg.querySelectorAll<HTMLInputElement>("input").forEach((input) =>
      input.addEventListener("change", () => {
        if (input.name === "level") draft = { ...draft, level: input.value as MapLevel };
        else draft = { ...draft, [input.name]: input.checked };
        render();
        dlg.querySelector<HTMLInputElement>(`input[name="${input.name}"]${input.type === "radio" ? `[value="${input.value}"]` : ""}`)?.focus();
      }),
    );
  };

  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "apply" && !sameSettings(draft, o.current())) o.onApply({ ...draft });
  });
  // Click on the backdrop closes without applying.
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close("close");
  });

  return {
    open() {
      draft = o.current();
      dlg.returnValue = "";
      render();
      dlg.showModal();
    },
  };
}

const LEVEL_HELP: Record<MapLevel, string> = {
  easy: "Mapa completo: calles, verdes, río y vías.",
  medium: "Solo avenidas, autopistas, parques grandes y el río.",
  hard: "La ciudad en blanco: solo el contorno.",
};
