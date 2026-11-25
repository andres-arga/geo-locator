import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { Place } from "../cities/placeTypes";
import { transformFootprint, vertices } from "../game/geometry";

/** Player-chosen equivalent diameter limits (metres). Wide enough for any CABA place. */
export const MIN_DIAMETER_M = 10;
export const MAX_DIAMETER_M = 600;

export interface PieceValue {
  center: [number, number];
  /** Player diameter / real diameter. */
  sizeRatio: number;
  /** Facade bearing chosen by the player (degrees). */
  bearing: number;
}

export interface PieceOptions {
  map: MlMap;
  mapEl: HTMLElement;
  place: Place;
  iconUrl: string | undefined;
  value: PieceValue;
  resizable: boolean;
  onChange: (v: PieceValue) => void;
}

const SRC = "piece";
const FILL = "piece-fill";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The piece as the real footprint silhouette, georeferenced: it scales with the
 * map zoom because its size is in metres. Handles are DOM elements on top.
 *
 * Gesture rule (map vs piece): a pointer that goes down ON the piece (or a handle)
 * starts a piece gesture and the map's pan/zoom are suspended until every finger
 * is lifted; extra fingers join the piece gesture (pinch = resize). A pointer that
 * goes down elsewhere is left to the map.
 */
export class SilhouettePiece {
  private value: PieceValue;
  private locked = false;
  private overlay: HTMLElement;
  private badge: HTMLElement;
  private corners: HTMLElement[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private gestureStart: { value: PieceValue; pts: Map<number, { x: number; y: number }> } | null = null;
  private cornerDrag: { id: number; startDist: number; startDiameter: number } | null = null;
  private readonly off: (() => void)[] = [];

  constructor(private o: PieceOptions) {
    this.value = { ...o.value };
    const { map } = o;
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: "geojson", data: EMPTY });
      map.addLayer({ id: FILL, type: "fill", source: SRC, paint: { "fill-color": "#5b4a8b", "fill-opacity": 0.45 } });
      map.addLayer({ id: "piece-line", type: "line", source: SRC, paint: { "line-color": "#3b2d66", "line-width": 2 } });
    }

    this.overlay = document.createElement("div");
    this.overlay.className = "piece-overlay";
    this.badge = document.createElement("div");
    this.badge.className = "piece-badge";
    this.badge.innerHTML = o.iconUrl ? `<img src="${o.iconUrl}" alt="" draggable="false">` : "";
    this.badge.title = o.place.name;
    this.overlay.appendChild(this.badge);
    if (o.resizable) {
      for (const pos of ["nw", "ne", "se", "sw"]) {
        const h = document.createElement("div");
        h.className = `piece-handle corner ${pos}`;
        h.setAttribute("aria-hidden", "true");
        this.corners.push(h);
        this.overlay.appendChild(h);
        this.listen(h, "pointerdown", (e) => this.cornerDown(e as PointerEvent));
      }
    }
    o.mapEl.appendChild(this.overlay);

    this.listen(o.mapEl, "pointerdown", (e) => this.down(e as PointerEvent), true);
    this.listen(window, "pointermove", (e) => this.move(e as PointerEvent));
    this.listen(window, "pointerup", (e) => this.up(e as PointerEvent));
    this.listen(window, "pointercancel", (e) => this.up(e as PointerEvent));
    this.listen(o.mapEl, "wheel", (e) => this.wheel(e as WheelEvent), true);
    const sync = () => this.layout();
    map.on("move", sync);
    this.off.push(() => map.off("move", sync));
    const hover = (e: MapMouseEvent) => {
      if (!this.locked) map.getCanvas().style.cursor = this.hit(e.point.x, e.point.y) ? "move" : "";
    };
    map.on("mousemove", hover);
    this.off.push(() => map.off("mousemove", hover));

    this.redraw();
  }

  getValue(): PieceValue {
    return { ...this.value };
  }

  diameter(): number {
    return this.value.sizeRatio * this.o.place.eqDiameterM;
  }

  /** Set the diameter in metres (slider, keyboard). */
  setDiameter(m: number) {
    const d = clamp(m, MIN_DIAMETER_M, MAX_DIAMETER_M);
    this.update({ sizeRatio: d / this.o.place.eqDiameterM });
  }

  setLocked(locked: boolean) {
    this.locked = locked;
    this.overlay.classList.toggle("locked", locked);
    this.o.map.getCanvas().style.cursor = "";
  }

  /** Geometry currently drawn (for the result screen). */
  footprint() {
    const { place } = this.o;
    return transformFootprint(place.footprint, place.centroid, this.value.center, this.value.sizeRatio, this.rotation());
  }

  remove() {
    this.off.forEach((f) => f());
    this.overlay.remove();
    (this.o.map.getSource(SRC) as GeoJSONSource | undefined)?.setData(EMPTY);
    this.resumeMap();
  }

  // ------------------------------------------------------------ internals

  private rotation(): number {
    // Phase 5 rotates the silhouette by (player bearing - real facade bearing).
    return 0;
  }

  private update(patch: Partial<PieceValue>) {
    this.value = { ...this.value, ...patch };
    this.redraw();
    this.o.onChange(this.getValue());
  }

  private redraw() {
    (this.o.map.getSource(SRC) as GeoJSONSource).setData({ type: "FeatureCollection", features: [this.footprint()] });
    this.layout();
  }

  /** Place badge and corner handles around the projected silhouette. */
  private layout() {
    const { map } = this.o;
    const pts = vertices(this.footprint()).map((p) => map.project(p as [number, number]));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const c = map.project(this.value.center);
    // Keep the handles at least 28 px from the centre so tiny footprints stay usable.
    const half = Math.max(28, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2);
    this.badge.style.transform = `translate(${c.x}px, ${c.y}px)`;
    const offsets: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    this.corners.forEach((h, i) => {
      h.style.transform = `translate(${c.x + offsets[i][0] * half}px, ${c.y + offsets[i][1] * half}px)`;
    });
  }

  private hit(x: number, y: number): boolean {
    return this.o.map.queryRenderedFeatures([[x - 3, y - 3], [x + 3, y + 3]], { layers: [FILL] }).length > 0;
  }

  private local(e: PointerEvent) {
    const r = this.o.mapEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private suspendMap() {
    const { map } = this.o;
    map.dragPan.disable();
    map.touchZoomRotate.disable();
  }

  private resumeMap() {
    const { map } = this.o;
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    map.touchZoomRotate.disableRotation(); // north stays up
  }

  private down(e: PointerEvent) {
    if (this.locked || (e.target as HTMLElement).closest(".piece-handle")) return;
    // The first finger of a new touch sequence: any pointer still tracked is stale
    // (its pointerup was lost), so it must not turn this map gesture into a piece one.
    if (e.isPrimary && this.pointers.size) {
      this.pointers.clear();
      this.gestureStart = null;
      this.resumeMap();
    }
    const p = this.local(e);
    const onPiece = this.hit(p.x, p.y) || !!(e.target as HTMLElement).closest(".piece-badge");
    if (!onPiece && this.pointers.size === 0) return; // a map gesture
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    this.suspendMap();
    this.pointers.set(e.pointerId, p);
    this.restartGesture();
  }

  private restartGesture() {
    this.gestureStart = { value: { ...this.value }, pts: new Map(this.pointers) };
  }

  private move(e: PointerEvent) {
    if (this.cornerDrag && e.pointerId === this.cornerDrag.id) return this.cornerMove(e);
    if (!this.pointers.has(e.pointerId) || !this.gestureStart) return;
    this.pointers.set(e.pointerId, this.local(e));
    const { map } = this.o;
    const start = this.gestureStart;
    const ids = [...start.pts.keys()].filter((id) => this.pointers.has(id));
    const now = ids.map((id) => this.pointers.get(id)!);
    const then = ids.map((id) => start.pts.get(id)!);
    const mid = (ps: { x: number; y: number }[]) => ({
      x: ps.reduce((a, p) => a + p.x, 0) / ps.length,
      y: ps.reduce((a, p) => a + p.y, 0) / ps.length,
    });
    const m0 = mid(then), m1 = mid(now);
    const c0 = map.project(start.value.center);
    const ll = map.unproject([c0.x + m1.x - m0.x, c0.y + m1.y - m0.y]);
    const patch: Partial<PieceValue> = { center: [ll.lng, ll.lat] };
    if (ids.length >= 2 && this.o.resizable) {
      const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = d(now[0], now[1]) / Math.max(1, d(then[0], then[1]));
      const diam = clamp(start.value.sizeRatio * this.o.place.eqDiameterM * ratio, MIN_DIAMETER_M, MAX_DIAMETER_M);
      patch.sizeRatio = diam / this.o.place.eqDiameterM;
    }
    this.update(patch);
  }

  private up(e: PointerEvent) {
    if (this.cornerDrag && e.pointerId === this.cornerDrag.id) {
      this.cornerDrag = null;
      this.resumeMap();
      return;
    }
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 0) {
      this.gestureStart = null;
      this.resumeMap();
    } else {
      this.restartGesture(); // e.g. pinch -> one finger keeps moving
    }
  }

  private cornerDown(e: PointerEvent) {
    if (this.locked) return;
    e.preventDefault();
    e.stopPropagation();
    this.suspendMap();
    const p = this.local(e);
    const c = this.o.map.project(this.value.center);
    this.cornerDrag = { id: e.pointerId, startDist: Math.max(1, Math.hypot(p.x - c.x, p.y - c.y)), startDiameter: this.diameter() };
  }

  /** Corner handles scale uniformly around the centre. */
  private cornerMove(e: PointerEvent) {
    const drag = this.cornerDrag!;
    const p = this.local(e);
    const c = this.o.map.project(this.value.center);
    const dist = Math.hypot(p.x - c.x, p.y - c.y);
    this.setDiameter(drag.startDiameter * (dist / drag.startDist));
  }

  /** Alt + wheel over the piece resizes it; a plain wheel keeps zooming the map. */
  private wheel(e: WheelEvent) {
    if (this.locked || !this.o.resizable || !e.altKey) return;
    const r = this.o.mapEl.getBoundingClientRect();
    if (!this.hit(e.clientX - r.left, e.clientY - r.top)) return;
    e.preventDefault();
    e.stopPropagation();
    this.setDiameter(this.diameter() * Math.pow(2, -e.deltaY / 500));
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void, capture = false) {
    t.addEventListener(type, fn, { capture, passive: false });
    this.off.push(() => t.removeEventListener(type, fn, { capture }));
  }
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
