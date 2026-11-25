import { ROUNDS_PER_GAME } from "../config/game";
import type { Place } from "../cities/placeTypes";
import { scorePlacement, type GameOptions, type Placement, type ScoreBreakdown } from "./scoring";

/**
 * Game flow, independent of the DOM and the map:
 *   placing   -> the current piece is still in the panel
 *   adjusting -> dropped on the map, can be moved (and resized/rotated with modifiers)
 *   result    -> confirmed; score shown, waiting for "next"
 *   finished  -> all rounds played
 */
export type Phase = "placing" | "adjusting" | "result" | "finished";

export interface RoundState {
  place: Place;
  placement: Placement | null;
  score: ScoreBreakdown | null;
}

export interface GameState {
  options: GameOptions;
  rounds: RoundState[];
  current: number;
  phase: Phase;
}

export type Rng = () => number;

/** Which places a game draws from. */
export type PlaceSet = "all" | "stadiums" | "landmarks";

export function filterPlaces(places: Place[], set: PlaceSet): Place[] {
  if (set === "stadiums") return places.filter((p) => p.category === "stadium");
  if (set === "landmarks") return places.filter((p) => p.category !== "stadium");
  return places;
}

export function countBySet(places: Place[]): Record<PlaceSet, number> {
  return {
    all: places.length,
    stadiums: filterPlaces(places, "stadiums").length,
    landmarks: filterPlaces(places, "landmarks").length,
  };
}

/** Fisher-Yates on a copy; picks `count` distinct places. */
export function pickPlaces(places: Place[], count: number, rng: Rng = Math.random): Place[] {
  const pool = [...places];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

export function newGame(places: Place[], options: GameOptions, rng: Rng = Math.random, rounds = ROUNDS_PER_GAME): GameState {
  return {
    options,
    rounds: pickPlaces(places, rounds, rng).map((place) => ({ place, placement: null, score: null })),
    current: 0,
    phase: "placing",
  };
}

export function currentRound(state: GameState): RoundState {
  return state.rounds[state.current];
}

/** Drop or move the current piece. Starting values for size/rotation come from the caller. */
export function placePiece(state: GameState, placement: Partial<Placement> & Pick<Placement, "center">): GameState {
  if (state.phase !== "placing" && state.phase !== "adjusting") return state;
  const round = currentRound(state);
  const prev = round.placement ?? { center: placement.center, sizeRatio: 1, bearing: 0 };
  const next: RoundState = { ...round, placement: { ...prev, ...placement } };
  return { ...state, rounds: replaceAt(state.rounds, state.current, next), phase: "adjusting" };
}

export function confirmPiece(state: GameState): GameState {
  if (state.phase !== "adjusting") return state;
  const round = currentRound(state);
  const score = scorePlacement(round.place, round.placement!, state.options);
  return { ...state, rounds: replaceAt(state.rounds, state.current, { ...round, score }), phase: "result" };
}

export function nextRound(state: GameState): GameState {
  if (state.phase !== "result") return state;
  const last = state.current >= state.rounds.length - 1;
  return last ? { ...state, phase: "finished" } : { ...state, current: state.current + 1, phase: "placing" };
}

export function totalScore(state: GameState): number {
  return state.rounds.reduce((sum, r) => sum + (r.score?.total ?? 0), 0);
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  const copy = [...list];
  copy[index] = value;
  return copy;
}
