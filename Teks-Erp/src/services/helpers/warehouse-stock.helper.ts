// =============================================================================
// DEPODA NE VAR — tek kaynak yüklem
// =============================================================================
// "Bu top şu an depoda mı" sorusunun cevabı repoda 16+ kopya olarak yazılmıştı ve
// ikisi açıkça çelişiyordu (transfer `RETURNED_FROM_SUBCONTRACTOR`u taşınabilir
// sayıp defter satırı yazarken, sayım aynı statüyü fotoğraftan dışlıyordu).
// Stok defterinin mutabakatı bu yüklem olmadan yazılamaz: Σhareket'in karşısına
// koyulacak "canlı stok" tarafı TEK yerde tanımlı olmak zorunda.
//
// ⚠️ `shipmentId`/`sackId` ile SÜZÜLMEZ: sevk satırı sevk ANINDA yazılır, yani
// PLANNED sevkiyata bağlanmış ya da çuvalda bekleyen top HÂLÂ depodadır.
//
// ⚠️ `IN_PRODUCTION` ve `AT_SUBCONTRACTOR` stok DEĞİLDİR — mal fiziksel olarak
// depoda değil; üretime alma bir ÇIKIŞ, üretimden dönüş bir GİRİŞ hareketidir.
//
// Tasarım ve gerekçe: `docs/design/DEPO-STOK-DEFTERI-TASARIM.md` §D1.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * Depoda fiziksel olarak duran mal. `RETURNED_FROM_SUBCONTRACTOR` İÇERİDEDİR:
 * mal fasondan geri gelmiştir ve raftadır (transfer de bugün böyle sayıyor).
 */
export const WAREHOUSE_STOCK_STATUSES: readonly RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
] as const;

/** Prisma parçası — mutabakatın "canlı" tarafı ve depo listeleri bundan doğar. */
export const WAREHOUSE_STOCK_WHERE = {
  status: { in: [...WAREHOUSE_STOCK_STATUSES] },
  warehouseId: { not: null },
} satisfies Prisma.RollWhereInput;

/**
 * Bellek-içi ikiz (boğaz-ikiz kuralı): saf yüklem ile Prisma parçası BİRLİKTE
 * değişir; biri diğerinden ayrışırsa defter ile ekran farklı cevap verir.
 */
export function isWarehouseStock(roll: {
  status: RollStatus;
  warehouseId: string | null;
}): boolean {
  return roll.warehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(roll.status);
}

const UNBARCODED_LABEL = "(barkodsuz top)";
/** Mesaja basılan barkod tavanı — tam liste `details.barcodes`da, kırpılmadan. */
const MESSAGE_BARCODE_LIMIT = 20;

/** Kapının tanıması gereken asgari top şekli. */
export interface WarehouseGateRoll {
  id: string;
  barcode: string | null;
  warehouseId: string | null;
}

/**
 * Stok kümesinden ÇIKAN yolun kapısı (sevk · transfer · kartela · iptal · iade
 * hedefi): missing top varsa **409 + barkod listesi**.
 *
 * ⚠️ TEK KAYNAK: sevk ve iade aynı yüklemi paylaşıyor; iki yerde yazılsaydı
 * kaçınılmaz olarak ayrışırlardı. Çağıran yalnız bağlam cümlesini verir.
 *
 * ⚠️ SOYUT SAYI YETMEZ: mesaj etkilenen HER barkodu sayar, çünkü operatörün
 * yapacağı iş "hangi top" sorusunun cevabına bağlı (yıkıcı işlem kuralı).
 *
 * ⚠️ 409, 400 DEĞİL: istemci bozuk bir değer göndermedi, DURUM isteği
 * karşılayamıyor — topun deposu tanımlı değil. Bozuk depo id'si 400'dür.
 *
 * Defter kapısındaki `assertEndShape` bu kapının SON AĞIdır (500): oraya ulaşan
 * missing bir top, bu kapının atlandığı anlamına gelir ve 500 doğru sinyaldir.
 */
export function assertRollsHaveWarehouse(
  rolls: readonly WarehouseGateRoll[],
  context: string,
): void {
  const missing = rolls.filter((r) => r.warehouseId === null);
  if (missing.length === 0) return;
  const barcodes = missing.map((r) => r.barcode ?? UNBARCODED_LABEL);
  // Mesajdaki liste kırpılır ama SAYI kırpılmaz: "ilk 20'si" diyen bir metin
  // toplamı gizlerse operatör işin boyutunu yanlış tahmin eder.
  const shown = barcodes.slice(0, MESSAGE_BARCODE_LIMIT);
  const tail = barcodes.length > shown.length ? ` … (+${barcodes.length - shown.length})` : "";
  throw AppError.conflict(
    `${context}: ${missing.length} topun deposu tanımlı değil — önce deposunu belirleyin ` +
      `(${shown.join(", ")}${tail}).`,
    { code: "ROLL_WAREHOUSE_MISSING", barcodes, rollIds: missing.map((r) => r.id) },
  );
}
