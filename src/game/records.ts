import type { MapLevel } from "../config/game";
import type { PlaceSet } from "./state";

/** Options that define a comparable game (same max score and difficulty). */
export interface RecordOptions {
  placeSet: PlaceSet;
  level: MapLevel;
  size: boolean;
  orientation: boolean;
  streetNames: boolean;
}

export interface BestScore {
  score: number;
  max: number;
  /** ISO date of the record. */
  date: string;
}

/** Minimal storage surface (localStorage, or a fake in tests). */
export type KV = Pick<Storage, "getItem" | "setItem">;

/** Street names only exist (and help) on the easy level. */
export function recordKey(city: string, o: RecordOptions): string {
  const names = o.level === "easy" && o.streetNames ? ":names" : "";
  return `geo-locator:best:${city}:${o.placeSet}:${o.level}:size${o.size ? 1 : 0}:ori${o.orientation ? 1 : 0}${names}`;
}

function defaultStore(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // blocked storage
  }
}

export function getBest(key: string, store: KV | null = defaultStore()): BestScore | null {
  try {
    const raw = JSON.parse(store?.getItem(key) ?? "null");
    return raw && typeof raw.score === "number" ? raw : null;
  } catch {
    return null;
  }
}

/** Save the score if it beats the previous best; reports what happened. */
export function recordScore(
  key: string,
  score: number,
  max: number,
  store: KV | null = defaultStore(),
  now: Date = new Date(),
): { previous: BestScore | null; isRecord: boolean } {
  const previous = getBest(key, store);
  const isRecord = score > 0 && (!previous || score > previous.score);
  if (isRecord) {
    try {
      store?.setItem(key, JSON.stringify({ score, max, date: now.toISOString() } satisfies BestScore));
    } catch {
      /* storage full or blocked: the record just is not kept */
    }
  }
  return { previous, isRecord };
}
