export type AccessMode = 'open' | 'closed';

export interface AccessInputs {
  accessMode: AccessMode;
  awayAccessMode: AccessMode;
  /** true when the owner currently has an active foreign Stay. */
  ownerAway: boolean;
}

/**
 * Blueprint §11.3 / SQL invariant 10:
 *   effective public access = access_mode='open' AND (owner not away OR away_access_mode='open')
 * The owner is always allowed into their own property (checked by callers).
 */
export function isPubliclyEnterable(a: AccessInputs): boolean {
  if (a.accessMode !== 'open') return false;
  if (a.ownerAway && a.awayAccessMode !== 'open') return false;
  return true;
}
