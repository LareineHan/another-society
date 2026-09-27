import { DEFAULT_ACTIVATION_POLICY, type ActivationPolicy } from './config';

/**
 * Blueprint §7.2:
 *   target_vacancy = clamp(ceil(max(1, occupied_first_homes) * 0.15), 8, 20)
 */
export function targetVacancy(occupiedFirstHomes: number, policy: ActivationPolicy = DEFAULT_ACTIVATION_POLICY): number {
  const raw = Math.ceil(Math.max(1, occupiedFirstHomes) * policy.ratio);
  return Math.min(policy.max, Math.max(policy.min, raw));
}

export function shouldActivate(
  activeVacantPlots: number,
  occupiedFirstHomes: number,
  policy: ActivationPolicy = DEFAULT_ACTIVATION_POLICY,
): boolean {
  return activeVacantPlots < targetVacancy(occupiedFirstHomes, policy);
}
