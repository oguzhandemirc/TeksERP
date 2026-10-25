// =============================================================================
// KALİTE KOŞUL KAYNAKLARI — `kalite.sertifika-suresi-doluyor` (K4P-SERT, KOSUL)
// =============================================================================
// Konu kümesi panel süzgeciyle AYNI yüklemden: `certificateExpiryWhere(bugün, gun)` (etkin ∧ kalan gün ≤
// eşik, süresi geçmiş dahil). Yenilenen/iptal edilen sertifika kümeden düşer → motor "Çözüldü" yazar.
// Aç/kapa, tekrar bastırma ve 8040 kilidi `notification-condition.job.ts`te; `evaluate` fırlatırsa
// motor hiçbir koşulu kapatmaz (fail-closed) — burada hata YAKALANMAZ.
// =============================================================================
import prisma from "../../lib/prisma";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import type { ModulKey } from "../../constants/screen-catalog";
import { loadNotificationVisibilityEnv } from "../helpers/notification-visibility.helper";
import { certificateDaysLeft, certificateExpiryWhere, certificateToday } from "../helpers/certificate-active.helper";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const QUALITY_CONDITION_PERIOD_MS = 300_000;
export const CERTIFICATE_EXPIRY_KIND = "kalite.sertifika-suresi-doluyor" satisfies NotificationKind;

export interface ExpiringCertificateRow {
  id: string;
  certificateNo: string;
  standard: string;
  expiresOn: Date;
  partner: { name: string } | null;
}

export interface QualitySourceDeps {
  moduleOpen: (kind: NotificationKind) => Promise<boolean>;
  expiringCertificates: (today: Date, days: number) => Promise<ExpiringCertificateRow[]>;
  params: (kind: NotificationKind) => Record<string, unknown>;
  now: () => number;
}

async function moduleOpen(kind: NotificationKind): Promise<boolean> {
  const env = await loadNotificationVisibilityEnv(prisma, [kind]);
  return env.modules[getNotificationEntry(kind).modul as ModulKey] !== false;
}

function catalogParams(kind: NotificationKind): Record<string, unknown> {
  const schema = getNotificationEntry(kind).paramSemasi;
  return schema ? (schema.parse({}) as Record<string, unknown>) : {};
}

export const QUALITY_SOURCE_REAL_DEPS: Readonly<QualitySourceDeps> = {
  moduleOpen,
  expiringCertificates: (today, days) =>
    prisma.certificate.findMany({
      where: certificateExpiryWhere(today, days),
      select: { id: true, certificateNo: true, standard: true, expiresOn: true, partner: { select: { name: true } } },
    }),
  params: catalogParams,
  now: Date.now,
};

let deps: QualitySourceDeps = { ...QUALITY_SOURCE_REAL_DEPS };

/** Bekçi enjeksiyonu: verilen okuyucuları değiştirir, geri alma fonksiyonu döner. */
export function overrideQualitySourceDeps(p: Partial<QualitySourceDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...p };
  return () => {
    deps = previous;
  };
}

function statusText(daysLeft: number): string {
  if (daysLeft > 0) return `${daysLeft} gün kaldı`;
  if (daysLeft === 0) return "süresi bugün doluyor";
  return `süresi ${-daysLeft} gün önce doldu`;
}

export async function expiringCertificateSubjects(): Promise<ConditionSubject[]> {
  if (!(await deps.moduleOpen(CERTIFICATE_EXPIRY_KIND))) return [];
  const days = Number(deps.params(CERTIFICATE_EXPIRY_KIND).gun);
  const today = certificateToday(new Date(deps.now()));
  return (await deps.expiringCertificates(today, days)).map((c) => {
    const left = certificateDaysLeft(c.expiresOn, today);
    return {
      key: c.id, type: "certificate", id: c.id,
      payload: {
        sertifikaId: c.id, sertifikaNo: c.certificateNo, standart: c.standard,
        sahip: c.partner?.name ?? "Fabrika", durum: statusText(left),
      },
    };
  });
}

/** Kaynağı tarayıcıya kaydeder (tekrar çağrı aynı kaydı yeniler). */
export function registerQualityConditionSources(): void {
  registerConditionSource({ kind: CERTIFICATE_EXPIRY_KIND, periodMs: QUALITY_CONDITION_PERIOD_MS, evaluate: expiringCertificateSubjects });
}
