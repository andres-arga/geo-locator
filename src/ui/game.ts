import type { Map as MlMap } from "maplibre-gl";
import type { CityConfig } from "../cities";
import type { Place } from "../cities/placeTypes";
import { modelUrl } from "../assets/models";
import { MAP_LEVELS } from "../config/game";
import { maxPointsPerGame, type GameOptions } from "../game/scoring";
import {
  confirmPiece, currentRound, newGame, nextRound, placePiece, totalScore, type GameState,
} from "../game/state";
import { clearResult, clearReview, createPinElement, PiecePin, showResult, showReview, type ReviewItem } from "../map/overlays";
import { MAX_DIAMETER_M, MIN_DIAMETER_M, SilhouettePiece } from "../map/piece";
import { transformFootprint, vertices } from "../game/geometry";
import { enableDrag } from "./dnd";
import { esc, formatBearing, formatDistance, formatPoints } from "./format";

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

  /** The current place can be rotated (orientation modifier on and place not excluded). */
  private get rotatable() {
    const { place } = currentRound(this.state);
    return this.state.options.orientation && place.modifiers.orientation && place.facadeBearing !== null;
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
    clearReview(this.map);
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
      // Random starting bearing so the drop does not give the answer away.
      const bearing = this.rotatable ? Math.floor(Math.random() * 360) : (place.facadeBearing ?? 0);
      this.state = placePiece(this.state, { center, sizeRatio, bearing });
      this.piece = new SilhouettePiece({
        map: this.map,
        mapEl: this.mapEl,
        place,
        iconUrl: modelUrl(place.id),
        value: currentRound(this.state).placement!,
        resizable: this.resizable,
        rotatable: this.rotatable,
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
    const b = this.piece.getValue().bearing;
    const rot = this.panel.querySelector<HTMLInputElement>("[data-rot-slider]");
    const rotLabel = this.panel.querySelector<HTMLElement>("[data-rot-label]");
    if (rot && document.activeElement !== rot) rot.value = String(Math.round(b) % 360);
    if (rotLabel) rotLabel.textContent = formatBearing(b);
  }

  private key(e: KeyboardEvent) {
    if (this.state.phase !== "adjusting" || !this.piece) return;
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    const turn = e.code === "KeyQ" ? -1 : e.code === "KeyE" ? 1 : 0;
    if (turn && this.rotatable) {
      e.preventDefault();
      this.piece.setBearing(this.piece.getValue().bearing + turn * (e.shiftKey ? 1 : 5));
      return;
    }
    if (!this.resizable) return;
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
    showResult(this.map, round.place, placed, this.state.options.orientation);
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
    if (this.state.phase === "finished") {
      this.render();
      this.review(null);
      return;
    }
    // Back to the neutral city view so the previous answer does not hint the next one.
    this.map.easeTo({ center: this.city.center, zoom: this.city.zoom, duration: 700 });
    this.render();
  }

  /** Player's silhouette for a finished round (null in the base mode, which uses a point). */
  private playerFootprint(i: number) {
    const { place, placement } = this.state.rounds[i];
    const o = this.state.options;
    if (!placement || !(o.size || o.orientation)) return null;
    const rotation = placement.bearing - (place.facadeBearing ?? placement.bearing);
    return transformFootprint(place.footprint, place.centroid, placement.center, placement.sizeRatio, o.orientation ? rotation : 0);
  }

  /** Final review on the map: every round (index null) or one of them. */
  private review(index: number | null) {
    const items: ReviewItem[] = this.state.rounds
      .map((r, i) => ({ index: i + 1, place: r.place, placed: r.placement!.center, playerFootprint: this.playerFootprint(i) }))
      .filter((_, i) => index === null || i === index);
    showReview(this.map, items);
    const pts = items.flatMap((it) => [
      it.placed,
      ...(vertices(it.place.footprint) as [number, number][]),
      ...(it.playerFootprint ? (vertices(it.playerFootprint) as [number, number][]) : []),
    ]);
    const [w, s, e, n] = bounds(pts);
    this.map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 16.5, duration: 800 });
    this.panel.querySelectorAll<HTMLElement>("[data-review]").forEach((row) =>
      row.classList.toggle("selected", index !== null && Number(row.dataset.review) === index),
    );
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
    if (s.phase === "finished") return this.summary();

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
        ${this.rotationControls()}
        <button class="btn primary" data-action="confirm">Confirmar</button>`;
    }
    // result
    const last = s.current === s.rounds.length - 1;
    const mult = MAP_LEVELS[s.options.level].multiplier;
    return `${card}
      <dl class="result">
        <dt>Distancia</dt><dd>${formatDistance(score!.distanceM)}</dd>
        <dt>Posición</dt><dd>${formatPoints(score!.position.points)} / ${formatPoints(score!.position.max)}</dd>
        ${this.sizeResult()}
        ${this.orientationResult()}
        ${mult === 1 ? "" : `<dt>Multiplicador</dt><dd>${formatPoints(score!.subtotal)} × ${String(mult).replace(".", ",")}</dd>`}
        <dt>Total ronda</dt><dd><strong>${formatPoints(score!.total)}</strong></dd>
      </dl>
      <p class="legend"><span class="sw real"></span> ubicación real · ${this.piece ? '<span class="sw mine"></span> tu pieza · ' : ""}<span class="sw err"></span> distancia</p>
      <button class="btn primary" data-action="next">${last ? "Ver resultado final" : "Siguiente lugar"}</button>`;
  }

  private summary(): string {
    const s = this.state;
    const o = s.options;
    const mult = MAP_LEVELS[o.level].multiplier;
    const pts = (c: { points: number } | undefined) => (c ? formatPoints(c.points) : "");
    const rows = s.rounds
      .map((r, i) => {
        const sc = r.score!;
        const parts = [`<span>${formatDistance(sc.distanceM)}</span>`, `<span title="Posición">Pos ${pts(sc.position)}</span>`];
        if (o.size) parts.push(`<span title="Tamaño">Tam ${pts(sc.size)}${sc.size?.compensated ? "*" : ""}</span>`);
        if (o.orientation) parts.push(`<span title="Orientación">Ori ${pts(sc.orientation)}${sc.orientation?.compensated ? "*" : ""}</span>`);
        return `<li data-review="${i}" tabindex="0" title="Ver en el mapa">
          <div class="row-top"><span class="num">${i + 1}</span><span class="name">${esc(r.place.name)}</span><strong>${formatPoints(sc.total)}</strong></div>
          <div class="row-detail">${parts.join(" · ")}</div></li>`;
      })
      .join("");
    const compensated = s.rounds.some((r) => r.score!.size?.compensated || r.score!.orientation?.compensated);
    return `<p class="total">Total: <strong>${formatPoints(totalScore(s))}</strong> pts
        <span class="muted">de ${formatPoints(maxPointsPerGame(o, s.rounds.length))}${mult === 1 ? "" : ` · incluye ×${String(mult).replace(".", ",")}`}</span></p>
      <ol class="summary-list">${rows}</ol>
      <p class="muted">Tocá un lugar para verlo en el mapa.${compensated ? " * componente compensado con la posición." : ""}</p>
      <p class="legend"><span class="sw real"></span> real · <span class="sw mine"></span> tu ubicación · <span class="sw err"></span> distancia</p>
      <div class="summary-actions">
        <button class="btn" data-action="review-all">Ver todos</button>
        <button class="btn primary" data-action="restart">Jugar de nuevo</button>
      </div>`;
  }

  private sizeControls(): string {
    if (!this.state.options.size) return "";
    if (!this.resizable) {
      return `<p class="note">Este lugar no puntúa tamaño: su huella en el mapa es muy chica o incompleta. Ese componente se calcula con tu puntaje de posición.</p>`;
    }
    const d = this.piece?.diameter() ?? 100;
    return `<div class="size-control">
        <label for="size-slider">Tamaño <span class="muted">(diámetro equivalente)</span>: <strong data-size-label>${formatMeters(d)}</strong></label>
        <input id="size-slider" type="range" data-size-slider min="${log2Step(MIN_DIAMETER_M)}" max="${log2Step(MAX_DIAMETER_M)}" step="0.01" value="${log2Step(d)}">
        <p class="muted">Manijas de las esquinas, teclas + / −, Alt + rueda sobre la pieza o pellizcar en el celular.</p>
      </div>`;
  }

  private rotationControls(): string {
    if (!this.state.options.orientation) return "";
    if (!this.rotatable) {
      return `<p class="note">Este lugar no puntúa orientación: tiene simetría radial. Ese componente se calcula con tu puntaje de posición.</p>`;
    }
    const b = this.piece?.getValue().bearing ?? 0;
    return `<div class="size-control">
        <label for="rot-slider">Fachada mirando hacia: <strong data-rot-label>${formatBearing(b)}</strong></label>
        <input id="rot-slider" type="range" data-rot-slider min="0" max="359" step="1" value="${Math.round(b) % 360}">
        <p class="muted">Girá con la manija redonda de la flecha, teclas Q / E (Shift = fino) o dos dedos en el celular.</p>
      </div>`;
  }

  private orientationResult(): string {
    const { score, placement, place } = currentRound(this.state);
    if (!score?.orientation) return "";
    if (score.orientation.compensated) {
      return `<dt>Orientación</dt><dd>${formatPoints(score.orientation.points)} / ${formatPoints(score.orientation.max)} <span class="muted">(compensado)</span></dd>`;
    }
    const sym = place.symmetry === 2 || place.symmetry === 4 ? ` · simetría ${place.symmetry}` : "";
    return `<dt>Orientación</dt><dd>error ${Math.round(score.orientation.errorDeg!)}° · ${formatPoints(score.orientation.points)} / ${formatPoints(score.orientation.max)}</dd>
      <dd class="detail">tu fachada ${formatBearing(placement!.bearing)} · real ${formatBearing(place.facadeBearing!)}${sym}</dd>`;
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
    const rot = this.panel.querySelector<HTMLInputElement>("[data-rot-slider]");
    rot?.addEventListener("input", () => this.piece?.setBearing(Number(rot.value)));

    const on = (action: string, fn: () => void) =>
      this.panel.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.addEventListener("click", fn);
    on("drop-center", () => this.dropAtCenter());
    on("confirm", () => this.confirm());
    on("next", () => this.next());
    on("review-all", () => this.review(null));
    this.panel.querySelectorAll<HTMLElement>("[data-review]").forEach((row) => {
      const go = () => this.review(Number(row.dataset.review));
      row.addEventListener("click", go);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
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
