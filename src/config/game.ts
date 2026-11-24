/** General game parameters. Scoring parameters live in ./scoring.ts. */
export const ROUNDS_PER_GAME = 7;

export type MapLevel = "easy" | "medium" | "hard";

export const MAP_LEVELS: Record<MapLevel, { label: string; multiplier: number }> = {
  easy: { label: "Fácil", multiplier: 1 },
  medium: { label: "Medio", multiplier: 1.5 },
  hard: { label: "Difícil", multiplier: 2 },
};
