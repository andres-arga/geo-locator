import type { Map as MlMap } from "maplibre-gl";
import type { CityConfig } from "../cities";
import type { Place } from "../cities/placeTypes";
import { modelUrl } from "../assets/models";
import { TIMER_MODES } from "../config/game";
import { maxPointsPerGame, totalMultiplier, type GameOptions } from "../game/scoring";
import {
  confirmPiece, currentRound, newGame, nextRound, placePiece, timeOut, totalScore, type GameState,
} from "../game/state";
import { clearResult, clearReview, createPinElement, showResult, showReview, type ReviewItem } from "../map/overlays";
import { MAX_DIAMETER_M, MIN_DIAMETER_M, SilhouettePiece } from "../map/piece";
import { transformFootprint, vertices } from "../game/geometry";
import { enableDrag } from "./dnd";
import { esc, formatBearing, formatDistance, formatPoints } from "./format";
import { recordScore, type BestScore } from "../game/records";

/**
 * One game: the panel (pieces, buttons, feedback) and the map interactions.
 * Base mode: location only, the piece is a draggable pin. With the size modifier
 * the piece is the real footprint silhouette, resizable in metres.
 */
export class GameController {
  private state: GameState;
  private piece: SilhouettePiece | null = null;
  private offKeys: (() => void) | null = null;
  private recordResult: { previous: BestScore | null; isRecord: boolean } | null = null;
  private disposeDrag: (() => void) | null = null;
  /** Contrarreloj state for the current round. */
  private clock: { deadline: number; seconds: number; handle: number; beeped: Set<number> } | null = null;
  private clockEl: HTMLElement | null = null;

  constructor(
    private map: MlMap,
    private mapEl: HTMLElement,
    private panel: HTMLElement,
    private city: CityConfig,
    places: Place[],
    options: GameOptions,
    /** localStorage key for the best score of this options combination. */
    private recordKey?: string,
    /** Number of rounds (defaults to ROUNDS_PER_GAME; a full game passes every place). */
    rounds?: number,
  ) {
    this.state = newGame(places, options, Math.random, rounds);
    const keys = (e: KeyboardEvent) => this.key(e);
    document.addEventListener("keydown", keys, true);
    this.offKeys = () => document.removeEventListener("keydown", keys, true);
    if (this.timerSeconds) {
      this.clockEl = document.createElement("div");
      this.clockEl.className = "clock";
      this.clockEl.setAttribute("role", "timer");
      this.mapEl.appendChild(this.clockEl);
    }
    this.render();
    this.startClock();
  }

  // ------------------------------------------------------------- contrarreloj

  private get timerSeconds(): number | null {
    return TIMER_MODES[this.state.options.timer ?? "off"].seconds;
  }

  private startClock() {
    this.stopClock();
    const seconds = this.timerSeconds;
    if (!seconds || this.state.phase !== "placing") return;
    this.clock = { deadline: performance.now() + seconds * 1000, seconds, handle: 0, beeped: new Set() };
    this.clock.handle = window.setInterval(() => this.tick(), 200);
    this.tick();
  }

  private stopClock() {
    if (this.clock) window.clearInterval(this.clock.handle);
    this.clock = null;
    this.clockEl?.classList.add("hidden");
  }

  private secondsLeft(): number {
    return this.clock ? Math.max(0, (this.clock.deadline - performance.now()) / 1000) : 0;
  }

  private tick() {
    if (!this.clock) return;
    const left = this.secondsLeft();
    const whole = Math.ceil(left);
    const text = `⏱ ${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
    for (const el of [this.clockEl, this.panel.querySelector<HTMLElement>("[data-clock]")]) {
      if (!el) continue;
      el.textContent = text;
      el.classList.remove("hidden");
      el.classList.toggle("warn", left <= 10 && left > 5);
      el.classList.toggle("danger", left <= 5);
    }
    if (whole >= 1 && whole <= 5 && !this.clock.beeped.has(whole)) {
      this.clock.beeped.add(whole);
      beep(whole === 1 ? 990 : 740);
    }
    if (left <= 0) {
      this.stopClock();
      this.onTimeout();
    }
  }

  /** Time is up: confirm the dropped piece where it is, or score 0 if it was never dropped. */
  private onTimeout() {
    this.disposeDrag?.();
    this.disposeDrag = null;
    document.querySelector(".drag-ghost")?.remove();
    document.body.classList.remove("dragging");
    this.state = timeOut(this.state);
    this.showRoundResult();
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
    this.stopClock();
    this.clockEl?.remove();
    this.removePiece();
    clearResult(this.map);
    clearReview(this.map);
    this.panel.innerHTML = "";
  }

  // ------------------------------------------------------------- actions

  private removePiece() {
    this.piece?.remove();
    this.piece = null;
  }

  private drop(center: [number, number]) {
    if (this.state.phase !== "placing" && this.state.phase !== "adjusting") return; // e.g. a drag ending after time ran out
    const { place } = currentRound(this.state);
    this.removePiece();
    // The piece is always the real silhouette. Without modifiers it shows the real size
    // and orientation (only the position is scored), which makes lining it up easier.
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

  /** Keyboard-friendly move: bring the current piece to the map centre, keeping size and bearing. */
  private recenter() {
    const c = this.map.getCenter();
    const center: [number, number] = [c.lng, c.lat];
    this.state = placePiece(this.state, { center });
    this.piece?.moveTo(center);
  }

  private dropAtCenter() {
    const c = this.map.getCenter();
    this.drop([c.lng, c.lat]);
  }

  private confirm() {
    const left = this.clock ? this.secondsLeft() : undefined;
    this.stopClock();
    this.state = confirmPiece(this.state, left);
    this.showRoundResult();
  }

  /** Reveal the real place (and the player's piece, if any) after confirming or timing out. */
  private showRoundResult() {
    const round = currentRound(this.state);
    this.piece?.setLocked(true);
    const placed = round.placement?.center ?? null;
    showResult(this.map, round.place, placed, this.state.options.orientation);
    const pts = [round.place.centroid, ...(vertices(round.place.footprint) as [number, number][])];
    if (placed) pts.push(placed);
    if (this.piece) pts.push(...(vertices(this.piece.footprint()) as [number, number][]));
    const [w, s, e, n] = bounds(pts);
    this.map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 16.5, duration: motion(900) });
    this.render();
  }

  private next() {
    this.state = nextRound(this.state);
    this.removePiece();
    clearResult(this.map);
    if (this.state.phase === "finished") {
      if (this.recordKey) {
        const max = maxPointsPerGame(this.state.options, this.state.rounds.length);
        this.recordResult = recordScore(this.recordKey, totalScore(this.state), max);
      }
      this.render();
      this.review(null);
      return;
    }
    // Back to the neutral city view so the previous answer does not hint the next one.
    this.map.easeTo({ center: this.city.center, zoom: this.city.zoom, duration: motion(700) });
    this.render();
    this.startClock();
  }

  /** Player's silhouette for a finished round. */
  private playerFootprint(i: number) {
    const { place, placement } = this.state.rounds[i];
    const o = this.state.options;
    if (!placement) return null;
    const rotation = placement.bearing - (place.facadeBearing ?? placement.bearing);
    return transformFootprint(place.footprint, place.centroid, placement.center, placement.sizeRatio, o.orientation ? rotation : 0);
  }

  /** Final review on the map: every round (index null) or one of them. */
  private review(index: number | null) {
    const items: ReviewItem[] = this.state.rounds
      .map((r, i) => ({ index: i + 1, place: r.place, placed: r.placement?.center ?? null, playerFootprint: this.playerFootprint(i) }))
      .filter((_, i) => index === null || i === index);
    showReview(this.map, items);
    const pts = items.flatMap((it) => [
      ...(it.placed ? [it.placed] : []),
      ...(vertices(it.place.footprint) as [number, number][]),
      ...(it.playerFootprint ? (vertices(it.playerFootprint) as [number, number][]) : []),
    ]);
    const [w, s, e, n] = bounds(pts);
    this.map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 16.5, duration: motion(800) });
    this.panel.querySelectorAll<HTMLElement>("[data-review]").forEach((row) =>
      row.classList.toggle("selected", index !== null && Number(row.dataset.review) === index),
    );
  }

  // ------------------------------------------------------------- view

  private render() {
    this.disposeDrag?.();
    this.disposeDrag = null;
    const s = this.state;
    const mult = String(totalMultiplier(s.options)).replace(".", ",");
    const header = `
      <header class="panel-head">
        <div><strong>${s.phase === "finished" ? "Partida terminada" : `Lugar ${s.current + 1} de ${s.rounds.length}`}</strong></div>
        <div class="panel-score">${formatPoints(totalScore(s))} pts <span class="muted">/ máx ${formatPoints(maxPointsPerGame(s.options, s.rounds.length))} (×${mult})</span></div>
        ${this.timerSeconds && s.phase !== "finished" ? `<div class="panel-clock"><span class="clock-inline hidden" data-clock></span>
          <button class="icon-btn sound-btn" data-action="sound" aria-pressed="${soundOn()}" title="${soundOn() ? "Silenciar avisos" : "Activar sonido de avisos"}">${soundOn() ? "🔊" : "🔇"}</button></div>` : ""}
      </header>
      <ol class="strip${s.rounds.length > 10 ? " many" : ""}">${s.rounds
        .map((r, i) => {
          const cls = i < s.current || s.phase === "finished" ? "done" : i === s.current ? "current" : "";
          return `<li class="${cls}" title="${i <= s.current || s.phase === "finished" ? esc(r.place.name) : "Próximo lugar"}"><img src="${modelUrl(r.place.id) ?? ""}" alt=""></li>`;
        })
        .join("")}</ol>`;

    const hadFocus = this.panel.contains(document.activeElement);
    this.panel.innerHTML = header + `<section class="panel-body">${this.body()}</section>`;
    this.bind();
    // Keep keyboard users in the flow: focus the next primary action.
    if (hadFocus) this.panel.querySelector<HTMLElement>(".btn.primary, [data-action=\"drop-center\"]")?.focus({ preventScroll: true });
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
        <p class="hint">Arrastrá la silueta (o el ícono) para moverla. Podés acomodarla hasta confirmar.</p>
        <button class="btn link" data-action="recenter" title="Mové el mapa (con el mouse o las flechas) y traé la pieza a su centro">Traer al centro del mapa</button>
        ${this.sizeControls()}
        ${this.rotationControls()}
        <button class="btn primary" data-action="confirm">Confirmar</button>`;
    }
    // result
    const last = s.current === s.rounds.length - 1;
    const mult = score!.multiplier;
    if (score!.timedOut) {
      return `${card}
        <p class="note">⏱ Se acabó el tiempo antes de soltar el lugar: suma 0 puntos. En el mapa está la ubicación real.</p>
        <p class="legend"><span class="sw real"></span> ubicación real</p>
        <button class="btn primary" data-action="next">${last ? "Ver resultado final" : "Siguiente lugar"}</button>`;
    }
    const tb = score!.timeBonus;
    return `${card}
      <dl class="result">
        <dt>Distancia</dt><dd>${formatDistance(score!.distanceM)}</dd>
        <dt>Posición</dt><dd>${formatPoints(score!.position.points)} / ${formatPoints(score!.position.max)}</dd>
        ${this.sizeResult()}
        ${this.orientationResult()}
        ${tb ? `<dt>Bonus tiempo</dt><dd>+${formatPoints(tb.points)} <span class="muted">(sobraron ${Math.floor(tb.secondsLeft)} s)</span></dd>` : ""}
        ${mult === 1 ? "" : `<dt>Multiplicador</dt><dd>${formatPoints(score!.subtotal)} × ${String(+mult.toFixed(3)).replace(".", ",")}</dd>`}
        <dt>Total ronda</dt><dd><strong>${formatPoints(score!.total)}</strong></dd>
      </dl>
      <p class="legend"><span class="sw real"></span> ubicación real · <span class="sw mine"></span> tu pieza · <span class="sw err"></span> distancia</p>
      <button class="btn primary" data-action="next">${last ? "Ver resultado final" : "Siguiente lugar"}</button>`;
  }

  private summary(): string {
    const s = this.state;
    const o = s.options;
    const mult = +totalMultiplier(o).toFixed(3);
    const pts = (c: { points: number } | undefined) => (c ? formatPoints(c.points) : "");
    const rows = s.rounds
      .map((r, i) => {
        const sc = r.score!;
        const parts = sc.timedOut
          ? [`<span>⏱ sin tiempo</span>`]
          : [`<span>${formatDistance(sc.distanceM)}</span>`, `<span title="Posición">Pos ${pts(sc.position)}</span>`];
        if (sc.timedOut) return `<li data-review="${i}" tabindex="0" title="Ver en el mapa">
          <div class="row-top"><span class="num">${i + 1}</span><span class="name">${esc(r.place.name)}</span><strong>0</strong></div>
          <div class="row-detail">${parts.join(" · ")}</div></li>`;
        if (o.size) parts.push(`<span title="Tamaño">Tam ${pts(sc.size)}${sc.size?.compensated ? "*" : ""}</span>`);
        if (o.orientation) parts.push(`<span title="Orientación">Ori ${pts(sc.orientation)}${sc.orientation?.compensated ? "*" : ""}</span>`);
        if (sc.timeBonus) parts.push(`<span title="Bonus por tiempo">⏱ +${pts(sc.timeBonus)}</span>`);
        return `<li data-review="${i}" tabindex="0" title="Ver en el mapa">
          <div class="row-top"><span class="num">${i + 1}</span><span class="name">${esc(r.place.name)}</span><strong>${formatPoints(sc.total)}</strong></div>
          <div class="row-detail">${parts.join(" · ")}</div></li>`;
      })
      .join("");
    const compensated = s.rounds.some((r) => r.score!.size?.compensated || r.score!.orientation?.compensated);
    return `<p class="total">Total: <strong>${formatPoints(totalScore(s))}</strong> pts
        <span class="muted">de ${formatPoints(maxPointsPerGame(o, s.rounds.length))}${mult === 1 ? "" : ` · incluye ×${String(mult).replace(".", ",")}`}</span></p>
      ${this.recordLine()}
      <ol class="summary-list">${rows}</ol>
      <p class="muted">Tocá un lugar para verlo en el mapa.${compensated ? " * componente compensado con la posición." : ""}</p>
      <p class="legend"><span class="sw real"></span> real · <span class="sw mine"></span> tu ubicación · <span class="sw err"></span> distancia</p>
      <div class="summary-actions">
        <button class="btn" data-action="review-all">Ver todos</button>
        <button class="btn primary" data-action="restart">Jugar de nuevo</button>
      </div>`;
  }

  private recordLine(): string {
    const r = this.recordResult;
    if (!r) return "";
    if (r.isRecord) {
      return `<p class="record new">🏆 ¡Nuevo récord con estas opciones!${r.previous ? ` <span class="muted">Antes: ${formatPoints(r.previous.score)} pts</span>` : ""}</p>`;
    }
    return r.previous ? `<p class="record">Tu récord con estas opciones: <strong>${formatPoints(r.previous.score)}</strong> pts</p>` : "";
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
    on("recenter", () => this.recenter());
    on("confirm", () => this.confirm());
    on("next", () => this.next());
    on("review-all", () => this.review(null));
    on("sound", () => {
      setSound(!soundOn());
      this.render();
      this.tick();
    });
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

// ------------------------------------------------------------------ sound

const SOUND_KEY = "geo-locator:sound";

function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

function setSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

let audio: AudioContext | null = null;

/** Short beep for the last seconds of the contrarreloj (Web Audio, no files). */
function beep(freq: number) {
  if (!soundOn()) return;
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.13);
  } catch {
    /* audio unavailable */
  }
}

/** Animation length, or 0 when the user asked the system for reduced motion. */
function motion(ms: number): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}

function bounds(points: [number, number][]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
