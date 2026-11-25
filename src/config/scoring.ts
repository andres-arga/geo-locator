/** Every scoring parameter lives here. */
export const SCORING = {
  position: { max: 1000, kMeters: 1000 },
  size: { max: 400, fullErrorLog2: 0.15, zeroErrorLog2: 1.5 },
  orientation: { max: 400, fullErrorDeg: 15, zeroErrorDeg: 90 },
  /** Places whose equivalent diameter is below this are excluded from size scoring. */
  minSizeDiameterM: 20,
} as const;
