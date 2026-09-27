import { DomainError } from '@as/domain';
import { sql, rows, one, maybeOne, pgArray, type Tx } from '@as/db';

export interface LedgerEntryInput {
  walletId: string;
  amount: number; // signed minor WORLD units
}

export interface LedgerPost {
  /** Globally unique; the ledger's own replay guard (ledger_transactions.idempotency_key). */
  idempotencyKey: string;
  type: string;
  actorResidentId?: string | null;
  relatedType?: string;
  relatedId?: string;
  metadata?: Record<string, unknown>;
  entries: LedgerEntryInput[];
}

/**
 * Blueprint §27–28. One balanced, immutable ledger transaction:
 *   lock wallets in deterministic id order -> validate balances -> pending tx -> entries
 *   -> materialized balances -> posted (DB trigger re-asserts sum = 0).
 * Must be called inside the caller's transaction (after item/listing locks).
 */
export async function postLedger(tx: Tx, p: LedgerPost): Promise<{ transactionId: string; balances: Map<string, number> }> {
  const net = new Map<string, number>();
  for (const e of p.entries) {
    if (!Number.isSafeInteger(e.amount)) throw new Error('ledger amount must be a safe integer');
    net.set(e.walletId, (net.get(e.walletId) ?? 0) + e.amount);
  }
  for (const [k, v] of net) if (v === 0) net.delete(k);
  const sum = [...net.values()].reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new Error(`unbalanced ledger post (${p.type}): sum=${sum}`);
  if (net.size < 2) throw new Error(`ledger post (${p.type}) needs at least two wallets`);

  const ids = [...net.keys()].sort();
  const wallets = await rows<{ id: string; balance: number; allow_negative: boolean; wallet_kind: string }>(tx, sql`
    SELECT id, balance, allow_negative, wallet_kind FROM wallets WHERE id = ANY(${pgArray(ids)}::uuid[]) ORDER BY id FOR UPDATE`);
  if (wallets.length !== ids.length) throw new Error('ledger post references unknown wallet');

  const balances = new Map<string, number>();
  for (const w of wallets) {
    const next = w.balance + (net.get(w.id) ?? 0);
    if (!w.allow_negative && next < 0) {
      throw new DomainError('insufficient_funds', 'Not enough funds.', w.wallet_kind === 'resident' ? { balance: w.balance } : undefined);
    }
    balances.set(w.id, next);
  }

  const txRow = await one<{ id: string }>(tx, sql`
    INSERT INTO ledger_transactions (idempotency_key, transaction_type, actor_resident_id, related_type, related_id, metadata)
    VALUES (${p.idempotencyKey}, ${p.type}, ${p.actorResidentId ?? null}, ${p.relatedType ?? null}, ${p.relatedId ?? null},
            ${JSON.stringify(p.metadata ?? {})}::jsonb)
    RETURNING id`);

  for (const id of ids) {
    const amount = net.get(id)!;
    await tx.execute(sql`INSERT INTO ledger_entries (transaction_id, wallet_id, amount) VALUES (${txRow.id}, ${id}, ${amount})`);
    await tx.execute(sql`UPDATE wallets SET balance = balance + ${amount}, updated_at = now() WHERE id = ${id}`);
  }
  await tx.execute(sql`UPDATE ledger_transactions SET status = 'posted' WHERE id = ${txRow.id}`);
  return { transactionId: txRow.id, balances };
}

export async function systemWalletId(tx: Tx, code: 'MINT' | 'SYSTEM_SINK'): Promise<string> {
  const w = await maybeOne<{ id: string }>(tx, sql`
    SELECT id FROM wallets WHERE system_code = ${code} AND currency_code = 'WORLD' AND wallet_kind IN ('mint','sink','system')`);
  if (!w) throw new Error(`system wallet ${code} missing (run db:seed)`);
  return w.id;
}

export async function residentWalletId(tx: Tx, residentId: string): Promise<string> {
  const w = await maybeOne<{ id: string }>(tx, sql`
    SELECT id FROM wallets WHERE wallet_kind = 'resident' AND resident_id = ${residentId} AND currency_code = 'WORLD'`);
  if (!w) throw new Error('resident wallet missing');
  return w.id;
}
