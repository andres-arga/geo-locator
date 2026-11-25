const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export function formatDistance(m: number): string {
  return m < 1000 ? `${nf0.format(m)} m` : `${nf.format(m / 1000)} km`;
}

export function formatPoints(p: number): string {
  return nf0.format(Math.round(p));
}

/** Escape text before putting it into innerHTML. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const POINTS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

/** Bearing as "NE · 47°" (8-point compass, Spanish abbreviations). */
export function formatBearing(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return `${POINTS[Math.round(d / 45) % 8]} · ${d}°`;
}
