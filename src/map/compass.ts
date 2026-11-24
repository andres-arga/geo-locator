/** Fixed compass rose: the map is always north-up, so it never rotates. */
export function createCompass(): HTMLElement {
  const el = document.createElement("div");
  el.className = "compass";
  el.setAttribute("aria-label", "Norte arriba");
  el.innerHTML = `
<svg viewBox="-50 -50 100 100" width="64" height="64" aria-hidden="true">
  <circle r="46" fill="rgba(255,255,255,.85)" stroke="#5b4a8b" stroke-width="2"/>
  <g stroke="none">
    <polygon points="0,-38 7,0 0,6 -7,0" fill="#c0392b"/>
    <polygon points="0,38 7,0 0,-6 -7,0" fill="#5b4a8b"/>
    <polygon points="38,0 0,5 -4,0 0,-5" fill="#9a91b8"/>
    <polygon points="-38,0 0,5 4,0 0,-5" fill="#9a91b8"/>
  </g>
  <text x="0" y="-40" dy="-0" font-family="system-ui, sans-serif" font-size="13" font-weight="800"
        text-anchor="middle" dominant-baseline="central" fill="#c0392b" stroke="#fff" stroke-width="3"
        paint-order="stroke">N</text>
</svg>`;
  return el;
}
