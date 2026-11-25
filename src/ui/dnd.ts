/**
 * Drag a piece from the panel onto the map with Pointer Events (mouse, pen and
 * touch). A "ghost" pin follows the pointer; on touch it floats above the finger
 * so the drop point stays visible. The drop point is the ghost's tip.
 */
export interface DragOptions {
  source: HTMLElement;
  target: HTMLElement;
  createGhost: () => HTMLElement;
  canStart: () => boolean;
  onDrop: (point: { x: number; y: number }) => void;
}

const TOUCH_LIFT = 56; // px above the finger

export function enableDrag(opts: DragOptions): () => void {
  let ghost: HTMLElement | null = null;
  let lift = 0;
  let pointerId: number | null = null;

  const tip = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY - lift });

  const overTarget = (p: { x: number; y: number }) => {
    const r = opts.target.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  };

  const move = (e: PointerEvent) => {
    if (!ghost || e.pointerId !== pointerId) return;
    const p = tip(e);
    ghost.style.transform = `translate(${p.x}px, ${p.y}px)`;
    opts.target.classList.toggle("drop-target", overTarget(p));
  };

  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!ghost || e.pointerId !== pointerId) return;
    const p = tip(e);
    ghost.remove();
    ghost = null;
    pointerId = null;
    opts.target.classList.remove("drop-target");
    document.body.classList.remove("dragging");
    if (!cancelled && overTarget(p)) {
      const r = opts.target.getBoundingClientRect();
      opts.onDrop({ x: p.x - r.left, y: p.y - r.top });
    }
  };

  const down = (e: PointerEvent) => {
    if (!opts.canStart() || ghost || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    pointerId = e.pointerId;
    lift = e.pointerType === "touch" ? TOUCH_LIFT : 0;
    opts.source.setPointerCapture(e.pointerId);
    ghost = opts.createGhost();
    ghost.classList.add("drag-ghost");
    document.body.appendChild(ghost);
    document.body.classList.add("dragging");
    move(e);
  };

  const up = (e: PointerEvent) => end(e, false);
  const cancel = (e: PointerEvent) => end(e, true);

  opts.source.addEventListener("pointerdown", down);
  opts.source.addEventListener("pointermove", move);
  opts.source.addEventListener("pointerup", up);
  opts.source.addEventListener("pointercancel", cancel);
  return () => {
    opts.source.removeEventListener("pointerdown", down);
    opts.source.removeEventListener("pointermove", move);
    opts.source.removeEventListener("pointerup", up);
    opts.source.removeEventListener("pointercancel", cancel);
  };
}
