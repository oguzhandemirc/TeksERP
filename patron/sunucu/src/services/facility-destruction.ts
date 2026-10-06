// TESİS İMHASI (Ek-6/A §4.3–4.5) — yalnız satıcı CLI'si çağırır (`scripts/tesis.ts imha`, göç rolü); sunucu ÇAĞIRMAZ.
// Kapı (aşama tek kaynaktan, `service-lifecycle.ts`): KAPALI (bitiş + 90 gün doldu) ya da SALT_OKUNUR + yazılı erken
// imha talebi (§4.2); hizmet ACIK iken ASLA. Kuru koşum varsayılandır (tablo başına sayı); uygulama tek tx'te tesisin
// BÜTÜN bulut verisini çocuktan ebeveyne siler ve imha kaydını (`facility_destructions`) AYNI tx'te yazar.
// Silinmeyenler beyanlıdır (`RETAINED_TABLES`); her tablo ya silinir ya gerekçeyle kalır (bekçi iki yönlü ölçer).
import type { Tx } from "../lib/db";
import { CloudError, notFound } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import { loadServiceFacts, observedEnd, serviceState, type ServicePhase } from "./service-lifecycle";
import type { TesisDbRouter } from "../lib/tesis-db";

/** Yedek döngüsü: günlük yedek 30 gün tutulur (`YEDEK_SAKLA_GUN`) + 5 gün pay ⇒ son yedekten düşme (Ek-6/A §4.4). */
export const BACKUP_CLEAR_DAYS = 35;
const DAY_MS = 86_400_000;

/** İmhada KALAN tablolar → gerekçe. Başka her tablo silinir. */
export const RETAINED_TABLES = {
  facility_destructions: "imha kaydının kendisi (tutanak verisi, en az 3 yıl; içerik taşımaz)",
  support_access: "destek erişim kaydı SİLİNEMEZ (Ek-6/B §3.2; Lisans Alan dökümünü isteyebilir, §3.3)",
} as const;

type Where = { readonly tesisId: string };
interface Step {
  readonly table: string;
  readonly count: (tx: Tx, where: Where) => Promise<number>;
  readonly remove: (tx: Tx, where: Where) => Promise<number>;
}

/** Silme sırası (çocuktan ebeveyne; yabancı anahtarlar RESTRICT). */
export const DESTRUCTION_STEPS: readonly Step[] = [
  { table: "sessions", count: (tx, where) => tx.session.count({ where }), remove: async (tx, where) => (await tx.session.deleteMany({ where })).count },
  { table: "push_devices", count: (tx, where) => tx.pushDevice.count({ where }), remove: async (tx, where) => (await tx.pushDevice.deleteMany({ where })).count },
  { table: "notifications", count: (tx, where) => tx.notification.count({ where }), remove: async (tx, where) => (await tx.notification.deleteMany({ where })).count },
  {
    table: "notification_preferences",
    count: (tx, where) => tx.notificationPreference.count({ where }),
    remove: async (tx, where) => (await tx.notificationPreference.deleteMany({ where })).count,
  },
  {
    table: "notification_defaults",
    count: (tx, where) => tx.notificationDefaults.count({ where }),
    remove: async (tx, where) => (await tx.notificationDefaults.deleteMany({ where })).count,
  },
  { table: "account_audit", count: (tx, where) => tx.accountAudit.count({ where }), remove: async (tx, where) => (await tx.accountAudit.deleteMany({ where })).count },
  { table: "operation_receipts", count: (tx, where) => tx.operationReceipt.count({ where }), remove: async (tx, where) => (await tx.operationReceipt.deleteMany({ where })).count },
  { table: "inbox_messages", count: (tx, where) => tx.inboxMessage.count({ where }), remove: async (tx, where) => (await tx.inboxMessage.deleteMany({ where })).count },
  { table: "report_requests", count: (tx, where) => tx.reportRequest.count({ where }), remove: async (tx, where) => (await tx.reportRequest.deleteMany({ where })).count },
  { table: "report_results", count: (tx, where) => tx.reportResult.count({ where }), remove: async (tx, where) => (await tx.reportResult.deleteMany({ where })).count },
  { table: "projection_rows", count: (tx, where) => tx.projectionRow.count({ where }), remove: async (tx, where) => (await tx.projectionRow.deleteMany({ where })).count },
  { table: "sync_watermarks", count: (tx, where) => tx.syncWatermark.count({ where }), remove: async (tx, where) => (await tx.syncWatermark.deleteMany({ where })).count },
  { table: "package_receipts", count: (tx, where) => tx.packageReceipt.count({ where }), remove: async (tx, where) => (await tx.packageReceipt.deleteMany({ where })).count },
  { table: "sync_state", count: (tx, where) => tx.syncState.count({ where }), remove: async (tx, where) => (await tx.syncState.deleteMany({ where })).count },
  { table: "full_sync_runs", count: (tx, where) => tx.fullSyncRun.count({ where }), remove: async (tx, where) => (await tx.fullSyncRun.deleteMany({ where })).count },
  { table: "request_nonces", count: (tx, where) => tx.requestNonce.count({ where }), remove: async (tx, where) => (await tx.requestNonce.deleteMany({ where })).count },
  { table: "accounts", count: (tx, where) => tx.account.count({ where }), remove: async (tx, where) => (await tx.account.deleteMany({ where })).count },
  { table: "installations", count: (tx, where) => tx.installation.count({ where }), remove: async (tx, where) => (await tx.installation.deleteMany({ where })).count },
  { table: "facilities", count: (tx, where) => tx.facility.count({ where }), remove: async (tx, where) => (await tx.facility.deleteMany({ where })).count },
];

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

async function countAll(tx: Tx, where: Where): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const step of DESTRUCTION_STEPS) out[step.table] = await step.count(tx, where);
  return out;
}

export async function destroyFacility(db: TesisDbRouter, g: DestructionInput, nowMs: number = Date.now()): Promise<DestructionReport> {
  const where = { tesisId: g.tesisId };
  return withTesis(db, { tesisId: g.tesisId, lock: { name: "ACCOUNT_ADMIN", key: g.tesisId }, timeoutMs: 300_000 }, async (tx) => {
    const facility = await tx.facility.findUnique({ where: { tesisId: g.tesisId } });
    const facts = await loadServiceFacts(tx, g.tesisId);
    if (!facility || !facts) throw notFound("Tesis");
    const state = serviceState(facts, nowMs);
    const reason = destructionReason(state.phase, g.earlyRequestRef);
    const endedAt = state.endedAt ?? observedEnd(facts, nowMs);
    const base = {
      tesisId: g.tesisId,
      facilityName: facility.name,
      phase: state.phase,
      serviceEndedAt: endedAt.toISOString(),
      readOnlyUntil: state.readOnlyUntil!.toISOString(),
      reason,
    };
    if (!g.apply) return { ...base, counts: await countAll(tx, where), applied: false, backupClearBy: null, recordId: null };
    const counts: Record<string, number> = {};
    for (const step of DESTRUCTION_STEPS) counts[step.table] = await step.remove(tx, where);
    const backupClearBy = new Date(nowMs + BACKUP_CLEAR_DAYS * DAY_MS);
    const record = await tx.facilityDestruction.create({
      data: {
        tesisId: g.tesisId,
        facilityName: facility.name,
        reason,
        requestRef: reason === "ERKEN_TALEP" ? g.earlyRequestRef! : null,
        operator: g.operator,
        serviceEndedAt: endedAt,
        deletedCounts: counts,
        backupClearBy,
      },
    });
    return { ...base, counts, applied: true, backupClearBy: backupClearBy.toISOString(), recordId: record.id };
  });
}

/** İmhadan sonra kalan satır (ör. yarışta geç düşen ayak izi) — sıfır değilse ikinci geçiş siler. */
export async function sweepAfterDestruction(db: TesisDbRouter, tesisId: string): Promise<Record<string, number>> {
  return withTesis(db, { tesisId }, async (tx) => {
    const left = await countAll(tx, { tesisId });
    const out: Record<string, number> = {};
    for (const step of DESTRUCTION_STEPS) if ((left[step.table] ?? 0) > 0) out[step.table] = await step.remove(tx, { tesisId });
    return out;
  });
}
