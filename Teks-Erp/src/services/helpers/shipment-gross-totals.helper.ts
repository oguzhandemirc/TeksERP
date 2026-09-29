// =============================================================================
// SEVKİYAT BRÜT TOPLAMLARI (metraj · kg · top adedi) — TEK KAYNAK
// =============================================================================
// Sevk rakamı her yüzeyde BRÜTTÜR (kök kural): iade `Roll.shipmentId`'yi NULL'lar,
// canlı sayım NET verir; iptal edilmemiş iadeler metraja ve top adedine GERİ EKLENİR.
// Sevkiyat listesi (`shipping.service listShipments`) ile patron bulutu projeksiyonu
// (`cloud-sync`) aynı sayıyı basar — ikinci bir formül yazmak "ayrışan yüzey" sınıfıdır.
// Kg geri-ekleme istemez: iade `Sack.weightKg`'a dokunmaz (tartı sevk anında donmuştur).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { D0 } from "./allocation.helper";

export interface ShipmentGrossTotals {
  /** Canlı Σ `currentQty` + iptal edilmemiş iade metrajı. */
  readonly grossMeters: Prisma.Decimal;
  /** Σ çuval `weightKg`. */
  readonly kg: Prisma.Decimal;
}

/** İptal edilmemiş iade — `_count.returns` seçimi ve iade geri-eklemesi AYNI yüklemi kullanır. */
export const LIVE_RETURN_WHERE = { cancelledAt: null } as const;

/**
 * ⚠️ TEK ANLIK GÖRÜNTÜ ŞART (F-SEV-ESZ-002): canlı toplam ile iade geri-eklemesi
 * FARKLI görüntülerden gelirse aradaki pencerede commit eden bir iade ya ÇİFT sayılır
 * ya KAYBOLUR. Batch `$transaction` tek bağlantıda çalışır ama READ COMMITTED'da her
 * İFADE kendi görüntüsünü alır — izolasyon RepeatableRead'e yükseltilir. Üçü de salt
 * okuma olduğundan P2034 riski yoktur; batch API (dizi formu) "tx.* + Promise.all"
 * yasağının konusu değildir.
 */
export async function loadShipmentGrossTotals(shipmentIds: readonly string[]): Promise<Map<string, ShipmentGrossTotals>> {
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) return new Map();
  const [rollGroups, sackGroups, returnGroups] = await prisma.$transaction(
    [
      prisma.roll.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _sum: { currentQty: true } }),
      prisma.sack.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _sum: { weightKg: true } }),
      prisma.rollReturn.groupBy({ by: ["fromShipmentId"], where: { fromShipmentId: { in: ids }, ...LIVE_RETURN_WHERE }, _sum: { qty: true } }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const liveMeters = new Map(rollGroups.map((g) => [g.shipmentId, g._sum.currentQty ?? D0()]));
  const kg = new Map(sackGroups.map((g) => [g.shipmentId, g._sum.weightKg ?? D0()]));
  const returnedMeters = new Map(returnGroups.map((g) => [g.fromShipmentId, g._sum.qty ?? D0()]));
  const out = new Map<string, ShipmentGrossTotals>();
  for (const id of ids) {
    out.set(id, {
      grossMeters: (liveMeters.get(id) ?? D0()).plus(returnedMeters.get(id) ?? D0()),
      kg: kg.get(id) ?? D0(),
    });
  }
  return out;
}

/** Brüt top adedi: canlı (iade sonrası eksilmiş) + iptal edilmemiş iade adedi. */
export function grossRollCount(liveRollCount: number, liveReturnCount: number): number {
  return liveRollCount + liveReturnCount;
}
