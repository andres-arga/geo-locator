/**
 * Mini-model registry: place id -> illustration URL. To replace an illustration,
 * drop a new file with the same id in ./models/ (svg, png or webp).
 */
const files = import.meta.glob("./models/*.{svg,png,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const byId = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  const id = path.split("/").pop()!.replace(/\.(svg|png|webp)$/, "");
  byId.set(id, url);
}

export function modelUrl(placeId: string): string | undefined {
  return byId.get(placeId);
}
