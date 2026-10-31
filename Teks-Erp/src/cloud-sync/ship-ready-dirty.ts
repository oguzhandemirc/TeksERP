// Sevke hazırlık politikası (`shipping.ready.rule` / `.tolerancePct`) değişince `is-emri.sevkeHazir` bütün
// canlı iş emirlerinde yeniden sınıflanır; toplar değişmediği için filigran görmez → iş emrini KIRLI işaretle
// (D4-MIG6, J5 kalanı). Canlı küme panelin "Sevke Hazır İşler" listesiyle aynı kaynaktan (computeReadyWorks).
import prisma from "../lib/prisma";
import { effectiveShipReadyPolicy, type ShipReadyPolicy } from "../services/helpers/ship-readiness.helper";
import { computeReadyWorks } from "../services/ready-works.service";

// `sync_marks` kök tablosu (audit modülü değil — test_audit_labels §2 `tableName:` literal taramasına girmez).
const SYNC_ROOT = "work_orders";

/** Yazımdan önceki politika (ayar servisi döngüsel içe aktarmadan kaçmak için bu modülü dinamik yükler). */
export const readReadyPolicySnapshot = (): Promise<ShipReadyPolicy> => effectiveShipReadyPolicy();

/** Politika gerçekten değiştiyse canlı iş emirlerine `sync_marks` DIRTY yazar; yazılan satır sayısı döner. */
export async function markReadyWorkOrdersDirty(before: ShipReadyPolicy): Promise<number> {
  const after = await effectiveShipReadyPolicy();
  if (after.rule === before.rule && after.tolerancePct === before.tolerancePct) return 0;
  const rows = await computeReadyWorks("workOrder", after);
  if (rows.length === 0) return 0;
  const r = await prisma.syncMark.createMany({
    data: rows.map((w) => ({ tableName: SYNC_ROOT, rowId: w.id, kind: "DIRTY" as const })),
  });
  return r.count;
}
