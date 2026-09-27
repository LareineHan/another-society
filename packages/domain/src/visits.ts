/**
 * Owner-facing soft language for anonymous visit aggregates (Blueprint §12).
 * Exact counts stay server-side unless the `visits.exact_counts` experiment flag is on.
 * DEV_PLACEHOLDER thresholds (Part XX: exact soft-language thresholds are open).
 */
export type VisitBand = 'none' | 'someone' | 'a_few' | 'busy';

export function visitBand(count: number): VisitBand {
  if (count <= 0) return 'none';
  if (count === 1) return 'someone';
  if (count <= 4) return 'a_few';
  return 'busy';
}

export const VISIT_BAND_COPY: Record<VisitBand, string> = {
  none: '',
  someone: 'Someone stopped by.',
  a_few: 'A few people stopped by.',
  busy: 'It was a little busy while you were away.',
};
