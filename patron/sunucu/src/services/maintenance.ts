// BAKIM İŞİ — süreç içi zamanlayıcı (dakikalık tik + günde bir budama). Tesis listesi bakım kipinde,
// her satır işi o tesisin kiracı kapsamında (RLS) koşar.
//   · Tik: süresi dolan claim'ler — gelen kutusu ISLENIYOR → BEKLIYOR (fabrikanın makbuzu tekrarı
//     idempotent kılar); rapor HESAPLANIYOR → BEKLIYOR (bir kez), ikincide HATA `ZAMAN_ASIMI`.
//   · Günlük: SAKLAMA (tesis başına 3 · 13 · 25 ay · tümü) + telemetri/ayak izi budaması.
// Hard delete YALNIZ burada ve YALNIZ `PRUNED_TABLES` beyanındaki tablolarda (bekçi
// `test_patron_kapilari` ölçer). Budanan hiçbir satır fabrikanın defteri değildir: bulut okuma
// kopyası + kanal durumu + telemetridir; iş kararı bunlardan okunmaz.
import { allProjectionNames, ROOT_PROJECTIONS, type RootProjection } from "../catalog/projections";
import { allReportProjections } from "../catalog/reports";
import type { Tx } from "../lib/db";
import { withMaintenanceList, withTesis } from "../lib/tenant";
import type { CloudContext } from "./context";

/** Yaşa göre hard delete izni olan tablolar (beyan) → gerekçe. Başka her silme yasak. */
export const PRUNED_TABLES = {
  projection_rows: "OLGU saklama süresi dolan satır (+ alt satırı + kalemi) · 7 günden eski mezar taşı",
  request_nonces: "istek zamanı + 10 dk geçti (telemetri)",
  package_receipts: "PAKET_SAKLAMA_GUN (idempotency penceresi)",
  full_sync_runs: "tamamlanmış + PAKET_SAKLAMA_GUN",
  report_results: "RAPOR_SONUC_SAKLAMA_GUN",
  report_requests: "sonuçlanmış + RAPOR_SONUC_SAKLAMA_GUN",
  inbox_messages: "sonuçlanmış + tesisin saklama süresi (asıl kayıt fabrikada)",
  sessions: "kapanmış/bitmiş + OTURUM_SAKLAMA_GUN (telemetri)",
  operation_receipts: "ISLEM_SAKLAMA_GUN (işlem kimliği penceresi)",
  account_audit: "ayak izi: başarısız giriş DENETIM_GIRIS_SAKLAMA_GUN · diğerleri DENETIM_SAKLAMA_GUN",
} as const;

const DAY_MS = 86_400_000;
const TOMBSTONE_DAYS = 7;
const FAILED_LOGIN_EVENTS = ["GIRIS_BASARISIZ", "GIRIS_REDDEDILDI", "HESAP_GECICI_KILIT"];

function monthsBefore(nowMs: number, months: number): Date {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

async function listFacilities(ctx: CloudContext): Promise<{ tesisId: string; retentionMonths: number | null }[]> {
  return withMaintenanceList(ctx.sync, (tx) => tx.facility.findMany({ select: { tesisId: true, retentionMonths: true }, orderBy: { tesisId: "asc" } }));
}

// ---------------------------------------------------------------- tik: claim süresi

export async function expireClaims(ctx: CloudContext, nowMs: number): Promise<{ inbox: number; reportRetry: number; reportFailed: number }> {
  const now = new Date(nowMs);
  const total = { inbox: 0, reportRetry: 0, reportFailed: 0 };
  for (const f of await listFacilities(ctx)) {
    await withTesis(ctx.sync, { tesisId: f.tesisId }, async (tx) => {
      total.inbox += (
        await tx.inboxMessage.updateMany({ where: { tesisId: f.tesisId, status: "ISLENIYOR", claimUntil: { lt: now } }, data: { status: "BEKLIYOR", ownerInstallationId: null, claimUntil: null } })
      ).count;
      total.reportRetry += (
        await tx.reportRequest.updateMany({
          where: { tesisId: f.tesisId, status: "HESAPLANIYOR", claimUntil: { lt: now }, claimCount: { lt: 2 } },
          data: { status: "BEKLIYOR", ownerInstallationId: null, claimUntil: null },
        })
      ).count;
      total.reportFailed += (
        await tx.reportRequest.updateMany({
          where: { tesisId: f.tesisId, status: "HESAPLANIYOR", claimUntil: { lt: now }, claimCount: { gte: 2 } },
          data: { status: "HATA", errorCode: "ZAMAN_ASIMI", claimUntil: null, completedAt: now },
        })
      ).count;
    });
  }
  return total;
}

// ---------------------------------------------------------------- günlük: saklama + budama

async function deleteByIds(tx: Tx, tesisId: string, projection: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return tx.$executeRaw`DELETE FROM projection_rows WHERE tesis_id = ${tesisId}::uuid AND projection = ${projection} AND record_id = ANY(${ids}::uuid[])`;
}

/** Kökü düşen kaydın alt satırları ve kalemleri (kalemin de alt satırları) birlikte düşer. */
async function cascadeRoot(tx: Tx, tesisId: string, root: RootProjection, ids: readonly string[]): Promise<number> {
  let n = 0;
  for (const sub of root.subRows ?? []) n += await deleteByIds(tx, tesisId, `${root.name}.${sub}`, ids);
  for (const child of ROOT_PROJECTIONS.filter((c) => c.parent?.projection === root.name)) {
    const gone = await tx.$queryRaw<{ record_id: string }[]>`
      DELETE FROM projection_rows WHERE tesis_id = ${tesisId}::uuid AND projection = ${child.name}
         AND data->>${child.parent!.field} = ANY(${ids}::text[])
      RETURNING record_id`;
    n += gone.length + (await cascadeRoot(tx, tesisId, child, gone.map((g) => g.record_id)));
  }
  return n;
}

async function pruneProjections(tx: Tx, tesisId: string, retentionMonths: number | null, nowMs: number): Promise<number> {
  let n = 0;
  if (retentionMonths !== null) {
    const cutoff = monthsBefore(nowMs, retentionMonths);
    for (const root of ROOT_PROJECTIONS.filter((r) => r.kind === "OLGU" && r.retentionFields?.length)) {
      const gone = await tx.$queryRaw<{ record_id: string }[]>`
        DELETE FROM projection_rows WHERE tesis_id = ${tesisId}::uuid AND projection = ${root.name}
           AND retention_at IS NOT NULL AND retention_at < ${cutoff}::timestamptz
        RETURNING record_id`;
      n += gone.length + (await cascadeRoot(tx, tesisId, root, gone.map((g) => g.record_id)));
    }
  }
  const tombstoneCutoff = new Date(nowMs - TOMBSTONE_DAYS * DAY_MS);
  n += await tx.$executeRaw`DELETE FROM projection_rows WHERE tesis_id = ${tesisId}::uuid AND deleted_at IS NOT NULL AND deleted_at < ${tombstoneCutoff}::timestamptz`;
  return n;
}

async function pruneSyncTables(ctx: CloudContext, f: { tesisId: string; retentionMonths: number | null }, nowMs: number): Promise<number> {
  const c = ctx.config;
  const scope = { tesisId: f.tesisId, projections: [...allProjectionNames(), ...allReportProjections()], timeoutMs: 120_000 };
  return withTesis(ctx.sync, scope, async (tx) => {
    let n = await pruneProjections(tx, f.tesisId, f.retentionMonths, nowMs);
    n += (await tx.requestNonce.deleteMany({ where: { tesisId: f.tesisId, expiresAt: { lt: new Date(nowMs) } } })).count;
    n += (await tx.packageReceipt.deleteMany({ where: { tesisId: f.tesisId, createdAt: { lt: new Date(nowMs - c.PAKET_SAKLAMA_GUN * DAY_MS) } } })).count;
    n += (await tx.fullSyncRun.deleteMany({ where: { tesisId: f.tesisId, completedAt: { lt: new Date(nowMs - c.PAKET_SAKLAMA_GUN * DAY_MS) } } })).count;
    n += (await tx.reportResult.deleteMany({ where: { tesisId: f.tesisId, createdAt: { lt: new Date(nowMs - c.RAPOR_SONUC_SAKLAMA_GUN * DAY_MS) } } })).count;
    return n;
  });
}

async function pruneAccountTables(ctx: CloudContext, f: { tesisId: string; retentionMonths: number | null }, nowMs: number): Promise<number> {
  const c = ctx.config;
  return withTesis(ctx.app, { tesisId: f.tesisId }, async (tx) => {
    const sessionCutoff = new Date(nowMs - c.OTURUM_SAKLAMA_GUN * DAY_MS);
    let n = (
      await tx.session.deleteMany({ where: { tesisId: f.tesisId, OR: [{ closedAt: { lt: sessionCutoff } }, { closedAt: null, expiresAt: { lt: sessionCutoff } }] } })
    ).count;
    n += (await tx.operationReceipt.deleteMany({ where: { tesisId: f.tesisId, createdAt: { lt: new Date(nowMs - c.ISLEM_SAKLAMA_GUN * DAY_MS) } } })).count;
    n += (
      await tx.accountAudit.deleteMany({
        where: {
          tesisId: f.tesisId,
          OR: [
            { event: { in: FAILED_LOGIN_EVENTS }, createdAt: { lt: new Date(nowMs - c.DENETIM_GIRIS_SAKLAMA_GUN * DAY_MS) } },
            { createdAt: { lt: new Date(nowMs - c.DENETIM_SAKLAMA_GUN * DAY_MS) } },
          ],
        },
      })
    ).count;
    n += (
      await tx.reportRequest.deleteMany({
        where: { tesisId: f.tesisId, status: { in: ["HAZIR", "HATA", "IPTAL"] }, updatedAt: { lt: new Date(nowMs - c.RAPOR_SONUC_SAKLAMA_GUN * DAY_MS) } },
      })
    ).count;
    if (f.retentionMonths !== null) {
      n += (
        await tx.inboxMessage.deleteMany({
          where: { tesisId: f.tesisId, status: { in: ["ISLENDI", "REDDEDILDI", "IPTAL"] }, createdAt: { lt: monthsBefore(nowMs, f.retentionMonths) } },
        })
      ).count;
    }
    return n;
  });
}

export async function runDaily(ctx: CloudContext, nowMs: number): Promise<number> {
  let n = 0;
  for (const f of await listFacilities(ctx)) {
    n += await pruneSyncTables(ctx, f, nowMs);
    n += await pruneAccountTables(ctx, f, nowMs);
  }
  return n;
}

export class MaintenanceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastDailyDay: string | null = null;

  constructor(private readonly ctx: CloudContext) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.ctx.config.BAKIM_ARALIGI_SN * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Tek tur (bekçi saati enjekte eder). Günlük budama UTC gün başına bir kez. */
  async runOnce(nowMs: number = this.ctx.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await expireClaims(this.ctx, nowMs);
      const day = new Date(nowMs).toISOString().slice(0, 10);
      if (this.lastDailyDay !== day) {
        const n = await runDaily(this.ctx, nowMs);
        this.lastDailyDay = day;
        if (n > 0) console.log(`[patron] bakım: ${n} satır budandı (saklama + telemetri)`);
      }
    } catch (err) {
      console.error(`[patron] bakım turu başarısız: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

