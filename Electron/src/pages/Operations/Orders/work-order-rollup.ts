import type { WorkOrderStatus } from "@/types/enums";
import type { Tone } from "@/components/operations/StatusBadge";

/**
 * Siparişten "İş Emri" görünürlüğü — saf (JSX'siz) rollup mantığı. Hem liste
 * kolonu (columns.tsx) hem bağlı-İE kartı (LinkedWorkOrdersCard.tsx) buradan
 * beslenir; render'sız birim testle (work-order-rollup.test.ts) doğrulanır.
 *
 * Model gevşek: WO↔sipariş bağı NİYETtir, metraj muhasebesi değil. Durum her
 * zaman `workOrderLinks`'ten türetilir — OrderStatus'a yeni değer eklenmez.
 *
 * İki kritik karar koddan görünmez, burada belgelenir:
 *  - SUPERSEDED (Devredildi): rollup'ta SAYILMAZ (aktif set dışı) — tebdil ile
 *    boşalan kaynak WO; niyet devam WO'suna kopyalanır (orderMode="keep"). Ancak
 *    `collectLinkedWorkOrders` onu DAHİL eder → kart listesinde "Devredildi"
 *    rozetiyle iz olarak görünür.
 *  - PLANNED + COMPLETED karışımı (IN_PROGRESS yokken) → "Üretimde" (kullanıcı
 *    kararı; ayrı "Kısmen Üretildi" etiketi yok).
 */

export interface LinkedWorkOrder {
  id: string;
  workOrderNumber: string;
  status: WorkOrderStatus;
}

export type WoRollupState = "NONE" | "PLANNED" | "IN_PROGRESS" | "COMPLETED";

export interface WoRollup {
  state: WoRollupState;
  /** Rollup'a giren (CANCELLED + SUPERSEDED hariç) distinct WO sayısı. */
  activeCount: number;
}

/** Kalemlerin bağlı olduğu WO'ları taşıyan minimal yapı — OrderLine bunu sağlar. */
interface LineWithWorkOrderLinks {
  workOrderLinks?: Array<{
    workOrder: { id: string; workOrderNumber: string; status: WorkOrderStatus };
  }>;
}

/**
 * Kalemlerdeki bağlı WO'ları distinct (id bazında) toplar. CANCELLED HARİÇ,
 * SUPERSEDED DAHİL (liste izini korur). Aynı WO birden çok kaleme bağlıysa tek
 * kez döner.
 */
export function collectLinkedWorkOrders(
  lines: LineWithWorkOrderLinks[] | undefined,
): LinkedWorkOrder[] {
  const map = new Map<string, LinkedWorkOrder>();
  for (const line of lines ?? []) {
    for (const link of line.workOrderLinks ?? []) {
      const wo = link.workOrder;
      if (wo.status === "CANCELLED") continue;
      if (!map.has(wo.id)) {
        map.set(wo.id, { id: wo.id, workOrderNumber: wo.workOrderNumber, status: wo.status });
      }
    }
  }
  return [...map.values()];
}

/**
 * Rollup durumunu türetir. Aktif set = CANCELLED + SUPERSEDED hariç distinct WO'lar.
 * Boş → NONE; en az bir IN_PROGRESS ya da (PLANNED+COMPLETED karışımı) → IN_PROGRESS;
 * yalnız PLANNED → PLANNED; hepsi COMPLETED → COMPLETED.
 */
export function deriveWoRollup(lines: LineWithWorkOrderLinks[] | undefined): WoRollup {
  const active = collectLinkedWorkOrders(lines).filter((w) => w.status !== "SUPERSEDED");
  if (active.length === 0) return { state: "NONE", activeCount: 0 };

  const hasInProgress = active.some((w) => w.status === "IN_PROGRESS");
  const hasPlanned = active.some((w) => w.status === "PLANNED");
  const hasCompleted = active.some((w) => w.status === "COMPLETED");

  let state: WoRollupState;
  if (hasInProgress) state = "IN_PROGRESS";
  else if (hasPlanned && hasCompleted) state = "IN_PROGRESS"; // karışım → Üretimde
  else if (hasPlanned) state = "PLANNED";
  else state = "COMPLETED";

  return { state, activeCount: active.length };
}

export const woRollupLabels: Record<Exclude<WoRollupState, "NONE">, string> = {
  PLANNED: "Planlandı",
  IN_PROGRESS: "Üretimde",
  COMPLETED: "Üretildi",
};

export const woRollupTones: Record<Exclude<WoRollupState, "NONE">, Tone> = {
  PLANNED: "muted",
  IN_PROGRESS: "info",
  COMPLETED: "success",
};
