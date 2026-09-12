// =============================================================================
// DEPO ÇÖZÜCÜ — "bu top hangi depoya yazılacak?" sorusunun TEK cevabı.
// =============================================================================
// Fabrika akışlarının hiçbiri depo parametresi GÖNDERMEZ (KK1 girişi, tambur
// finalize/kesim, fason dönüşü…). Onların hepsi buradan varsayılan depoya düşer
// ve davranışları güncelleme öncesiyle bayt-bayt aynı kalır. Depoyu yalnız
// ticaret akışları (mal kabul, transfer) açıkça verir.
//
// ⚠️ Kural tek yerde durur. Her `roll.create` noktasına "depo yoksa varsayılanı
// bul" mantığı kopyalanırsa biri gün gelir farklı davranır (giriş istasyonu
// helper'ının başındaki 12-yol envanteri tam bu yüzden yazılmıştı).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { hata } from "../../lib/logger";

type Db = Prisma.TransactionClient | typeof prisma;

/** Boot uzlaştırmasının doğurduğu varsayılan deponun sabit kodu. */
export const DEFAULT_WAREHOUSE_CODE = "DP-MERKEZ";
export const DEFAULT_WAREHOUSE_NAME = "Merkez Depo";

/**
 * Varsayılan deponun id'si (yoksa null).
 *
 * CACHE YOK — bilinçli: `warehouses` tek haneli satır sayısına sahip ve sorgu
 * partial unique index üzerinden koşuyor (<1 ms). Süreç-içi cache, ikinci bir
 * backend süreci varsayılanı değiştirdiğinde sessizce bayatlardı; kazanç ölçülebilir
 * değil, risk gerçek.
 */
export async function getDefaultWarehouseId(db: Db = prisma): Promise<string | null> {
  const row = await db.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * Yazılacak depoyu çözer.
 *
 * • `explicitId` verilmişse: VAR ve AKTİF olmalı, aksi halde 400. Açık bir kullanıcı
 *   seçimi sessizce başka bir depoya sapmamalı — sapsaydı mal "yanlış depoda"
 *   görünür ve kimse fark etmezdi.
 * • Verilmemişse: varsayılan depo.
 * • Varsayılan da yoksa `null` döner ve GÜRÜLTÜLÜ loglar — FIRLATMAZ.
 *   Gerekçe: bu durumda tek alternatif top oluşturmayı reddetmektir, yani
 *   fabrikada üretim kaydını durdurmak. Eksik `warehouseId` geri doldurulabilir
 *   bir boşluktur ve `test_roll_warehouse_stamp` onu kırmızıya çevirir (iki ayrı
 *   ölçü: bu koşumda doğan toplar · test ön eki olmayan canlı veri).
 */
export async function resolveTargetWarehouseId(
  db: Db = prisma,
  explicitId?: string | null,
): Promise<string | null> {
  if (explicitId) {
    const w = await db.warehouse.findUnique({
      where: { id: explicitId },
      select: { id: true, isActive: true, name: true },
    });
    if (!w) throw AppError.badRequest("Seçilen depo bulunamadı.");
    if (!w.isActive) throw AppError.badRequest(`"${w.name}" deposu pasif durumda — mal bu depoya alınamaz.`);
    return w.id;
  }

  const fallback = await getDefaultWarehouseId(db);
  if (!fallback) {
    hata("warehouse", "VARSAYILAN DEPO YOK — top deposuz yazılıyor. " +
        "Boot uzlaştırması (ensureDefaultWarehouse) koşmamış olabilir; " +
        "Tanımlar → Depolar'dan bir depoyu varsayılan yapın.",
    );
  }
  return fallback;
}
