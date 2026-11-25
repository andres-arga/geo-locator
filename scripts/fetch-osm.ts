/**
 * Reproducible data preparation: city boundary, major parks and landmark
 * footprints/centroids/orientations from OpenStreetMap (Overpass API).
 *
 *   npm run data              # uses scripts/cache when present
 *   npm run data -- --refresh # ignore the cache and query Overpass again
 *   OVERPASS_URL=https://... npm run data
 *
 * Raw Overpass responses are cached in scripts/cache/ (keyed by query hash), so a
 * second run is offline and produces byte-identical output.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import osmtogeojson from "osmtogeojson";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import type { Place, PlacesFile, Symmetry } from "../src/cities/placeTypes";
import { SCORING } from "../src/config/scoring";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "scripts/cache");
const REFRESH = process.argv.includes("--refresh");
const ENDPOINTS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];

interface PlaceSource {
  id: string;
  name: string;
  select: string;
  osm?: string;
  symmetry: Symmetry;
  facadeBearing?: number;
  /** Pin which entrance=main node defines the facade, e.g. "node/123". */
  entrance?: string;
  /** Approximate manual facade direction; snapped to the nearest wall of the footprint rectangle. */
  facadeHint?: number;
  /** Merge the geometry of every way candidate (places split into several ways, e.g. bridges). */
  mergeCandidates?: boolean;
  /** The place is mapped as a point (e.g. a shop): use the building it sits in. */
  containingBuilding?: boolean;
  bridgeWidthM?: number;
}
interface CitySource {
  city: string;
  bbox: [number, number, number, number];
  boundary: { select: string };
  majorParks: { minAreaHa: number };
  places: PlaceSource[];
}
interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

// ---------------------------------------------------------------- Overpass

async function overpass(query: string): Promise<{ elements: OsmElement[] }> {
  const key = createHash("sha1").update(query).digest("hex").slice(0, 16);
  const file = join(CACHE, `${key}.json`);
  if (!REFRESH && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "geo-locator-data-script" },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(Number(process.env.OVERPASS_TIMEOUT_MS ?? 90_000)),
        });
        if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
        const json = await res.json();
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(file, JSON.stringify(json));
        return json;
      } catch (e) {
        lastError = e;
        console.warn(`  ! ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error(`Overpass failed for query:\n${query}\n${lastError}`);
}

const header = (timeout = 120) => `[out:json][timeout:${timeout}];`;

function bboxFilter([w, s, e, n]: CitySource["bbox"]): string {
  return `(${s},${w},${n},${e})`;
}

/** Full geometry of one element as GeoJSON features (osmtogeojson). */
async function geometryOf(ref: string): Promise<FeatureCollection> {
  const [type, id] = ref.split("/");
  const data = await overpass(`${header()}${type}(${id});out body;>;out skel qt;`);
  return osmtogeojson(data, { flatProperties: true }) as FeatureCollection;
}

// ---------------------------------------------------------------- helpers

const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

function roundCoords<T>(value: T): T {
  if (Array.isArray(value)) {
    return (typeof value[0] === "number" ? value.map((n: number) => round(n)) : value.map(roundCoords)) as T;
  }
  return value;
}

function roundGeometry<G extends Geometry>(g: G): G {
  return { ...g, coordinates: roundCoords((g as { coordinates: unknown }).coordinates) } as G;
}

/**
 * Facade direction at an entrance: the outward normal of the footprint edge the
 * entrance node lies on. Falls back to centroid -> entrance when the node is not on
 * the outline (more than 3 m away from every edge).
 */
function facadeBearingAt(
  footprint: Feature<Polygon | MultiPolygon>,
  entrance: [number, number],
  centroid: [number, number],
): { bearing: number; method: "normal" | "centroid" } {
  const toward = turf.bearing(centroid, entrance);
  const polys = footprint.geometry.type === "Polygon" ? [footprint.geometry.coordinates] : footprint.geometry.coordinates;
  let best: { d: number; a: number[]; b: number[] } | null = null;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = turf.pointToLineDistance(entrance, turf.lineString([ring[i], ring[i + 1]]), { units: "meters" });
        if (!best || d < best.d) best = { d, a: ring[i], b: ring[i + 1] };
      }
    }
  }
  const norm = (x: number) => ((x % 360) + 360) % 360;
  if (!best || best.d > 3) return { bearing: norm(toward), method: "centroid" };
  const edge = turf.bearing(best.a, best.b);
  const diff = (x: number) => Math.abs(((x - toward + 540) % 360) - 180);
  const n1 = edge + 90;
  const n2 = edge - 90;
  return { bearing: norm(diff(n1) <= diff(n2) ? n1 : n2), method: "normal" };
}

/**
 * Minimum-area enclosing rectangle of the footprint (brute force over the convex
 * hull in a local metric plane). Returns the compass bearing of one side's outward
 * normal (the other three are +90°, +180°, +270°) and the bearing of the long axis.
 */
function footprintRectangle(footprint: Feature<Polygon | MultiPolygon>): { normal: number; longAxis: number } {
  const hull = turf.convex(footprint)!;
  const [lon0, lat0] = turf.centroid(footprint).geometry.coordinates;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const pts = hull.geometry.coordinates[0].map(([x, y]) => [(x - lon0) * kx, (y - lat0) * 110540]);
  let best = { area: Infinity, deg: 0, w: 0, h: 0 };
  for (let deg = 0; deg < 90; deg += 0.25) {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t), s = Math.sin(t);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of pts) {
      const u = x * c + y * s, v = -x * s + y * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) best = { area, deg, w: maxU - minU, h: maxV - minV };
  }
  // Side directions as math angles (from +x, counter-clockwise): deg and deg + 90.
  const toBearing = (math: number) => (((90 - math) % 360) + 360) % 360;
  const longMath = best.w >= best.h ? best.deg : best.deg + 90;
  return { normal: toBearing(best.deg) % 90, longAxis: toBearing(longMath) % 180 };
}

const isArea = (f: Feature) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon";
const rank = { relation: 0, way: 1, node: 2 } as const;

function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1) + "\n");
}

// ---------------------------------------------------------------- main

async function main() {
  const src: CitySource = JSON.parse(readFileSync(join(ROOT, "scripts/sources/caba.places.json"), "utf8"));
  const bb = bboxFilter(src.bbox);
  const outDir = join(ROOT, "public/data/cities", src.city);
  const report: string[] = [`# Datos de ${src.city}`, "", "Generado por `npm run data`. Revisar los valores marcados.", ""];

  // Boundary ------------------------------------------------------------
  console.log("Boundary");
  const bIds = await overpass(`${header()}${src.boundary.select}${bb};out ids;`);
  if (bIds.elements.length !== 1) throw new Error(`Boundary: expected 1 element, got ${bIds.elements.length}`);
  const bRef = `relation/${bIds.elements[0].id}`;
  const boundary = (await geometryOf(bRef)).features.find(isArea);
  if (!boundary) throw new Error("Boundary has no area geometry");
  writeJson(join(outDir, "boundary.geojson"), {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { osm: bRef }, geometry: roundGeometry(boundary.geometry) }],
  });
  report.push(`- Límite: \`${bRef}\`, ${(turf.area(boundary) / 1e6).toFixed(1)} km²`, "", "## Lugares", "");

  // Places ----------------------------------------------------------------
  const places: Place[] = [];
  for (const p of src.places) {
    try {
      console.log(`Place ${p.id}`);
      const lines: string[] = [`### ${p.name} (\`${p.id}\`)`];

      const candidates = (await overpass(`${header()}(${p.select}${bb};);out tags center;`)).elements.sort(
        (a, b) => rank[a.type] - rank[b.type] || a.id - b.id,
      );
      if (!candidates.length && !p.osm) {
        lines.push("- ❌ Sin resultados para el selector; corregir `select` o fijar `osm`.", "");
        report.push(...lines);
        console.warn(`  ! no candidates for ${p.id}`);
        continue;
      }
      let ref = p.osm ?? `${candidates[0].type}/${candidates[0].id}`;
      if (p.containingBuilding && ref.startsWith("node/")) {
        const nodeId = ref.split("/")[1];
        const around = (await overpass(`${header()}node(${nodeId});way(around:3)["building"];out ids tags;`)).elements;
        if (!around.length) throw new Error(`${p.id}: no building around ${ref}`);
        lines.push(`- Punto \`${ref}\` dentro del edificio \`way/${around[0].id}\`${around.length > 1 ? ` (había ${around.length}, se usó el de menor id)` : ""}`);
        ref = `way/${around.sort((a, b) => a.id - b.id)[0].id}`;
      }
      if (candidates.length > 1 || !p.osm) {
        lines.push(`- Candidatos: ${candidates.map((c) => `\`${c.type}/${c.id}\` ${c.tags?.name ?? ""}`).join(" · ")}`);
      }
      lines.push(`- Elemento usado: \`${ref}\`${p.osm ? " (fijado)" : " (automático: fijarlo con `osm` si es correcto)"}`);

      let main: Feature;
      if (p.mergeCandidates) {
        const ways = candidates.filter((c) => c.type === "way").map((c) => `way/${c.id}`);
        const parts: Feature[] = [];
        for (const w of ways) {
          const g = await geometryOf(w);
          parts.push(g.features.find((f) => f.id === w) ?? g.features[0]);
        }
        const coords = parts.flatMap((f) =>
          f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [],
        );
        main = turf.multiLineString(coords);
        lines.push(`- Geometría unida de ${ways.length} vías: ${ways.map((w) => `\`${w}\``).join(", ")}`);
      } else {
        const fc = await geometryOf(ref);
        main = fc.features.find((f) => f.id === ref) ?? fc.features[0];
      }
      let footprint: Feature<Polygon | MultiPolygon>;
      if (isArea(main)) {
        footprint = main as Feature<Polygon | MultiPolygon>;
      } else if (main.geometry.type === "LineString" || main.geometry.type === "MultiLineString") {
        const width = p.bridgeWidthM ?? 6;
        footprint = turf.buffer(main, width / 2, { units: "meters" }) as Feature<Polygon>;
        lines.push(`- Huella: línea con buffer de ${width} m`);
      } else {
        footprint = turf.circle(main.geometry.type === "Point" ? main.geometry.coordinates : turf.centroid(main).geometry.coordinates, 3, { units: "meters" });
        lines.push("- Huella: nodo sin área (círculo de 3 m de radio)");
      }

      const centroid = turf.centerOfMass(footprint).geometry.coordinates as [number, number];
      const eqDiameterM = Math.sqrt(turf.area(footprint));

      // Facade orientation: entrance=main on the outline, else manual value.
      const [type, id] = ref.split("/");
      const wayScope = type === "relation" ? `way(r);` : type === "way" ? `way(${id});` : "";
      const entrances = wayScope
        ? (await overpass(`${header()}${type}(${id});${wayScope}node(w)["entrance"="main"];out body;`)).elements
        : [];
      let facadeBearing: number | null = null;
      let bearingSource: Place["bearingSource"] = null;
      if (entrances.length) {
        entrances.sort((a, b) => a.id - b.id);
        const pinned = p.entrance ? entrances.find((e) => `node/${e.id}` === p.entrance) : undefined;
        if (p.entrance && !pinned) throw new Error(`${p.id}: pinned entrance ${p.entrance} is not an entrance=main of ${ref}`);
        const e = pinned ?? entrances[0];
        const r = facadeBearingAt(footprint, [e.lon!, e.lat!], centroid);
        facadeBearing = r.bearing;
        bearingSource = "calculado";
        const how = r.method === "normal" ? "normal a la pared de" : "centroide →";
        const which = pinned
          ? " (fijado)"
          : entrances.length > 1
            ? `; hay ${entrances.length} (${entrances.map((x) => `node/${x.id}`).join(", ")}): se usó el de menor id, fijar con \`entrance\``
            : "";
        lines.push(`- Rumbo: ${facadeBearing.toFixed(0)}° calculado (${how} \`node/${e.id}\` entrance=main${which})`);
      } else if (p.facadeHint !== undefined) {
        const { normal } = footprintRectangle(footprint);
        const options = [0, 90, 180, 270].map((k) => (normal + k) % 360);
        const diff = (x: number) => Math.abs(((x - p.facadeHint! + 540) % 360) - 180);
        facadeBearing = options.reduce((a, b) => (diff(b) < diff(a) ? b : a));
        bearingSource = "manual";
        lines.push(`- Rumbo: ${facadeBearing.toFixed(0)}° manual ⚠️ revisar (pista ${p.facadeHint}° ajustada a la pared más cercana)`);
      } else if (p.symmetry === 2 || p.symmetry === 4) {
        const rect = footprintRectangle(footprint);
        facadeBearing = p.symmetry === 4 ? rect.normal : rect.longAxis;
        bearingSource = "calculado";
        lines.push(
          `- Rumbo: ${facadeBearing.toFixed(0)}° calculado (${p.symmetry === 4 ? "lados" : "eje largo"} del rectángulo mínimo; simetría ${p.symmetry})`,
        );
      } else if (p.facadeBearing !== undefined) {
        facadeBearing = p.facadeBearing;
        bearingSource = "manual";
        lines.push(`- Rumbo: ${facadeBearing}° manual ⚠️ revisar`);
      } else if (p.symmetry !== "radial") {
        lines.push("- Rumbo: ⚠️ FALTA (no hay entrance=main; cargar `facadeBearing` manual)");
      }

      const modifiers = {
        size: eqDiameterM >= SCORING.minSizeDiameterM,
        orientation: p.symmetry !== "radial" && facadeBearing !== null,
      };
      lines.push(
        `- Diámetro equivalente: ${eqDiameterM.toFixed(1)} m · simetría ${p.symmetry}`,
        `- Modificadores: tamaño ${modifiers.size ? "✔" : "✘ (excluido)"} · orientación ${modifiers.orientation ? "✔" : "✘ (excluido)"}`,
        "",
      );
      report.push(...lines);

      places.push({
        id: p.id,
        name: p.name,
        osm: ref,
        centroid: roundCoords(centroid),
        footprint: { type: "Feature", properties: {}, geometry: roundGeometry(footprint.geometry) },
        eqDiameterM: round(eqDiameterM, 1),
        facadeBearing: facadeBearing === null ? null : round(facadeBearing, 1),
        bearingSource,
        symmetry: p.symmetry,
        modifiers,
      });
    } catch (e) {
      // One failing place must not abort the run: report it and continue.
      console.warn(`  ! ${p.id} skipped: ${(e as Error).message.split("\n")[0]}`);
      report.push(`### ${p.name} (\`${p.id}\`)`, "- ❌ Overpass no respondió; volver a correr `npm run data`.", "");
    }
  }

  const file: PlacesFile = { city: src.city, generatedAt: "from-osm", places };
  writeJson(join(outDir, "places.json"), file);
  console.log(`\n${places.length}/${src.places.length} places written.`);

  report.push("## Capas auxiliares", "");
  // Major parks (medium level) -------------------------------------------
  await (async () => {
    console.log("Major parks");
    // Non-fatal: this is the heaviest query; the medium level just lacks big parks if it fails.
    let parksRaw: { elements: OsmElement[] };
    try {
      parksRaw = await overpass(`${header(300)}(way["leisure"="park"]${bb};relation["leisure"="park"]${bb};);out geom;`);
    } catch (e) {
      console.warn(`  ! major parks skipped: ${(e as Error).message.split("\n")[0]}`);
      report.push("- ⚠️ Parques grandes: Overpass no respondió; volver a correr `npm run data`.");
      return;
    }
    const parks = (osmtogeojson(parksRaw, { flatProperties: true }) as FeatureCollection).features
      .filter(isArea)
      .filter((f) => turf.booleanIntersects(f, boundary))
      .filter((f) => turf.area(f) >= src.majorParks.minAreaHa * 1e4)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((f) => ({
        type: "Feature" as const,
        properties: { osm: String(f.id) },
        geometry: roundGeometry(turf.simplify(f, { tolerance: 0.00002 }).geometry),
      }));
    writeJson(join(outDir, "parks-major.geojson"), { type: "FeatureCollection", features: parks });
    report.push(`- Parques grandes (≥ ${src.majorParks.minAreaHa} ha): ${parks.length}`);
  })();
  writeFileSync(join(ROOT, `scripts/reports/${src.city}.md`), report.join("\n") + "\n");
  console.log(`Review scripts/reports/${src.city}.md`);
}

mkdirSync(join(ROOT, "scripts/reports"), { recursive: true });
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
