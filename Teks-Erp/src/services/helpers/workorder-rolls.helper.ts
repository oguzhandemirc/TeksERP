// =============================================================================
// "Bu iş emrinin topları" — TEK TANIM (2026-08-21)
// =============================================================================
// `Roll.workOrderId` diye bir kolon YOK. Bir topun iş emrine bağı üç yoldan
// kurulur ve üçü de meşru: üretildiği adım, şu an durduğu adım, ya da üyesi
// olduğu parti. `batch` dahil çünkü finalize olup adımdan düşmüş toplar da
// "bu iş emrinin malı"dır (düzeltme adayı, dağılım bandı, kısmi-boya sayımı).
//
// Eskiden `workorder-link.service` içinde özel bir fonksiyondu; renk değişikliği
// bekçisi (`workorder-target-color.helper`) de aynı kümeyi sayınca buraya alındı.
// İki yerde iki tanım yaşasaydı bant "12 top kırmızı" derken bekçi 9 sayardı.
// =============================================================================
import type { Prisma } from "@prisma/client";

export function whereRollsOfWorkOrder(workOrderId: string): Prisma.RollWhereInput {
  return {
    OR: [
      { producedInStep: { workOrderId } },
      { currentStep: { workOrderId } },
      { batch: { workOrderId } },
    ],
  };
}

/**
 * Ters yön — "şu topları taşıyan iş emirleri" (`whereRollsOfWorkOrder`un boğaz-ikizi; aynı üç bağ).
 * Gelen belgeden iş emri bulma (K17) ve liste aramasındaki belge no dalı bunu kullanır; tek dal düşerse
 * finalize olup adımdan çıkmış top ya da yalnız partide duran top kendi iş emrini bulamaz.
 */
export function whereWorkOrdersOfRolls(rollWhere: Prisma.RollWhereInput): Prisma.WorkOrderWhereInput {
  return {
    OR: [
      { steps: { some: { producedRolls: { some: rollWhere } } } },
      { steps: { some: { currentRolls: { some: rollWhere } } } },
      { batches: { some: { rolls: { some: rollWhere } } } },
    ],
  };
}
