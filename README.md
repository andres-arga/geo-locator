# Geo Locator

Minijuego web de geografía urbana: arrastrá lugares icónicos de una ciudad al mapa, donde
creas que están. Opcionalmente, acertá también su **tamaño** y hacia dónde mira su
**fachada**. Ciudades: Buenos Aires (CABA) y Córdoba, con 25 lugares cada una.

**Jugar:** https://andres-arga.github.io/geo-locator/ · **Revisión de datos:** [`/debug.html`](https://andres-arga.github.io/geo-locator/debug.html)

Sitio 100 % estático (Vite + TypeScript + MapLibre GL JS + turf.js), sin backend.

## Cómo se juega

- Ciudades: **Buenos Aires (CABA)** y **Córdoba**.
- **Partida rápida** (7 lugares al azar) o **partida completa** (todos los lugares de la
  selección), eligiendo entre todos los lugares, solo estadios (**Modo Fútbol**) o
  lugares icónicos sin estadios.
- **Dificultad del mapa** (multiplica el puntaje): Fácil ×1 (mapa completo, nombres de
  calles opcionales), Medio ×1,5 (avenidas, autopistas, parques grandes y río), Difícil ×2
  (la ciudad en blanco, solo el contorno). El mapa siempre tiene el norte arriba.
- **Modificadores** (cada uno suma hasta 400 pts por lugar):
  - *Acertar tamaño*: la pieza es la silueta real (en metros); se ajusta con las manijas,
    el slider, `+`/`−`, Alt + rueda o pellizcando en el celular.
  - *Acertar orientación*: se gira la flecha de la fachada con su manija, el slider,
    `Q`/`E` (Shift = fino) o con dos dedos.
- Los récords se guardan en el navegador, uno por combinación de opciones.

## Desarrollo

Requisitos: Node 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitarios (Vitest)
npm run build      # sitio estático en dist/
```

### Datos (ya incluidos en el repo; regenerarlos solo si hace falta)

| Comando | Qué hace | Requiere |
|---|---|---|
| `npm run tiles` | Extrae CABA del mapa base diario de Protomaps → `public/tiles/caba.pmtiles` (~14 MB) | CLI [`pmtiles`](https://github.com/protomaps/go-pmtiles) (`go install github.com/protomaps/go-pmtiles@latest`) y acceso a `build.protomaps.com` |
| `npm run fonts` | Descarga los glifos Noto Sans (OFL) para los nombres de calles → `public/fonts/` | acceso a `raw.githubusercontent.com` |
| `npm run data` | Límite de la ciudad, parques grandes y los lugares desde OpenStreetMap (Overpass) → `public/data/cities/caba/` y el informe `scripts/reports/caba.md` | acceso a un servidor Overpass |

`npm run data` guarda cada respuesta de Overpass en `scripts/cache/` (no versionado), así
que una segunda corrida no usa la red y genera exactamente el mismo resultado. Si un
lugar falla (los servidores públicos de Overpass suelen estar saturados), queda marcado en
el informe y alcanza con volver a correrlo. `npm run data -- --refresh` ignora la caché.
Otro servidor: `OVERPASS_URL=https://... npm run data`.

#### Agregar o corregir un lugar

Todo se define en [`scripts/sources/caba.places.json`](scripts/sources/caba.places.json):

- `select`: selector de Overpass (se evalúa dentro del bbox de la ciudad). Cuando el
  elemento correcto está confirmado, conviene fijarlo con `osm` (p. ej. `"way/123"`).
- `symmetry`: `1`, `2`, `4` o `"radial"`. El error de orientación se calcula módulo
  360°/n; `"radial"` excluye al lugar de la orientación.
- `category`: `"stadium"` para el Modo Fútbol (si se omite, es un lugar icónico).
- Orientación de la fachada, en este orden:
  1. nodo `entrance=main` de OSM sobre la huella (`entrance` fija cuál usar) → *calculado*;
  2. `facadeHint` (grados aproximados) ajustado a la pared real más cercana → *manual*;
  3. simetría 2 o 4: eje o lados del rectángulo mínimo de la huella → *calculado*.
- Casos especiales: `mergeCandidates` (lugares partidos en varias vías, como el Puente de
  la Mujer), `containingBuilding` (lugares mapeados como punto: usa el edificio que lo
  contiene), `excludeSize` (huella que no representa el lugar completo),
  `bridgeWidthM`.
- La ilustración va en `src/assets/models/<id>.svg` (o `.png`/`.webp`, mismo id).

Después: `npm run data`, revisar `scripts/reports/caba.md` y la página `/debug.html`
(huella, centroide y flecha de fachada de cada lugar sobre el mapa).

#### Agregar otra ciudad

Crear `src/cities/<ciudad>.ts` (bbox, vista inicial, rutas de datos) y registrarla en
`src/cities/index.ts`; generar su extracto de tiles y su archivo de fuentes en
`scripts/sources/`. El juego, el puntaje y la UI no dependen de la ciudad.

### Puntaje

Todos los parámetros están en [`src/config/scoring.ts`](src/config/scoring.ts):

- Posición: `1000 · exp(−d / 1000 m)`.
- Tamaño (diámetro equivalente = √área): 400 pts si `|log2(jugador/real)| ≤ 0,15`,
  bajando linealmente hasta 0 en 1,5. Lugares con huella menor a 20 m quedan excluidos.
- Orientación: 400 pts con error ≤ 15°, bajando linealmente hasta 0 en 90°.
- Un lugar excluido de un modificador recibe en ese componente la misma proporción que
  sacó en posición (el máximo por lugar es igual para todos).
- El total se multiplica por la dificultad del mapa.

## Deploy

**GitHub Pages (configurado):** cada push a `main` corre
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): instala, corre los tests,
compila con `BASE_PATH=/<repo>/` y publica `dist/`. En el repo, *Settings → Pages →
Source* tiene que estar en **GitHub Actions**.

**Vercel (alternativa):** importar el repo; framework *Vite*, build `npm run build`,
output `dist`. No hace falta `BASE_PATH` (se sirve desde la raíz).

Ambos sirven `caba.pmtiles` con *range requests*, que es lo que necesita PMTiles.

## Estructura

```
scripts/          preparación de datos (tiles, fuentes, OSM) y sus fuentes/informes
public/           tiles, fuentes y datos generados (servidos tal cual)
src/config/       parámetros del juego y del puntaje
src/cities/       configuración por ciudad y tipos de los lugares
src/game/         lógica pura: estado de la partida, puntaje, geometría, récords
src/map/          MapLibre: estilo por nivel, pieza, capas de resultado
src/ui/           pantalla de inicio, menú, panel de juego, arrastrar y soltar
tests/            tests unitarios
```

## Créditos y licencias

- Datos del mapa y de los lugares © [colaboradores de OpenStreetMap](https://www.openstreetmap.org/copyright), licencia ODbL.
- Mapa base: [Protomaps](https://protomaps.com) (extracto PMTiles de OSM).
- Fuente: Noto Sans (SIL Open Font License).
- Ilustraciones de los lugares: SVG propios del proyecto.
