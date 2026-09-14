// =============================================================================
// TeksERP — Mal kabul iplik satırlarının TERS KAYDI (fiş iptali)
// =============================================================================
// `yarn.service`ten ayrıldı (300 satır tavanı); yazıcı yine `applyYarnMovementTx`.
// =============================================================================
import { Prisma, YarnMovementKind } from "@prisma/client";
import { applyYarnMovementTx } from "../yarn.service";
import { yarnMovementSign } from "./yarn-sign.helper";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * Bir mal kabul fişinin iplik hareketlerini TERS KAYITLA kapatır.
 *
 * ⚠️ Neden NET üzerinden tek satır: fiş iptali "bu mal HİÇ girmedi" stornosudur
 * ve defterde tek bir düzeltme satırı olarak okunmalı. Net hesaplamak ayrıca
 * işlemi İDEMPOTENT yapar — ikinci çağrıda net 0 çıkar ve hiçbir satır
 * doğmaz. Satır-satır terslemek, kısmi bir hatadan sonra tekrar denendiğinde
 * malı İKİ KEZ düşerdi.
 *
 * ⚠️ Bakiye eksiye düşse bile YAZILIR (yukarıdaki negatif bakiye kuralı): iplik
 * fişten sonra sarf edilmiş olabilir; iptali reddetmek defteri değil yalnız
 * ekranı düzeltirdi.
 *
 * Kumaş-only fişte bu fonksiyon 0 satır okur ve HİÇBİR ŞEY yazmaz — mevcut
 * mal kabul davranışı korunur (indeksli `goodsReceiptId` üzerinden tek sorgu).
 */
export async function reverseGoodsReceiptYarnTx(
  tx: Tx,
  goodsReceiptId: string,
  reason: string,
  userId?: string | null,
): Promise<Array<{ itemId: string; warehouseId: string; qtyKg: Prisma.Decimal; balanceKg: Prisma.Decimal }>> {
  const rows = await tx.yarnMovement.findMany({
    where: { goodsReceiptId },
    select: { itemId: true, warehouseId: true, kind: true, qtyKg: true, lotId: true },
  });
  if (rows.length === 0) return [];

  // Kalem × depo × LOT bazında net — bir fiş aynı ipliği iki depoya (ya da iki lota)
  // alabilir; lot boyutu olmasa ters satır lotsuz düşer ve lot bakiyesi şişerdi.
  const nets = new Map<string, { itemId: string; warehouseId: string; lotId: string | null; net: Prisma.Decimal }>();
  for (const r of rows) {
    const key = `${r.itemId}|${r.warehouseId}|${r.lotId ?? ""}`;
    const cur = nets.get(key) ?? { itemId: r.itemId, warehouseId: r.warehouseId, lotId: r.lotId, net: D(0) };
    cur.net = cur.net.plus(D(r.qtyKg).mul(yarnMovementSign(r.kind)));
    nets.set(key, cur);
  }

  const applied: Array<{ itemId: string; warehouseId: string; qtyKg: Prisma.Decimal; balanceKg: Prisma.Decimal }> = [];
  // ⚠️ SIRALI döngü: `tx.*` ile `Promise.all` YASAK (pg adapter tek bağlantıyı
  // seri çalıştırır; ESLint de yakalar).
  for (const n of nets.values()) {
    if (n.net.isZero()) continue;
    const res = await applyYarnMovementTx(tx, {
      itemId: n.itemId,
      warehouseId: n.warehouseId,
      // Storno bir DÜZELTMEDİR, bir çıkış değil: mal depodan çıkmadı, hiç
      // girmemiş sayıldı. `OUT` yazmak "bu iplik tüketildi" raporunu şişirirdi.
      kind: n.net.gt(0) ? YarnMovementKind.ADJUST_OUT : YarnMovementKind.ADJUST_IN,
      qtyKg: n.net.abs(),
      goodsReceiptId,
      lotId: n.lotId,
      reason,
      userId: userId ?? null,
    });
    applied.push({ itemId: n.itemId, warehouseId: n.warehouseId, qtyKg: n.net.abs(), balanceKg: res.balanceKg });
  }
  return applied;
}
