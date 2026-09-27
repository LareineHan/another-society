/**
 * Stable machine error codes. Clients switch on `code`; `message` is human-safe.
 * Never put raw SQL/provider errors in a DomainError message.
 */
export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'conflict'
  | 'revision_conflict'
  | 'idempotency_key_required'
  | 'idempotency_mismatch'
  | 'plot_unavailable'
  | 'reservation_invalid'
  | 'already_has_home'
  | 'insufficient_funds'
  | 'stay_not_allowed'
  | 'stay_capacity_full'
  | 'not_staying'
  | 'gift_not_allowed'
  | 'rate_limited'
  | 'account_inactive'
  | 'internal_error';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 422,
  conflict: 409,
  revision_conflict: 409,
  idempotency_key_required: 400,
  idempotency_mismatch: 409,
  plot_unavailable: 409,
  reservation_invalid: 409,
  already_has_home: 409,
  insufficient_funds: 422,
  stay_not_allowed: 403,
  stay_capacity_full: 409,
  not_staying: 404,
  gift_not_allowed: 403,
  rate_limited: 429,
  account_inactive: 403,
  internal_error: 500,
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, status?: number) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code];
    this.details = details;
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
