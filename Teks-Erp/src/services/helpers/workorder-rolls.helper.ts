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
import { Prisma } from "@prisma/client";

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

/**
 * SQL ikizi — top ↔ iş emri kenarları (`roll_id`, `wo_id`), aynı üç bağ (parti · durduğu adım · üretildiği adım).
 * `rollCond` her dalın WHERE'ine eklenir (top takma adı `r`). Sayfa başına tek sorguda "hangi top hangi İE" eşlemesi
 * gerektiğinde kullanılır; ikizlik `test_gelen_belge_liste_is_emri` §5'te `whereWorkOrdersOfRolls` ile ölçülür.
 */
export function rollWorkOrderEdgesSql(rollCond: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`SELECT r.id AS roll_id, b."workOrderId" AS wo_id FROM rolls r JOIN batches b ON b.id = r."batchId" WHERE ${rollCond}
      UNION SELECT r.id AS roll_id, s."workOrderId" AS wo_id FROM rolls r JOIN work_order_steps s ON s.id = r."currentStepId" WHERE ${rollCond}
      UNION SELECT r.id AS roll_id, s."workOrderId" AS wo_id FROM rolls r JOIN work_order_steps s ON s.id = r."producedInStepId" WHERE ${rollCond}`;
}
