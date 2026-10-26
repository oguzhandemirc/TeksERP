// =============================================================================
// CİHAZ KOŞUL KAYNAĞI — `cihaz.halka-kaybi` (izlenebilirlik D5, plan §5.7 · K-C5)
// =============================================================================
// Yüklem kopyalanmaz: sağlık ve panel ucuyla AYNI hüküm `evaluateRingLoss` (boğaz-ikiz). Halka
// kullanılamıyorsa (ölçülemedi) açık koşul KORUNUR — sahte "çözüldü" yok.
// =============================================================================
import prisma from "../../lib/prisma";
import { evaluateRingLoss, ringKidSet } from "../../lib/short-credential/ring-footprint";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const DEVICE_CONDITION_PERIOD_MS = 5 * 60_000;
const KIND = "cihaz.halka-kaybi" as const;

export async function ringLossSubjects(): Promise<ConditionSubject[]> {
  if (!ringKidSet()) {
    const open = await prisma.notificationCondition.findMany({
      where: { kind: KIND, resolvedAt: null },
      select: { subjectKey: true, subjectType: true, subjectId: true, payload: true },
    });
    return open.map((r) => ({
      key: r.subjectKey, type: r.subjectType, id: r.subjectId,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
  const loss = await evaluateRingLoss();
  if (!loss) return [];
  return [{ key: "halka", type: "sistem", id: null, payload: { cihazSayisi: String(loss.etkilenen.cihazKaniti) } }];
}

export function registerDeviceConditionSources(): void {
  registerConditionSource({ kind: KIND, periodMs: DEVICE_CONDITION_PERIOD_MS, evaluate: ringLossSubjects });
}
