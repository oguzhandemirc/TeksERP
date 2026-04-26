import type { Roll, RollOperationType } from "@/types/models";
import type { ItemType } from "@/types/enums";
import { itemTypeLabels } from "@/types/enums";

/**
 * Roll'un üretim sürecinde geldiği son duruma göre türetilmiş "güncel durum" etiketi.
 * `Item.itemType` giriş türüdür (değişmez); bu helper ise operasyonlara bakarak
 * "Mamul / Kurşunlu / Fasondan Döndü" gibi gerçek güncel durumu hesaplar.
 *
 * Öncelik (en son adım en üstte):
 *   1. TAMBUR_PROCESSED → Mamul Kumaş
 *   2. SUBCONTRACTOR_RETURNED → Boyalı Kumaş (Fasondan Döndü)
 *   3. KURSUN_APPLIED → Kurşunlu Kumaş
 *   4. Hiçbiri yoksa → giriş türü (item.itemType etiketi)
 */
export function computeCurrentRollState(roll: Roll): string {
  const ops = new Set(
    (roll.operations ?? []).map((o) => o.operationType as RollOperationType),
  );

  if (ops.has("TAMBUR_PROCESSED")) return "Mamul Kumaş";
  if (ops.has("SUBCONTRACTOR_RETURNED")) return "Boyalı Kumaş";
  if (ops.has("KURSUN_APPLIED")) return "Kurşunlu Kumaş";

  const initial = roll.item?.itemType as ItemType | undefined;
  return initial ? itemTypeLabels[initial] ?? initial : "—";
}

export function getInitialTypeLabel(roll: Roll): string {
  const initial = roll.item?.itemType as ItemType | undefined;
  return initial ? itemTypeLabels[initial] ?? initial : "—";
}
