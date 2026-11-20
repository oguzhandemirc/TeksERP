// "ŞİMDİ EŞİTLE" (D8) — hesap fabrikadan erken eşitleme ister. Bulut hesap yapmaz ve fabrikaya bağlanmaz: tesis başına
// TEK durum satırına (`sync_requests`) işaret yazar, `rapor` zilini çalar (best-effort); fabrika bir sonraki imzalı
// `rapor/al` yoklamasında işareti AYNI tx'te atomik tüketir (`consumeSyncRequest`) ve kendi turunu koşar.
// Kötüye kullanım seddi WHERE'dedir (atomik): iki kabul arası ≥ 60 sn, iki TAM arası ≥ 15 dk; aralıktaki istek işaret açmaz.
import { Prisma } from "@prisma/client";
import type { SessionContext } from "../auth/session.service";
import { accountActor, recordAudit } from "../lib/audit";
import type { Tx } from "../lib/db";
import { withTesis } from "../lib/tenant";
import { SYNC_NOW_FULL_GAP_MS, SYNC_NOW_MIN_GAP_MS, type SyncNowResponse, type SyncNowScope } from "../wire/api";
import type { CloudContext } from "./context";
import { assertFacilityCloudOpen } from "./facility-gate";

interface MarkRow {
  scope: string;
  requested_at: Date;
  full_requested_at: Date | null;
}

const scopeOf = (v: string): SyncNowScope => (v === "TAM" ? "TAM" : "KISMI");

function nextAllowed(row: MarkRow, scope: SyncNowScope): Date {
  const gap = row.requested_at.getTime() + SYNC_NOW_MIN_GAP_MS;
  const full = scope === "TAM" && row.full_requested_at ? row.full_requested_at.getTime() + SYNC_NOW_FULL_GAP_MS : 0;
  return new Date(Math.max(gap, full));
}

export async function requestSyncNow(ctx: CloudContext, s: SessionContext, scope: SyncNowScope): Promise<SyncNowResponse> {
  const nowMs = ctx.now();
  await assertFacilityCloudOpen(ctx, s.tesisId, nowMs);
  const now = new Date(nowMs);
  const gapEdge = new Date(nowMs - SYNC_NOW_MIN_GAP_MS);
  const fullEdge = new Date(nowMs - SYNC_NOW_FULL_GAP_MS);
  const full = scope === "TAM" ? now : null;
  const out = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => {
    // Bekleyen TAM işaret KISMI istekle küçülmez; aralık koşulu tek ifadede (eşzamanlı iki istek tek işaret açar).
    const won = await tx.$queryRaw<MarkRow[]>`
      INSERT INTO sync_requests (id, tesis_id, pending, scope, account_id, requested_at, full_requested_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${s.tesisId}::uuid, true, ${scope}, ${s.accountId}::uuid, ${now}::timestamptz, ${full}::timestamptz, now(), now())
      ON CONFLICT (tesis_id) DO UPDATE SET
        pending = true,
        scope = CASE WHEN sync_requests.pending AND sync_requests.scope = 'TAM' THEN 'TAM' ELSE EXCLUDED.scope END,
        account_id = EXCLUDED.account_id,
        requested_at = EXCLUDED.requested_at,
        full_requested_at = COALESCE(EXCLUDED.full_requested_at, sync_requests.full_requested_at),
        consumed_at = NULL,
        updated_at = now()
      WHERE sync_requests.requested_at <= ${gapEdge}::timestamptz
        AND (${scope} <> 'TAM' OR sync_requests.full_requested_at IS NULL OR sync_requests.full_requested_at <= ${fullEdge}::timestamptz)
      RETURNING scope, requested_at, full_requested_at`;
    if (won[0]) return { accepted: true, row: won[0] };
    const cur = await tx.$queryRaw<MarkRow[]>`SELECT scope, requested_at, full_requested_at FROM sync_requests WHERE tesis_id = ${s.tesisId}::uuid`;
    return { accepted: false, row: cur[0]! };
  });
  if (!out.accepted) return { durum: "YAKIN_ZAMANDA", kapsam: scope, sonrakiMumkun: nextAllowed(out.row, scope).toISOString() };
  ctx.doorbell.ring(s.tesisId, "rapor");
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "ESITLEME_ISTEGI", entity: "SyncRequest", entityId: s.tesisId, summary: { kapsam: scopeOf(out.row.scope) } });
  return { durum: "BEKLIYOR", kapsam: scopeOf(out.row.scope), sonrakiMumkun: nextAllowed(out.row, scope).toISOString() };
}

/** Fabrika claim'i (eşitleme rolü, claim tx'inin içinde): bekleyen işaret atomik tüketilir; yoksa null. */
export async function consumeSyncRequest(tx: Tx, tesisId: string, nowMs: number): Promise<{ kapsam: SyncNowScope; istendi: string } | null> {
  const rows = await tx.$queryRaw<MarkRow[]>(Prisma.sql`
    UPDATE sync_requests SET pending = false, consumed_at = ${new Date(nowMs)}::timestamptz, updated_at = now()
     WHERE tesis_id = ${tesisId}::uuid AND pending
    RETURNING scope, requested_at, full_requested_at`);
  const r = rows[0];
  return r ? { kapsam: scopeOf(r.scope), istendi: r.requested_at.toISOString() } : null;
}
