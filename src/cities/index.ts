import { caba } from "./caba";
import { cordoba } from "./cordoba";
import type { CityConfig } from "./types";

/** Cities in menu order. */
export const CITY_LIST: CityConfig[] = [caba, cordoba];
export const CITIES: Record<string, CityConfig> = Object.fromEntries(CITY_LIST.map((c) => [c.id, c]));
export const DEFAULT_CITY = caba.id;
export type { CityConfig, BBox } from "./types";
