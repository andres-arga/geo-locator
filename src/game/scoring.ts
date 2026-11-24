import { distance } from "@turf/turf";
import { SCORING } from "../config/scoring";
import { MAP_LEVELS, ROUNDS_PER_GAME, type MapLevel } from "../config/game";
import type { Place, Symmetry } from "../cities/placeTypes";

export interface GameOptions {
  level: MapLevel;
  size: boolean;
  orientation: boolean;
}

/** What the player committed for one place. */
export interface Placement {
  center: [number, number];
  /** Player diameter / real diameter (1 = exact). Ignored if the size modifier is off. */
  sizeRatio: number;
  /** Facade bearing chosen by the player, degrees. Ignored if orientation is off. */
  bearing: number;
}

export interface ComponentScore {
  points: number;
  max: number;
  /** True when the place is excluded from this modifier and the points are compensated. */
  compensated: boolean;
}

export interface ScoreBreakdown {
  distanceM: number;
  position: ComponentScore;
  size?: ComponentScore & { errorLog2?: number; errorPct?: number };
  orientation?: ComponentScore & { errorDeg?: number };
  subtotal: number;
  multiplier: number;
  total: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const EPS = 1e-9; // so an error exactly at a threshold survives float rounding

/** 1 when error <= full, 0 when error >= zero, linear in between. */
function linearFalloff(error: number, full: number, zero: number): number {
  if (error <= full + EPS) return 1;
  if (error >= zero - EPS) return 0;
  return clamp01((zero - error) / (zero - full));
}

export function positionPoints(distanceM: number): number {
  const { max, kMeters } = SCORING.position;
  return max * Math.exp(-Math.max(0, distanceM) / kMeters);
}

export function sizeError(ratio: number): number {
  if (!(ratio > 0)) return Infinity;
  return Math.abs(Math.log2(ratio));
}

export function sizePoints(ratio: number): number {
  const { max, fullErrorLog2, zeroErrorLog2 } = SCORING.size;
  return max * linearFalloff(sizeError(ratio), fullErrorLog2, zeroErrorLog2);
}

/**
 * Smallest angle between two bearings, honouring rotational symmetry:
 * with symmetry n the shape repeats every 360/n degrees.
 */
export function angularError(a: number, b: number, symmetry: Symmetry = 1): number {
  if (symmetry === "radial") return 0;
  const period = 360 / symmetry;
  const d = (((a - b) % period) + period) % period;
  return Math.min(d, period - d);
}

export function orientationPoints(errorDeg: number): number {
  const { max, fullErrorDeg, zeroErrorDeg } = SCORING.orientation;
  return max * linearFalloff(errorDeg, fullErrorDeg, zeroErrorDeg);
}

/**
 * Compensation for places excluded from a modifier (tiny footprint, radial
 * symmetry): the component scores the same fraction as the position did, so the
 * maximum per item is identical for every place and nothing is given away.
 */
function compensated(max: number, positionPts: number): ComponentScore {
  return { points: max * (positionPts / SCORING.position.max), max, compensated: true };
}

export function scorePlacement(place: Place, placement: Placement, options: GameOptions): ScoreBreakdown {
  const distanceM = distance(placement.center, place.centroid, { units: "meters" });
  const posPts = positionPoints(distanceM);
  const result: ScoreBreakdown = {
    distanceM,
    position: { points: posPts, max: SCORING.position.max, compensated: false },
    subtotal: 0,
    multiplier: MAP_LEVELS[options.level].multiplier,
    total: 0,
  };

  if (options.size) {
    const max = SCORING.size.max;
    if (place.modifiers.size) {
      const errorLog2 = sizeError(placement.sizeRatio);
      result.size = {
        points: sizePoints(placement.sizeRatio),
        max,
        compensated: false,
        errorLog2,
        errorPct: (placement.sizeRatio - 1) * 100,
      };
    } else {
      result.size = compensated(max, posPts);
    }
  }

  if (options.orientation) {
    const max = SCORING.orientation.max;
    if (place.modifiers.orientation && place.facadeBearing !== null) {
      const errorDeg = angularError(placement.bearing, place.facadeBearing, place.symmetry);
      result.orientation = { points: orientationPoints(errorDeg), max, compensated: false, errorDeg };
    } else {
      result.orientation = compensated(max, posPts);
    }
  }

  result.subtotal = posPts + (result.size?.points ?? 0) + (result.orientation?.points ?? 0);
  result.total = Math.round(result.subtotal * result.multiplier);
  return result;
}

export function maxPointsPerItem(options: GameOptions): number {
  const base =
    SCORING.position.max +
    (options.size ? SCORING.size.max : 0) +
    (options.orientation ? SCORING.orientation.max : 0);
  return base * MAP_LEVELS[options.level].multiplier;
}

export function maxPointsPerGame(options: GameOptions, rounds = ROUNDS_PER_GAME): number {
  return Math.round(maxPointsPerItem(options) * rounds);
}
