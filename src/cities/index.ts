import { caba } from "./caba";
import type { CityConfig } from "./types";

export const CITIES: Record<string, CityConfig> = { [caba.id]: caba };
export const DEFAULT_CITY = caba.id;
export type { CityConfig, BBox } from "./types";
