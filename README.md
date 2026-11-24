# Geo Locator

Minijuego web estático: ubicar lugares icónicos de una ciudad (primero CABA) en el mapa.

## Desarrollo

```bash
npm install
npm run fonts   # glifos para nombres de calles (Noto Sans, OFL)
npm run tiles   # extracto PMTiles de CABA desde build.protomaps.com (requiere CLI pmtiles)
npm run data    # límite, parques y lugares desde Overpass (fase 2)
npm run dev
npm test
```

Datos del mapa © OpenStreetMap contributors (ODbL), tiles vía Protomaps.
