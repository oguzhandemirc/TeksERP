// BAKIM İŞİ — süreç içi zamanlayıcı (dakikalık tik + günde bir budama). Tesis listesi merkezden (HAZIR tesis
// DB'leri), her satır işi o tesisin DB'sinde ve kiracı kapsamında (RLS) koşar; bir tesisin hatası ötekini durdurmaz.
//   · Tik: süresi dolan claim'ler — gelen kutusu ISLENIYOR → BEKLIYOR (fabrikanın makbuzu tekrarı
//     idempotent kılar); rapor HESAPLANIYOR → BEKLIYOR (bir kez), ikincide HATA `ZAMAN_ASIMI`; hizmet
//     bitiş damgası (`service-lifecycle.ts`); kapanıştan 30 gün geçen hesabın kimlik silmesi; 30 günü dolan
//     giriş olayının IP alanı (`AGED_FIELDS`).
//   · Günlük: SAKLAMA (tesis başına 3 · 13 · 25 ay · tümü) + telemetri/ayak izi budaması.
// Hard delete YALNIZ burada ve YALNIZ `PRUNED_TABLES` beyanındaki tablolarda (bekçi
// `test_patron_kapilari` ölçer). Budanan hiçbir satır fabrikanın defteri değildir: bulut okuma
// kopyası + kanal durumu + telemetridir; iş kararı bunlardan okunmaz.
import type { Prisma } from "@prisma/client";
import { allProjectionNames, ROOT_PROJECTIONS, type RootProjection } from "../catalog/projections";
import { allReportProjections } from "../catalog/reports";
import { recordAudit } from "../lib/audit";
import type { Tx } from "../lib/db";
import { listReadyFacilities, withCentral, withTesis } from "../lib/tenant";
import type { CloudContext } from "./context";
import { refreshAllServiceEnds } from "./service-lifecycle";

/** Yaşa göre hard delete izni olan tablolar (beyan) → gerekçe. Başka her silme yasak. */
export const PRUNED_TABLES = {
  projection_rows: "OLGU saklama süresi dolan satır (+ alt satırı + kalemi) · 7 günden eski mezar taşı",
  request_nonces: "istek zamanı + 10 dk geçti (telemetri)",
  package_receipts: "PAKET_SAKLAMA_GUN (idempotency penceresi)",
  full_sync_runs: "tamamlanmış + PAKET_SAKLAMA_GUN",
  report_results: "RAPOR_SONUC_SAKLAMA_GUN",
  report_requests: "sonuçlanmış + RAPOR_SONUC_SAKLAMA_GUN",
  inbox_messages: "sonuçlanmış + tesisin saklama süresi (asıl kayıt fabrikada)",
  sessions: "kapanmış/bitmiş + OTURUM_SAKLAMA_GUN (telemetri) · kimliği silinen (kapanıştan IDENTITY_PURGE_DAYS sonra) hesabın bütün oturumları",
  push_devices: "kimliği silinen (kapanıştan IDENTITY_PURGE_DAYS sonra) hesabın bildirim cihaz anahtarları (Ek-6/A §2.4)",
  operation_receipts: "ISLEM_SAKLAMA_GUN (işlem kimliği penceresi)",
  account_audit: "ayak izi: başarısız giriş DENETIM_GIRIS_SAKLAMA_GUN · diğerleri DENETIM_SAKLAMA_GUN",
  notifications: "sonuçlanmış (GONDERILDI · BASARISIZ · ATLANDI) + BILDIRIM_SAKLAMA_GUN (telemetri; olay kimliği günlük/olay başına, pencere ondan uzun)",
  login_routes: "merkez giriş dizini: hedef hesap kendi tesis DB'sinde artık ETKİN değil (yönlendirme önbelleği, kişisel veri taşımaz)",
} as const;

const DAY_MS = 86_400_000;
const TOMBSTONE_DAYS = 7;

/**
 * Kapanan hesabın KİMLİĞİ bu kadar gün sonra silinir (Ek-6/A §2.5, "30 gün içinde") — metnin sözü, ortamdan
 * değiştirilemez. Silinen: ad · e-posta · parola özeti · TOTP sırrı + adımı · davet · kilit sayaçları · oturumlar ·
 * cihaz anahtarları; gelen kutusundaki yazar adı ve işlem makbuzu yanıtlarındaki ad/e-posta tombstone olur. KALAN:
 * satır ve kimliği (iş kayıtları ona bağlı), durum, izinler, tarihler, makbuzun kendisi. Ayak izi
 * `HESAP_KIMLIGI_SILINDI` (imha kaydı, Ek-6/A §6.1).
 */
export const IDENTITY_PURGE_DAYS = 30;

/**
 * Yaşa göre silinen ALANLAR (satır kalır) → gerekçe. Erişim/IP kaydı ZAMAN BAZLIDIR (Ek-6/A §2.4, Ek-3 D: "30 gün"):
 * giriş olaylarının istemci adresi `IP_RETENTION_DAYS` sonra olaydan çıkarılır; olay kendi süresiyle (90 gün / 2 yıl)
 * kalır. Uygulamanın başka hiçbir yeri IP saklamaz (erişim günlüğü satırı yöntem + yol + durum + süredir).
 */
export const AGED_FIELDS = {
  "account_audit.summary.ip": "IP_RETENTION_DAYS (30) — giriş olayının istemci adresi; olay kaydı kendi süresiyle kalır",
} as const;
export const IP_RETENTION_DAYS = 30;

/** Silinmiş hesabın gösterim adı ve e-postası (`.invalid` ayrılmış TLD: gerçek adres olamaz; tekillik kimlikten). */
export const tombstoneName = (accountId: string): string => `Silinmiş hesap #${accountId.slice(0, 8)}`;
export const tombstoneEmail = (accountId: string): string => `silinmis-${accountId}@hesap.invalid`;
const FAILED_LOGIN_EVENTS = ["GIRIS_BASARISIZ", "GIRIS_REDDEDILDI", "HESAP_GECICI_KILIT"];

/**
 * İşlem makbuzu yanıtındaki silinen hesabın kimlik alanları → tombstone: hesap görünümü (`id` = hesap → `ad` ·
 * `eposta`, iç içe dahil) ve makbuz o hesabınsa gelen kutusu yazar adı (`hesapAdi`). Yanıtın biçimi ve öteki alanlar
 * aynen kalır; makbuzun kimliği · eylemi · gövde özeti değişmez ⇒ aynı işlem kimliği aynı (tombstone'lu) yanıtı
 * alır, başka gövde yine 409 (idempotency sözleşmesi bozulmaz).
 */
export function scrubReceiptIdentity(value: unknown, accountId: string, ownReceipt: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => scrubReceiptIdentity(v, accountId, ownReceipt));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrubReceiptIdentity(v, accountId, ownReceipt);
  if (out.id === accountId) {
    if ("ad" in out) out.ad = tombstoneName(accountId);
    if ("eposta" in out) out.eposta = tombstoneEmail(accountId);
  }
  if (ownReceipt && "hesapAdi" in out) out.hesapAdi = tombstoneName(accountId);
  return out;
}

/** Hesabın kimliğini taşıyabilecek makbuzlar (sahibi o hesap ya da yanıtında kimliği geçen) — tombstone yazılan sayı. */
async function scrubReceipts(tx: Tx, tesisId: string, accountId: string): Promise<number> {
  const adaylar = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM operation_receipts
     WHERE tesis_id = ${tesisId}::uuid AND (account_id = ${accountId}::uuid OR strpos(response::text, ${accountId}) > 0)`;
  if (adaylar.length === 0) return 0;
  const rows = await tx.operationReceipt.findMany({ where: { tesisId, id: { in: adaylar.map((a) => a.id) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let n = 0;
  for (const r of rows) {
    const temiz = scrubReceiptIdentity(r.response, accountId, r.accountId === accountId);
    if (JSON.stringify(temiz) === JSON.stringify(r.response)) continue;
    n += (await tx.operationReceipt.updateMany({ where: { id: r.id, tesisId }, data: { response: temiz as Prisma.InputJsonValue } })).count;
  }
  return n;
}

function monthsBefore(nowMs: number, months: number): Date {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Tesis başına iş: hata günlüğe düşer, öteki tesisler sürer (tesis DB'si bakımda/göçü geride olabilir). */
export async function perFacility<T>(tesisId: string, label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[patron] bakım (${label}) tesis ${tesisId}: ${(err as { code?: string }).code ?? (err as Error).message}`);
    return null;
  }
}

async function listFacilities(ctx: CloudContext): Promise<{ tesisId: string; retentionMonths: number | null }[]> {
  const out: { tesisId: string; retentionMonths: number | null }[] = [];
  for (const tesisId of await listReadyFacilities(ctx.sync)) {
    const f = await perFacility(tesisId, "liste", () => withTesis(ctx.sync, { tesisId }, (tx) => tx.facility.findUnique({ where: { tesisId }, select: { tesisId: true, retentionMonths: true } })));
    if (f) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------- tik: claim süresi

export async function expireClaims(ctx: CloudContext, nowMs: number): Promise<{ inbox: number; reportRetry: number; reportFailed: number }> {
  const now = new Date(nowMs);
  const total = { inbox: 0, reportRetry: 0, reportFailed: 0 };
  for (const f of await listFacilities(ctx)) {
    await perFacility(f.tesisId, "claim", () => withTesis(ctx.sync, { tesisId: f.tesisId }, async (tx) => {
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
    }));
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
    n += (
      await tx.notification.deleteMany({
        where: { tesisId: f.tesisId, status: { in: ["GONDERILDI", "BASARISIZ", "ATLANDI"] }, updatedAt: { lt: new Date(nowMs - c.BILDIRIM_SAKLAMA_GUN * DAY_MS) } },
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

// ---------------------------------------------------------------- tik: kapanan hesabın kimliği (Ek-6/A §2.5)

/** Tek tx, `ACCOUNT_ADMIN` kilidi (İLK ifade); hesap başına atomik claim (`PASIF ∧ silinmemiş ∧ kapanış ≤ sınır`). */
export async function purgeClosedIdentities(ctx: CloudContext, tesisId: string, nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - IDENTITY_PURGE_DAYS * DAY_MS);
  const due = { tesisId, status: "PASIF" as const, identityPurgedAt: null, closedAt: { lte: cutoff } };
  const ids = await withTesis(ctx.app, { tesisId }, (tx) => tx.account.findMany({ where: due, select: { id: true } }));
  if (ids.length === 0) return 0;
  const purged = await withTesis(ctx.app, { tesisId, lock: { name: "ACCOUNT_ADMIN", key: tesisId } }, async (tx) => {
    const out: { id: string; oturum: number; cihaz: number; gelenKutusu: number; makbuz: number }[] = [];
    for (const { id } of ids) {
      const claim = await tx.account.updateMany({
        where: { ...due, id },
        data: {
          name: tombstoneName(id),
          email: tombstoneEmail(id),
          passwordHash: null,
          totpSecretSealed: null,
          totpLastStep: null,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          failedLogins: 0,
          lockedUntil: null,
          identityPurgedAt: new Date(nowMs),
        },
      });
      if (claim.count === 0) continue;
      const oturum = (await tx.session.deleteMany({ where: { tesisId, accountId: id } })).count;
      const cihaz = (await tx.pushDevice.deleteMany({ where: { tesisId, accountId: id } })).count;
      const gelenKutusu = (await tx.inboxMessage.updateMany({ where: { tesisId, accountId: id }, data: { accountName: tombstoneName(id) } })).count;
      const makbuz = await scrubReceipts(tx, tesisId, id);
      out.push({ id, oturum, cihaz, gelenKutusu, makbuz });
    }
    return out;
  });
  for (const p of purged) {
    const summary = { kategoriler: ["ad", "eposta", "parola", "totp", "oturum", "cihaz"], oturum: p.oturum, cihaz: p.cihaz, gelenKutusu: p.gelenKutusu, makbuz: p.makbuz };
    await recordAudit(ctx.app, { tesisId, actor: "sistem", event: "HESAP_KIMLIGI_SILINDI", entity: "Account", entityId: p.id, summary });
  }
  return purged.length;
}

/** Tik: 30 günü dolan giriş olaylarından IP alanı çıkarılır (tesis kapsamında; yalnız `ip` anahtarı). */
export async function stripAgedIps(ctx: CloudContext, tesisId: string, nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - IP_RETENTION_DAYS * DAY_MS);
  return withTesis(ctx.app, { tesisId }, (tx) =>
    tx.$executeRaw`UPDATE account_audit SET summary = summary - 'ip'
       WHERE tesis_id = ${tesisId}::uuid AND created_at <= ${cutoff}::timestamptz AND summary ? 'ip'`,
  );
}

/** Merkez giriş dizini: hedefi kendi tesis DB'sinde artık ETKİN olmayan (ya da hiç olmayan) satır silinir. */
export async function pruneLoginRoutes(ctx: CloudContext, tesisId: string): Promise<number> {
  const routes = await withCentral(ctx.sync, {}, (tx) => tx.loginRoute.findMany({ where: { tesisId }, select: { id: true, accountId: true } }));
  if (routes.length === 0) return 0;
  const active = await withTesis(ctx.sync, { tesisId }, (tx) =>
    tx.account.findMany({ where: { tesisId, id: { in: routes.map((r) => r.accountId) }, status: { in: ["AKTIF", "KILITLI"] } }, select: { id: true } }),
  );
  const keep = new Set(active.map((a) => a.id));
  const stale = routes.filter((r) => !keep.has(r.accountId)).map((r) => r.id);
  if (stale.length === 0) return 0;
  return withCentral(ctx.sync, {}, async (tx) => (await tx.loginRoute.deleteMany({ where: { id: { in: stale }, tesisId } })).count);
}

export async function runDaily(ctx: CloudContext, nowMs: number): Promise<number> {
  let n = 0;
  for (const f of await listFacilities(ctx)) {
    n += (await perFacility(f.tesisId, "eşitleme budaması", () => pruneSyncTables(ctx, f, nowMs))) ?? 0;
    n += (await perFacility(f.tesisId, "hesap budaması", () => pruneAccountTables(ctx, f, nowMs))) ?? 0;
    n += (await perFacility(f.tesisId, "giriş dizini", () => pruneLoginRoutes(ctx, f.tesisId))) ?? 0;
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
      const service = await refreshAllServiceEnds(this.ctx, nowMs);
      let purged = 0;
      for (const f of await listFacilities(this.ctx)) {
        purged += (await perFacility(f.tesisId, "kimlik silme", () => purgeClosedIdentities(this.ctx, f.tesisId, nowMs))) ?? 0;
        await perFacility(f.tesisId, "IP alanı", () => stripAgedIps(this.ctx, f.tesisId, nowMs));
      }
      if (purged > 0) console.log(`[patron] bakım: ${purged} kapanmış hesabın kimliği silindi (Ek-6/A §2.5)`);
      const day = new Date(nowMs).toISOString().slice(0, 10);
      if (this.lastDailyDay !== day) {
        const n = await runDaily(this.ctx, nowMs);
        this.lastDailyDay = day;
        if (n > 0) console.log(`[patron] bakım: ${n} satır budandı (saklama + telemetri)`);
        // İmha insan işidir (tutanak): salt okuma süresi dolan tesis her gün hatırlatılır (Ek-6/A §4.3).
        if (service.awaitingDestruction.length > 0) console.warn(`[patron] imha bekleyen tesis (salt okuma süresi doldu — scripts/tesis.ts imha): ${service.awaitingDestruction.join(", ")}`);
      }
    } catch (err) {
      console.error(`[patron] bakım turu başarısız: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

