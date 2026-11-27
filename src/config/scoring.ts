/** Every scoring parameter lives here. */
export const SCORING = {
  position: { max: 1000, kMeters: 1000 },
  size: { max: 400, fullErrorLog2: 0.15, zeroErrorLog2: 1.5 },
  orientation: { max: 400, fullErrorDeg: 15, zeroErrorDeg: 90 },
  /** Contrarreloj: leftover time adds up to this fraction of the place's points. */
  timeBonusMax: 0.2,
  /** Places whose equivalent diameter is below this are excluded from size scoring. */
  minSizeDiameterM: 20,
} as const;
