/** General game parameters. Scoring parameters live in ./scoring.ts. */
export const ROUNDS_PER_GAME = 7;

export type MapLevel = "easy" | "medium" | "hard";

export const MAP_LEVELS: Record<MapLevel, { label: string; multiplier: number }> = {
  easy: { label: "Fácil", multiplier: 1 },
  medium: { label: "Medio", multiplier: 1.5 },
  hard: { label: "Difícil", multiplier: 2 },
};

/** Contrarreloj: seconds per place and score multiplier (independent of the map level). */
export type TimerMode = "off" | "relaxed" | "normal" | "hard";

export const TIMER_MODES: Record<TimerMode, { label: string; seconds: number | null; multiplier: number }> = {
  off: { label: "Sin reloj", seconds: null, multiplier: 1 },
  relaxed: { label: "Relajado", seconds: 90, multiplier: 1.25 },
  normal: { label: "Normal", seconds: 60, multiplier: 1.5 },
  hard: { label: "Exigente", seconds: 30, multiplier: 2 },
};
