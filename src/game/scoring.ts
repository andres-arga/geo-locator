import { distance } from "@turf/turf";
import { SCORING } from "../config/scoring";
import { MAP_LEVELS, ROUNDS_PER_GAME, TIMER_MODES, type MapLevel, type TimerMode } from "../config/game";
import type { Place, Symmetry } from "../cities/placeTypes";

export interface GameOptions {
  level: MapLevel;
  size: boolean;
  orientation: boolean;
  /** Contrarreloj mode; omitted or "off" = no clock. */
  timer?: TimerMode;
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
  /** Contrarreloj bonus for the leftover time (points before multipliers). */
  timeBonus?: { points: number; secondsLeft: number; seconds: number };
  /** True when the clock ran out before the piece was dropped (scores 0). */
  timedOut?: boolean;
  subtotal: number;
  /** Map level multiplier × contrarreloj multiplier. */
  multiplier: number;
  total: number;
}

/** Map level × contrarreloj multiplier. */
export function totalMultiplier(options: GameOptions): number {
  return MAP_LEVELS[options.level].multiplier * TIMER_MODES[options.timer ?? "off"].multiplier;
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

export function scorePlacement(place: Place, placement: Placement, options: GameOptions, secondsLeft?: number): ScoreBreakdown {
  const distanceM = distance(placement.center, place.centroid, { units: "meters" });
  const posPts = positionPoints(distanceM);
  const result: ScoreBreakdown = {
    distanceM,
    position: { points: posPts, max: SCORING.position.max, compensated: false },
    subtotal: 0,
    multiplier: totalMultiplier(options),
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
  const seconds = TIMER_MODES[options.timer ?? "off"].seconds;
  if (seconds !== null && secondsLeft !== undefined) {
    // Faster = more points: up to +timeBonusMax of what the place scored.
    const left = Math.min(seconds, Math.max(0, secondsLeft));
    const points = result.subtotal * SCORING.timeBonusMax * (left / seconds);
    result.timeBonus = { points, secondsLeft: left, seconds };
    result.subtotal += points;
  }
  result.total = Math.round(result.subtotal * result.multiplier);
  return result;
}

export function maxPointsPerItem(options: GameOptions): number {
  const base =
    SCORING.position.max +
    (options.size ? SCORING.size.max : 0) +
    (options.orientation ? SCORING.orientation.max : 0);
  const bonus = TIMER_MODES[options.timer ?? "off"].seconds !== null ? 1 + SCORING.timeBonusMax : 1;
  return base * bonus * totalMultiplier(options);
}

/** Score of a place whose clock ran out before the piece was dropped. */
export function timedOutScore(options: GameOptions): ScoreBreakdown {
  const zero = (max: number): ComponentScore => ({ points: 0, max, compensated: false });
  return {
    distanceM: NaN,
    position: zero(SCORING.position.max),
    ...(options.size ? { size: zero(SCORING.size.max) } : {}),
    ...(options.orientation ? { orientation: zero(SCORING.orientation.max) } : {}),
    timedOut: true,
    subtotal: 0,
    multiplier: totalMultiplier(options),
    total: 0,
  };
}

export function maxPointsPerGame(options: GameOptions, rounds = ROUNDS_PER_GAME): number {
  return Math.round(maxPointsPerItem(options) * rounds);
}
