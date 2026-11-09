// =============================================================================
// İŞ EMRİ HEDEF DEĞERİ → ADIM EŞLEMESİ ve DÜZELTME KİLİDİ — TEK KAYNAK (2026-11-09)
// =============================================================================
// Soru: "Bu hedef çeşit değeri hangi rota adımına ait, tabletten hâlâ düzeltilebilir mi?"
// Eşleme: özelliğin kendisi YA DA bağlı olduğu bayrak (`variantOfPropertyId`) adım İSTASYONUNUN
// yetenek listesindeyse değer o adımındır; sıradaki ilk adım kazanır. İE detayı (tablet rota çipi
// altı) ve `PUT /:id/target-values` düzeltme kapısı AYNI saf fonksiyonu çağırır.
// Kilit: adım başladıysa (PENDING değil) kilitli; adımı eşlenemeyen değer İE'nin İLK adımına
// bakar (fail-closed). Kurşun gramajı muaftır: başlamış İE'de değişmesi ayrı kuraldır
// (`test_wo_gramaj_duzelt`, uygulanmış top eski gramajda kalır).
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";

type Reader = Prisma.TransactionClient | PrismaClient;

export interface TargetStepLite {
  id: string;
  stepSequence: number;
  status: string;
  station?: { name?: string | null; propertyCapabilities?: ReadonlyArray<{ propertyId: string }> | null } | null;
}

export interface TargetPropertyLite {
  propertyId: string;
  variantOfPropertyId?: string | null;
  /** Bağlı bayrağın kodu `KURSUN` ise kurşun gramajıdır (adım kilidinden muaf). */
  isKursun?: boolean;
}

export interface TargetValueEditLock {
  /** Değerin ait olduğu adım; eşlenemezse null. */
  stepId: string | null;
  locked: boolean;
  reason: string | null;
}

const sorted = (steps: readonly TargetStepLite[]) => [...steps].sort((a, b) => a.stepSequence - b.stepSequence);

/** Hedef değerin ait olduğu adım (sıradaki ilk eşleşen); yoksa null. */
export function resolveTargetValueStep(steps: readonly TargetStepLite[], prop: TargetPropertyLite): TargetStepLite | null {
  const ids = [prop.propertyId, prop.variantOfPropertyId].filter((x): x is string => !!x);
  return sorted(steps).find((s) => (s.station?.propertyCapabilities ?? []).some((c) => ids.includes(c.propertyId))) ?? null;
}

/** Tablet düzeltme kilidi — detay ekranı ve yazma kapısı aynı sonucu görür. */
export function targetValueEditLock(steps: readonly TargetStepLite[], prop: TargetPropertyLite): TargetValueEditLock {
  const step = resolveTargetValueStep(steps, prop);
  if (prop.isKursun) return { stepId: step?.id ?? null, locked: false, reason: null };
  if (step) {
    const locked = step.status !== "PENDING";
    return { stepId: step.id, locked, reason: locked ? `${step.station?.name ?? "Adım"} adımı başladı — bu hedef değer artık değiştirilemez.` : null };
  }
  const first = sorted(steps)[0];
  const locked = !!first && first.status !== "PENDING";
  return { stepId: null, locked, reason: locked ? "Değerin adımı bulunamadı ve üretim başladı — hedef değer değiştirilemez." : null };
}

/** Yazma kapısı için: İE adımları + istenen özelliklerin bayrak bilgisi tek okumada; tx içinde de çağrılır. */
export async function loadTargetValueEditLocks(db: Reader, workOrderId: string, propertyIds: readonly string[]): Promise<Map<string, TargetValueEditLock>> {
  const steps = await db.workOrderStep.findMany({
    where: { workOrderId },
    select: { id: true, stepSequence: true, status: true, station: { select: { name: true, propertyCapabilities: { select: { propertyId: true } } } } },
  });
  const props = propertyIds.length === 0 ? [] : await db.fabricProperty.findMany({
    where: { id: { in: [...propertyIds] } },
    select: { id: true, variantOfPropertyId: true, variantOf: { select: { code: true } } },
  });
  const out = new Map<string, TargetValueEditLock>();
  for (const p of props) {
    out.set(p.id, targetValueEditLock(steps, { propertyId: p.id, variantOfPropertyId: p.variantOfPropertyId, isKursun: p.variantOf?.code === KURSUN_PROPERTY_CODE }));
  }
  return out;
}
