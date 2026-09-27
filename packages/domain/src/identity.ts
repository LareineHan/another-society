import { DomainError } from './errors';

/** Blueprint §14.5: 1–24 grapheme clusters, NFC-normalized. */
export const DISPLAY_NAME_MAX_GRAPHEMES = 24;

// C0/C1 controls, bidi embeddings/overrides/isolates, and invisible formatting that enables spoofing.
// U+200D (ZWJ) is allowed because emoji sequences need it; it is rejected when it appears alone at an edge.
const FORBIDDEN_CHARS = /[\p{Cc}​‌‎‏‪-‮⁠-⁤⁦-⁩﻿￹-￻]/u;

/**
 * DEV_PLACEHOLDER screening list. Production screening must be replaced with a maintained
 * multilingual list/service (Blueprint §14.6). Kept deliberately tiny here.
 */
const BLOCKED_TERMS = ['admin', 'moderator', 'implemon', 'official'];

let segmenter: Intl.Segmenter | undefined;
export function graphemeCount(s: string): number {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

/** Comparison/screening form: NFKC + lowercase, whitespace collapsed. Never used as a key. */
export function normalizeForMatch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export interface ValidDisplayName {
  displayName: string;
  displayNameNorm: string;
}

export function validateDisplayName(input: unknown): ValidDisplayName {
  if (typeof input !== 'string') throw new DomainError('validation_error', 'Display name is required.', { field: 'display_name' });
  const nfc = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (FORBIDDEN_CHARS.test(nfc) || /^‍|‍$/u.test(nfc)) {
    throw new DomainError('validation_error', 'Display name contains characters that are not allowed.', { field: 'display_name', reason: 'forbidden_characters' });
  }
  const count = graphemeCount(nfc);
  if (count < 1 || count > DISPLAY_NAME_MAX_GRAPHEMES) {
    throw new DomainError('validation_error', `Display name must be 1–${DISPLAY_NAME_MAX_GRAPHEMES} characters.`, { field: 'display_name', reason: 'length' });
  }
  const norm = normalizeForMatch(nfc);
  const squashed = norm.replace(/[^\p{L}\p{N}]/gu, '');
  if (BLOCKED_TERMS.some((t) => squashed.includes(t))) {
    throw new DomainError('validation_error', 'Please choose a different display name.', { field: 'display_name', reason: 'screened' });
  }
  return { displayName: nfc, displayNameNorm: norm };
}

/** Crockford-style alphabet without 0/O/1/I/L/U to avoid confusion. */
const TAG_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PUBLIC_TAG_LENGTH = 6;

export function generatePublicTag(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(PUBLIC_TAG_LENGTH * 2);
  let out = '';
  for (let i = 0; out.length < PUBLIC_TAG_LENGTH && i < bytes.length; i++) {
    const b = bytes[i]!;
    // rejection sampling to avoid modulo bias
    if (b < 256 - (256 % TAG_ALPHABET.length)) out += TAG_ALPHABET[b % TAG_ALPHABET.length];
  }
  return out.length === PUBLIC_TAG_LENGTH ? out : generatePublicTag(random);
}

function defaultRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export const DEFAULT_DISPLAY_NAME = 'Newcomer';
