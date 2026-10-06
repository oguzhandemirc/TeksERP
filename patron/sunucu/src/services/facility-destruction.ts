// TESİS İMHASI (Ek-6/A §4.3–4.5; PATRON-TESIS-DB §8) — yalnız satıcı CLI'si çağırır (`scripts/tesis.ts imha`, GÖÇ rolü);
// sunucu ÇAĞIRMAZ. Kapı (aşama tek kaynaktan, `service-lifecycle.ts`): KAPALI (bitiş + 90 gün doldu) ya da SALT_OKUNUR +
// yazılı erken imha talebi (§4.2); hizmet ACIK iken ASLA. Kuru koşum varsayılandır (tablo başına sayı). Uygulama tesisin
// DB'sini BÜTÜNÜYLE düşürür: HAZIR → IMHA_SURUYOR claim'i (yönlendirme durur) → tesis rollerinin CONNECT'i geri, açık
// bağlantılar kesilir → son sayım plana (merkez) → destek erişim kayıtları merkeze kopya → DROP DATABASE + tesis rolleri
// → tutanak (plandaki kimlikle; tekrar koşum ikinci tutanak yazmaz) + yönlendirme satırları → IMHA_EDILDI. Yarıda kalan
// imha aynı komutla kaldığı yerden tamamlanır. Kalanlar beyanlıdır (`RETAINED_TABLES`; bekçi iki yönlü ölçer).
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Tx } from "../lib/db";
import { ident } from "../lib/db-roles";
import { CloudError, notFound } from "../lib/errors";
import { PG_SESSION_OPTIONS } from "../lib/pg-session";
import { withCentral, withTesis } from "../lib/tenant";
import { facilityRoles } from "../lib/tesis-db-ad";
import { loadServiceFacts, observedEnd, serviceState, type ServicePhase } from "./service-lifecycle";
import type { TesisDbRouter } from "../lib/tesis-db";

/** Yedek döngüsü: günlük yedek 30 gün tutulur (`YEDEK_SAKLA_GUN`) + 5 gün pay ⇒ son yedekten düşme (Ek-6/A §4.4). */
export const BACKUP_CLEAR_DAYS = 35;
const DAY_MS = 86_400_000;

/** İmhada KALAN tablolar → gerekçe (ikisi de MERKEZDE durur). Tesis DB'sinin başka her tablosu DB'yle birlikte gider. */
export const RETAINED_TABLES = {
  facility_destructions: "imha kaydının kendisi (merkezde yazılır; tutanak verisi, en az 3 yıl; içerik taşımaz)",
  support_access: "destek erişim kaydı SİLİNEMEZ (Ek-6/B §3.2): imhada merkeze kopyalanır, Lisans Alan dökümünü isteyebilir (§3.3)",
} as const;

/** Tutanak sayım listesi: tesis DB'sinin imhada giden tabloları (TESIS_TABLES − RETAINED_TABLES; bekçi birebir ölçer). */
export const DESTRUCTION_STEPS: readonly { readonly table: string }[] = [
  "sessions",
  "push_devices",
  "notifications",
  "notification_preferences",
  "notification_defaults",
  "account_audit",
  "operation_receipts",
  "inbox_messages",
  "report_requests",
  "report_results",
  "projection_rows",
  "sync_watermarks",
  "package_receipts",
  "sync_state",
  "full_sync_runs",
  "request_nonces",
  "accounts",
  "installations",
  "facilities",
].map((table) => ({ table }));

export interface DestructionInput {
  readonly tesisId: string;
  readonly operator: string;
  /** Yazılı erken imha talebinin numarası (Ek-6/A §4.2); yoksa süre dolmuş olmalı. */
  readonly earlyRequestRef?: string;
  readonly apply: boolean;
}

export interface DestructionReport {
  readonly tesisId: string;
  readonly facilityName: string;
  readonly phase: ServicePhase;
  readonly serviceEndedAt: string;
  readonly readOnlyUntil: string;
  readonly reason: "SURE_DOLDU" | "ERKEN_TALEP";
  readonly counts: Readonly<Record<string, number>>;
  readonly applied: boolean;
  readonly backupClearBy: string | null;
  readonly recordId: string | null;
}

/** Aşama kapısı: ACIK'ta ASLA; SALT_OKUNUR'da yalnız erken talep numarasıyla; KAPALI'da talep gerekmez. */
export function destructionReason(phase: ServicePhase, earlyRequestRef: string | undefined): "SURE_DOLDU" | "ERKEN_TALEP" {
  if (phase === "ACIK") throw new CloudError(409, "DURUM_CAKISMASI", "Hizmet açık; tesis verisi imha edilemez");
  if (phase === "KAPALI") return "SURE_DOLDU";
  if (!earlyRequestRef) throw new CloudError(409, "DURUM_CAKISMASI", "Salt okuma süresi dolmadı; imha yalnız yazılı erken imha talebiyle (--erken-talep) yapılır");
  return "ERKEN_TALEP";
}

type Counter = (table: string) => Promise<number>;

async function countAll(count: Counter): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const step of DESTRUCTION_STEPS) out[step.table] = await count(step.table);
  return out;
}

const txCounter =
  (tx: Tx): Counter =>
  async (table) =>
    (await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${ident(table)}`))[0]!.n;

/** Merkezde saklanan imha planı: yarıda kalan imha bununla sürer; tutanak plandaki kimlikle yazılır. */
interface DestructionPlan {
  readonly recordId: string;
  readonly facilityName: string;
  readonly phase: ServicePhase;
  readonly serviceEndedAt: string;
  readonly readOnlyUntil: string;
  readonly reason: "SURE_DOLDU" | "ERKEN_TALEP";
  readonly requestRef: string | null;
  readonly operator: string;
  readonly backupClearBy: string;
  /** Bağlantılar kesildikten SONRAKİ sayım (DB düşmeden önce yazılır). */
  counts: Record<string, number> | null;
}

function report(tesisId: string, p: DestructionPlan, applied: boolean, counts: Record<string, number>): DestructionReport {
  return {
    tesisId,
    facilityName: p.facilityName,
    phase: p.phase,
    serviceEndedAt: p.serviceEndedAt,
    readOnlyUntil: p.readOnlyUntil,
    reason: p.reason,
    counts,
    applied,
    backupClearBy: applied ? p.backupClearBy : null,
    recordId: applied ? p.recordId : null,
  };
}

async function planFromFacility(db: TesisDbRouter, g: DestructionInput, nowMs: number): Promise<{ plan: DestructionPlan; counts: Record<string, number> }> {
  return withTesis(db, { tesisId: g.tesisId, lock: { name: "ACCOUNT_ADMIN", key: g.tesisId }, timeoutMs: 300_000 }, async (tx) => {
    const facility = await tx.facility.findUnique({ where: { tesisId: g.tesisId } });
    const facts = await loadServiceFacts(tx, g.tesisId);
    if (!facility || !facts) throw notFound("Tesis");
    const state = serviceState(facts, nowMs);
    const reason = destructionReason(state.phase, g.earlyRequestRef);
    const plan: DestructionPlan = {
      recordId: randomUUID(),
      facilityName: facility.name,
      phase: state.phase,
      serviceEndedAt: (state.endedAt ?? observedEnd(facts, nowMs)).toISOString(),
      readOnlyUntil: state.readOnlyUntil!.toISOString(),
      reason,
      requestRef: reason === "ERKEN_TALEP" ? g.earlyRequestRef! : null,
      operator: g.operator,
      backupClearBy: new Date(nowMs + BACKUP_CLEAR_DAYS * DAY_MS).toISOString(),
      counts: null,
    };
    return { plan, counts: await countAll(txCounter(tx)) };
  });
}

export async function destroyFacility(db: TesisDbRouter, g: DestructionInput, nowMs: number = Date.now()): Promise<DestructionReport> {
  if (db.role !== "goc") throw new Error("Tesis imhası yalnız göç rolüyle");
  const central = db.centralClient;
  const row = await central.facilityDatabase.findUnique({ where: { tesisId: g.tesisId } });
  if (!row) throw notFound("Tesis");
  if (row.status === "IMHA_EDILDI") throw new CloudError(409, "DURUM_CAKISMASI", "Tesis zaten imha edildi; tutanak merkezde (facility_destructions)");
  if (row.status === "IMHA_SURUYOR") {
    // Yarıda kalmış imha: plan merkezde; kapı yeniden sorulmaz (veri kısmen gitmiş olabilir), aynı plan tamamlanır.
    const plan = row.destructionPlan as unknown as DestructionPlan;
    if (!g.apply) return report(g.tesisId, plan, false, plan.counts ?? {});
    return report(g.tesisId, plan, true, await finish(db, g.tesisId, plan));
  }
  if (row.status !== "HAZIR") throw new CloudError(409, "DURUM_CAKISMASI", "Tesis veritabanı hazır değil; imha edilecek veri yok");
  const { plan, counts } = await planFromFacility(db, g, nowMs);
  if (!g.apply) return report(g.tesisId, plan, false, counts);
  const claimed = await central.facilityDatabase.updateMany({
    where: { tesisId: g.tesisId, status: "HAZIR" },
    data: { status: "IMHA_SURUYOR", destructionPlan: plan as unknown as object },
  });
  if (claimed.count === 0) throw new CloudError(409, "DURUM_CAKISMASI", "Tesis durumu imha sırasında değişti; tekrar deneyin");
  db.invalidate(g.tesisId);
  return report(g.tesisId, plan, true, await finish(db, g.tesisId, plan));
}

/** IMHA_SURUYOR'dan sonuna: her adım idempotent (yarıda kalan aynı komutla sürer). */
async function finish(db: TesisDbRouter, tesisId: string, plan: DestructionPlan): Promise<Record<string, number>> {
  const central = db.centralClient;
  const database = db.databaseFor(tesisId);
  const roles = facilityRoles(database);
  await db.forget(tesisId);
  const exists = (await central.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_database WHERE datname = ${database}`)[0]!.n > 0;
  let counts = plan.counts;
  if (exists) {
    await central.$executeRawUnsafe(`REVOKE CONNECT ON DATABASE ${ident(database)} FROM ${[roles.app, roles.sync, roles.support].map(ident).join(", ")}`);
    await central.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${database} AND pid <> pg_backend_pid()`;
    const c = new Client({ connectionString: db.adminUrlFor(tesisId), options: PG_SESSION_OPTIONS });
    await c.connect();
    try {
      if (!counts) {
        counts = await countAll(async (t) => (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${ident(t)}`)).rows[0]!.n);
        await central.facilityDatabase.updateMany({ where: { tesisId, status: "IMHA_SURUYOR" }, data: { destructionPlan: { ...plan, counts } as unknown as object } });
      }
      const access = await c.query<{ rows: unknown }>(`SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) AS rows FROM support_access s`);
      await central.$executeRaw`INSERT INTO support_access SELECT * FROM jsonb_populate_recordset(NULL::support_access, ${JSON.stringify(access.rows[0]!.rows)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    } finally {
      await c.end().catch(() => undefined);
    }
    await central.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`);
  }
  for (const r of [roles.app, roles.sync, roles.support]) await central.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ident(r)}`);
  const final = counts ?? {};
  await withCentral(db, {}, async (tx) => {
    await tx.facilityDestruction.createMany({
      data: [
        {
          id: plan.recordId,
          tesisId,
          facilityName: plan.facilityName,
          reason: plan.reason,
          requestRef: plan.requestRef,
          operator: plan.operator,
          serviceEndedAt: new Date(plan.serviceEndedAt),
          deletedCounts: final,
          backupClearBy: new Date(plan.backupClearBy),
        },
      ],
      skipDuplicates: true,
    });
    await tx.installationRoute.deleteMany({ where: { tesisId } });
    await tx.loginRoute.deleteMany({ where: { tesisId } });
    await tx.facilityDatabase.updateMany({ where: { tesisId, status: "IMHA_SURUYOR" }, data: { status: "IMHA_EDILDI", destroyedAt: new Date() } });
  });
  return final;
}
