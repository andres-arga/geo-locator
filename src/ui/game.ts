import type { Map as MlMap } from "maplibre-gl";
import type { CityConfig } from "../cities";
import type { Place } from "../cities/placeTypes";
import { modelUrl } from "../assets/models";
import { MAP_LEVELS } from "../config/game";
import { maxPointsPerGame, type GameOptions } from "../game/scoring";
import {
  confirmPiece, currentRound, newGame, nextRound, placePiece, totalScore, type GameState,
} from "../game/state";
import { clearResult, createPinElement, PiecePin, showResult } from "../map/overlays";
import { MAX_DIAMETER_M, MIN_DIAMETER_M, SilhouettePiece } from "../map/piece";
import { vertices } from "../game/geometry";
import { enableDrag } from "./dnd";
import { esc, formatDistance, formatPoints } from "./format";

/**
 * One game: the panel (pieces, buttons, feedback) and the map interactions.
 * Base mode: location only, the piece is a draggable pin. With the size modifier
 * the piece is the real footprint silhouette, resizable in metres.
 */
export class GameController {
  private state: GameState;
  private pin: PiecePin | null = null;
  private piece: SilhouettePiece | null = null;
  private offKeys: (() => void) | null = null;
  private disposeDrag: (() => void) | null = null;

  constructor(
    private map: MlMap,
    private mapEl: HTMLElement,
    private panel: HTMLElement,
    private city: CityConfig,
    places: Place[],
    options: GameOptions,
  ) {
    this.state = newGame(places, options);
    const keys = (e: KeyboardEvent) => this.key(e);
    document.addEventListener("keydown", keys, true);
    this.offKeys = () => document.removeEventListener("keydown", keys, true);
    this.render();
  }

  private get silhouetteMode() {
    return this.state.options.size || this.state.options.orientation;
  }

  /** The current place can be resized (size modifier on and footprint not excluded). */
  private get resizable() {
    return this.state.options.size && currentRound(this.state).place.modifiers.size;
  }

  destroy() {
    this.disposeDrag?.();
    this.offKeys?.();
    this.removePiece();
    clearResult(this.map);
    this.panel.innerHTML = "";
  }

  // ------------------------------------------------------------- actions

  private removePiece() {
    this.pin?.remove();
    this.piece?.remove();
    this.pin = null;
    this.piece = null;
  }

  private drop(center: [number, number]) {
    const { place } = currentRound(this.state);
    this.removePiece();
    if (!this.silhouetteMode) {
      this.state = placePiece(this.state, { center });
      this.pin = new PiecePin(this.map, modelUrl(place.id), place.name, center, (c) => {
        this.state = placePiece(this.state, { center: c });
      });
    } else {
      // Neutral starting size that does not depend on the real one; excluded places use their real size.
      const sizeRatio = this.resizable ? neutralDiameter() / place.eqDiameterM : 1;
      this.state = placePiece(this.state, { center, sizeRatio, bearing: place.facadeBearing ?? 0 });
      this.piece = new SilhouettePiece({
        map: this.map,
        mapEl: this.mapEl,
        place,
        iconUrl: modelUrl(place.id),
        value: currentRound(this.state).placement!,
        resizable: this.resizable,
        onChange: (v) => {
          this.state = placePiece(this.state, v);
          this.syncSizeControls();
        },
      });
    }
    this.render();
  }

  /** Update slider and label in place (a full re-render would steal the slider's focus). */
  private syncSizeControls() {
    if (!this.piece) return;
    const d = this.piece.diameter();
    const slider = this.panel.querySelector<HTMLInputElement>("[data-size-slider]");
    const label = this.panel.querySelector<HTMLElement>("[data-size-label]");
    if (slider && document.activeElement !== slider) slider.value = String(log2Step(d));
    if (label) label.textContent = formatMeters(d);
  }

  private key(e: KeyboardEvent) {
    if (this.state.phase !== "adjusting" || !this.piece || !this.resizable) return;
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const step = e.key === "+" || e.key === "=" ? 1 : e.key === "-" || e.key === "_" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation(); // keep +/- for the piece instead of the map zoom
    this.piece.setDiameter(this.piece.diameter() * Math.pow(2, step * (e.shiftKey ? 0.02 : 0.08)));
  }

  private dropAtCenter() {
    const c = this.map.getCenter();
    this.drop([c.lng, c.lat]);
  }

  private confirm() {
    this.state = confirmPiece(this.state);
    const round = currentRound(this.state);
    this.pin?.setLocked(true);
    this.piece?.setLocked(true);
    const placed = round.placement!.center;
    showResult(this.map, round.place, placed);
    const pts = [placed, round.place.centroid, ...(vertices(round.place.footprint) as [number, number][])];
    if (this.piece) pts.push(...(vertices(this.piece.footprint()) as [number, number][]));
    const [w, s, e, n] = bounds(pts);
    this.map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 16.5, duration: 900 });
    this.render();
  }

  private next() {
    this.state = nextRound(this.state);
    this.removePiece();
    clearResult(this.map);
    // Back to the neutral city view so the previous answer does not hint the next one.
    this.map.easeTo({ center: this.city.center, zoom: this.city.zoom, duration: 700 });
    this.render();
  }

  // ------------------------------------------------------------- view

  private render() {
    this.disposeDrag?.();
    this.disposeDrag = null;
    const s = this.state;
    const mult = MAP_LEVELS[s.options.level].multiplier;
    const header = `
      <header class="panel-head">
        <div><strong>${s.phase === "finished" ? "Partida terminada" : `Lugar ${s.current + 1} de ${s.rounds.length}`}</strong></div>
        <div class="panel-score">${formatPoints(totalScore(s))} pts <span class="muted">/ máx ${formatPoints(maxPointsPerGame(s.options, s.rounds.length))} (×${mult})</span></div>
      </header>
      <ol class="strip">${s.rounds
        .map((r, i) => {
          const cls = i < s.current || s.phase === "finished" ? "done" : i === s.current ? "current" : "";
          return `<li class="${cls}" title="${i <= s.current || s.phase === "finished" ? esc(r.place.name) : "Próximo lugar"}"><img src="${modelUrl(r.place.id) ?? ""}" alt=""></li>`;
        })
        .join("")}</ol>`;

    this.panel.innerHTML = header + `<section class="panel-body">${this.body()}</section>`;
    this.bind();
  }

  private body(): string {
    const s = this.state;
    if (s.phase === "finished") {
      return `<ol class="summary">${s.rounds
        .map((r) => `<li><span>${esc(r.place.name)}</span><span>${formatDistance(r.score!.distanceM)}</span><strong>${formatPoints(r.score!.total)}</strong></li>`)
        .join("")}</ol>
        <p class="total">Total: <strong>${formatPoints(totalScore(s))}</strong> pts</p>
        <button class="btn primary" data-action="restart">Jugar de nuevo</button>`;
    }

    const { place, score } = currentRound(s);
    const card = `<figure class="card ${s.phase === "placing" ? "draggable" : "placed"}" data-card>
        <img src="${modelUrl(place.id) ?? ""}" alt="" draggable="false">
        <figcaption>${esc(place.name)}</figcaption></figure>`;

    if (s.phase === "placing") {
      return `${card}
        <p class="hint">Arrastrá el lugar al mapa, donde creas que está.</p>
        <button class="btn link" data-action="drop-center">Colocar en el centro del mapa</button>`;
    }
    if (s.phase === "adjusting") {
      return `${card}
        <p class="hint">${this.silhouetteMode ? "Arrastrá la silueta para moverla." : "Podés mover el marcador en el mapa hasta confirmar."}</p>
        ${this.sizeControls()}
        <button class="btn primary" data-action="confirm">Confirmar</button>`;
    }
    // result
    const last = s.current === s.rounds.length - 1;
    return `${card}
      <dl class="result">
        <dt>Distancia</dt><dd>${formatDistance(score!.distanceM)}</dd>
        <dt>Posición</dt><dd>${formatPoints(score!.position.points)} / ${formatPoints(score!.position.max)}</dd>
        ${this.sizeResult()}
        <dt>Total ronda</dt><dd><strong>${formatPoints(score!.total)}</strong></dd>
      </dl>
      <p class="legend"><span class="sw real"></span> ubicación real · ${this.piece ? '<span class="sw mine"></span> tu pieza · ' : ""}<span class="sw err"></span> distancia</p>
      <button class="btn primary" data-action="next">${last ? "Ver resultado final" : "Siguiente lugar"}</button>`;
  }

  private sizeControls(): string {
    if (!this.state.options.size) return "";
    if (!this.resizable) {
      return `<p class="note">Este lugar no puntúa tamaño: su huella es muy chica. Ese componente se calcula con tu puntaje de posición.</p>`;
    }
    const d = this.piece?.diameter() ?? 100;
    return `<div class="size-control">
        <label for="size-slider">Tamaño <span class="muted">(diámetro equivalente)</span>: <strong data-size-label>${formatMeters(d)}</strong></label>
        <input id="size-slider" type="range" data-size-slider min="${log2Step(MIN_DIAMETER_M)}" max="${log2Step(MAX_DIAMETER_M)}" step="0.01" value="${log2Step(d)}">
        <p class="muted">Manijas de las esquinas, teclas + / −, Alt + rueda sobre la pieza o pellizcar en el celular.</p>
      </div>`;
  }

  private sizeResult(): string {
    const { score, placement, place } = currentRound(this.state);
    if (!score?.size) return "";
    if (score.size.compensated) {
      return `<dt>Tamaño</dt><dd>${formatPoints(score.size.points)} / ${formatPoints(score.size.max)} <span class="muted">(compensado)</span></dd>`;
    }
    const pct = score.size.errorPct!;
    const mine = placement!.sizeRatio * place.eqDiameterM;
    return `<dt>Tamaño</dt><dd>${pct >= 0 ? "+" : "−"}${formatPoints(Math.abs(pct))} % · ${formatPoints(score.size.points)} / ${formatPoints(score.size.max)}</dd>
      <dd class="detail">tu Ø ${formatMeters(mine)} · real ${formatMeters(place.eqDiameterM)}</dd>`;
  }

  private bind() {
    const slider = this.panel.querySelector<HTMLInputElement>("[data-size-slider]");
    slider?.addEventListener("input", () => this.piece?.setDiameter(Math.pow(2, Number(slider.value))));

    const on = (action: string, fn: () => void) =>
      this.panel.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.addEventListener("click", fn);
    on("drop-center", () => this.dropAtCenter());
    on("confirm", () => this.confirm());
    on("next", () => this.next());
    // The app shell owns the full place list and decides how to start a new game.
    on("restart", () => this.panel.dispatchEvent(new CustomEvent("game:restart", { bubbles: true })));

    const card = this.panel.querySelector<HTMLElement>("[data-card]");
    if (card && this.state.phase === "placing") {
      const { place } = currentRound(this.state);
      this.disposeDrag = enableDrag({
        source: card,
        target: this.mapEl,
        canStart: () => this.state.phase === "placing",
        createGhost: () => createPinElement(modelUrl(place.id), place.name),
        onDrop: ({ x, y }) => {
          const ll = this.map.unproject([x, y]);
          this.drop([ll.lng, ll.lat]);
        },
      });
    }
  }
}

/** Log-uniform in [80, 220] m: neutral and independent of the real size. */
function neutralDiameter(): number {
  return Math.exp(Math.log(80) + Math.random() * (Math.log(220) - Math.log(80)));
}

/** log2 rounded to the slider step, so values are valid for <input type=range step=0.01>. */
function log2Step(m: number): number {
  return Math.round(Math.log2(m) * 100) / 100;
}

function formatMeters(m: number): string {
  return `${Math.round(m)} m`;
}

function bounds(points: [number, number][]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
