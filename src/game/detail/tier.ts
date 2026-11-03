/**
 * Detail tiers. LOW and MEDIUM must stay exactly as cheap as before: every extra
 * piece of geometry, shader patch or animated thing is gated on one of these.
 */
export interface TierOpt {
  low: boolean;
  density: number;
  ultra?: boolean;
}

/** high tier and up (density 1 on high, 1.5 on ultra) */
export const isHigh = (o: TierOpt) => !o.low && o.density >= 1;
/** the maximum-detail tier, chosen explicitly by the visitor */
export const isUltra = (o: TierOpt) => !!o.ultra;
/** 0 = low / medium, 1 = high, 2 = ultra */
export const level = (o: TierOpt): 0 | 1 | 2 => (isUltra(o) ? 2 : isHigh(o) ? 1 : 0);
