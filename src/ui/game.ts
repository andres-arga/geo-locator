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
import { enableDrag } from "./dnd";
import { esc, formatDistance, formatPoints } from "./format";

/**
 * One game: the panel (pieces, buttons, feedback) and the map interactions.
 * Base mode (phase 3): location only, the piece is a draggable pin.
 */
export class GameController {
  private state: GameState;
  private pin: PiecePin | null = null;
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
    this.render();
  }

  destroy() {
    this.disposeDrag?.();
    this.pin?.remove();
    clearResult(this.map);
    this.panel.innerHTML = "";
  }

  // ------------------------------------------------------------- actions

  private drop(center: [number, number]) {
    this.state = placePiece(this.state, { center });
    const { place } = currentRound(this.state);
    this.pin?.remove();
    this.pin = new PiecePin(this.map, modelUrl(place.id), place.name, center, (c) => {
      this.state = placePiece(this.state, { center: c });
    });
    this.render();
  }

  private dropAtCenter() {
    const c = this.map.getCenter();
    this.drop([c.lng, c.lat]);
  }

  private confirm() {
    this.state = confirmPiece(this.state);
    const round = currentRound(this.state);
    this.pin?.setLocked(true);
    const placed = round.placement!.center;
    showResult(this.map, round.place, placed);
    const [w, s, e, n] = bounds([placed, round.place.centroid]);
    this.map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 16.5, duration: 900 });
    this.render();
  }

  private next() {
    this.state = nextRound(this.state);
    this.pin?.remove();
    this.pin = null;
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
        <p class="hint">Podés mover el marcador en el mapa hasta confirmar.</p>
        <button class="btn primary" data-action="confirm">Confirmar</button>`;
    }
    // result
    const last = s.current === s.rounds.length - 1;
    return `${card}
      <dl class="result">
        <dt>Distancia</dt><dd>${formatDistance(score!.distanceM)}</dd>
        <dt>Posición</dt><dd>${formatPoints(score!.position.points)} / ${formatPoints(score!.position.max)}</dd>
        <dt>Total ronda</dt><dd><strong>${formatPoints(score!.total)}</strong></dd>
      </dl>
      <p class="legend"><span class="sw real"></span> ubicación real · <span class="sw err"></span> distancia</p>
      <button class="btn primary" data-action="next">${last ? "Ver resultado final" : "Siguiente lugar"}</button>`;
  }

  private bind() {
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

function bounds(points: [number, number][]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
