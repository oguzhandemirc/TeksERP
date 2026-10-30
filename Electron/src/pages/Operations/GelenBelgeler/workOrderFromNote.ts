// Belgeden iş emri (D4-D2) — grup başına MEVCUT `quick-start` çağrısı (ikinci yaratıcı yok).
// Token MANTIKSAL DENEME × GRUP başınadır (`attempt.keyed(group.key)`): aynı grup yeniden gönderilirse sunucu aynı
// iş emrini döndürür (replay); gruplar asla tek token paylaşmaz (paylaşsaydı ikinci grup birincinin iş emrini alırdı).
import { isAmbiguousFailure } from "@/lib/attemptToken";
import type { QuickStartPayload, QuickStartResult } from "@/pages/Operations/WorkOrders/service";
import type { ApiResponse } from "@/types/api";
import type { PlanGroup, PlanTarget } from "./types";

export interface GroupStartInput {
  group: PlanGroup;
  /** Panelde düzeltilmiş hedefler (öneri ya da modal seçimi). */
  targets: readonly PlanTarget[];
}

export interface GroupStartOutcome {
  key: string;
  ok: boolean;
  workOrderNumber?: string;
  attached?: number;
  warnings?: string[];
  error?: unknown;
}

/** Saf: grubun quick-start gövdesi — yalnız bağlanabilir toplar; hedef = değerler + bayrakları. */
export function buildGroupPayload(input: GroupStartInput, routeTemplateId: string, clientToken: string, foldType: string | null): QuickStartPayload {
  return {
    clientToken,
    rollBarcodes: input.group.rolls.filter((r) => r.attachable && r.barcode).map((r) => r.barcode as string),
    routeTemplateId,
    ...(foldType ? { foldType } : {}),
    targetValues: input.targets.map((t) => ({ propertyId: t.propertyId, valueId: t.valueId })),
    targetPropertyIds: [...new Set(input.targets.map((t) => t.flagPropertyId))],
  };
}

/**
 * Grupları SIRAYLA başlatır (paralel değil: aynı belgenin topları, hata grubu tek tek raporlanır). Bir grubun hatası
 * ötekileri durdurmaz; sonuç grup başına döner — başarılı grup bir daha gönderilmez (çağıran `done` kümesini tutar).
 */
export async function startGroupWorkOrders(
  inputs: readonly GroupStartInput[],
  deps: {
    routeTemplateId: string;
    foldType: string | null;
    tokenFor: (key: string) => string;
    quickStart: (p: QuickStartPayload) => Promise<ApiResponse<QuickStartResult>>;
  },
): Promise<GroupStartOutcome[]> {
  const out: GroupStartOutcome[] = [];
  for (const input of inputs) {
    const key = input.group.key;
    try {
      const res = await deps.quickStart(buildGroupPayload(input, deps.routeTemplateId, deps.tokenFor(key), deps.foldType));
      out.push({ key, ok: true, workOrderNumber: res.data?.workOrder.workOrderNumber, attached: res.data?.attached, warnings: res.warnings });
    } catch (error) {
      out.push({ key, ok: false, error });
    }
  }
  return out;
}

/**
 * Denemenin sonucunu belirleyen hata: belirsiz (ağ/5xx) bir grup varsa O — token'lar yapışır, açılan gruplar zaten
 * yeniden gönderilmez; yoksa ilk kesin hata (token'lar yenilenir); hepsi başarılıysa `undefined` (deneme bitti).
 */
export function decisiveFailure(outcomes: readonly GroupStartOutcome[]): GroupStartOutcome | undefined {
  return outcomes.find((o) => !o.ok && isAmbiguousFailure(o.error)) ?? outcomes.find((o) => !o.ok);
}
