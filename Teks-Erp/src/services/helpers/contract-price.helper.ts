// =============================================================================
// SÖZLEŞME (ALIŞ SİPARİŞİ) FİYATI — TEK KAYNAK
// =============================================================================
// Bekçi: `scripts/test_gr_order_price_currency.ts`.
//
// ── KURAL ────────────────────────────────────────────────────────────────────
// Alış tarafında birim fiyat zinciri ŞUDUR ve her iki yüzeyde de AYNIDIR:
//
//     satırın kendi (elle girilen / donmuş) fiyatı
//   > SİPARİŞ (sözleşme) fiyatı            ← bu dosya
//   > kalem kartının alış fiyatı (tedarikçi istisnası > varsayılan)
//   > yok (null / 0)
//
// Sipariş fiyatı SÖZLEŞMEDİR: satın almacı tedarikçiyle onu konuşmuştur. Kalem
// kartındaki fiyat ise bir VARSAYILANDIR (en son bilinen / listeden gelen).
// Varsayılanın sözleşmeyi yenmesi, anlaşılan rakamın sessizce terk edilmesidir.
//
// ── NEDEN AYRI DOSYA (2026-08-15 düzeltmesi) ─────────────────────────────────
// Katman ilk yazımında YALNIZ fatura tarafına (`createDraftFromGoodsReceipt`)
// konmuştu ve tam da tarif edildiği senaryoda HİÇ ÇALIŞMIYORDU:
//   kart fiyatı 2,00 · sipariş fiyatı 3,50 · depocu satıra fiyat yazmıyor
//   → mal kabul D2 ön-dolumu KABUL ANINDA kart fiyatını çözüp
//     `Roll.purchasePrice = 2,00` olarak DONDURUYOR
//   → fatura zinciri ilk terimde (`r.purchasePrice`) duruyor, sözleşme katmanına
//     hiç inmiyor.
// Yani muhasebeci anlaşılan 3,50'yi ya ÜÇÜNCÜ kez elle yazacak ya da metre
// başına 1,50 fark sessizce defterlenecekti (hata yok, log yok). Katman bu
// yüzden zincirin GERÇEKTEN karar verildiği yere — mal kabule — taşındı;
// fatura tarafındaki kopya SİLİNMEDİ (aşağıdaki "iki tüketici" notu).
//
// ── İKİ TÜKETİCİ, AYNI FONKSİYON ─────────────────────────────────────────────
//  1. `goods-receipt.addLines` → satır fiyatını çözerken (asıl karar noktası).
//  2. `invoice.createDraftFromGoodsReceipt` → `Roll.purchasePrice` BOŞ kalmış
//     satırlar için. Bu bugün iki durumda gerçekleşir: (a) 2026-08-15 ÖNCESİ
//     doğmuş toplar (kolon o gün doldurulmaya başlandı), (b) sözleşme fiyatı
//     ÇELİŞKİLİ olduğu için hiçbir katmanın dolduramadığı satırlar. Kopyayı
//     silmek (a)'yı geriye dönük kaybetmek olurdu.
// İki yüzey AYNI çelişki kuralını uygulamak ZORUNDA: ayrışsalardı fiş "sipariş
// fiyatını kullandım" derken fatura başka bir rakam basardı.
//
// ── ÇELİŞKİDE UYDURULMAZ ─────────────────────────────────────────────────────
// Aynı ürüne FARKLI fiyatlı iki sipariş kalemi düşüyorsa hangisinin geçerli
// olduğunu yalnız satın almacı bilir. Ortalama YASAK (sessiz yanlış fiyat, boş
// fiyattan kötüdür): katman `null` döner, zincir bir alta düşer ve durum
// SAYAÇLA raporlanır — sessiz doğru cevap, görünmez cevaptır.
//
// ⚠️ EŞLEŞME YALNIZ `itemId` İLE: `PurchaseOrderLine` renk/en TAŞIMAZ (şema),
// daraltacak ikinci bir alan yoktur.
// ⚠️ SAYAÇLAR KALEM BAZINDA (satır bazında DEĞİL): aynı ürünün 20 topu tek bir
// çelişkiyi 20 kez raporlardı.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

export interface ContractPriceResolver {
  /**
   * Kalemin SÖZLEŞME fiyatı — yoksa ya da ÇELİŞKİLİYSE `null`.
   * Yan etkilidir: çağrıldığı kalemi `pricedItems`/`conflictItems` kümesine yazar.
   */
  priceOf(itemId: string): Prisma.Decimal | null;
  /** Sözleşme fiyatı GERÇEKTEN kullanılmış kalemler. */
  readonly pricedItems: Set<string>;
  /** Sözleşme fiyatı çelişkili olduğu için ALTA düşülmüş kalemler. */
  readonly conflictItems: Set<string>;
}

/** Hiç sorgu koşmayan boş çözücü (sipariş bağı yok). */
function emptyResolver(): ContractPriceResolver {
  return { priceOf: () => null, pricedItems: new Set(), conflictItems: new Set() };
}

/**
 * Alış siparişinin kalem-başına TEKİL fiyat kümesini TEK SORGUDA yükler.
 *
 * ⚠️ Sipariş bağı yoksa TEK SORGU BİLE koşmaz — üretici fabrika yolunda
 * (siparişsiz mal kabul / siparişsiz fiş faturası) bu satır görünmez.
 */
export async function loadContractPrices(
  purchaseOrderId: string | null | undefined,
): Promise<ContractPriceResolver> {
  if (!purchaseOrderId) return emptyResolver();
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrderId, unitPrice: { not: null } },
    select: { itemId: true, unitPrice: true },
  });
  if (lines.length === 0) return emptyResolver();

  const byItem = new Map<string, Map<string, Prisma.Decimal>>();
  for (const l of lines) {
    const p = new Prisma.Decimal(l.unitPrice as Prisma.Decimal.Value);
    const bucket = byItem.get(l.itemId) ?? new Map<string, Prisma.Decimal>();
    // Anahtar `toString()`: `Decimal` nesne kimliğiyle değil DEĞERİYLE
    // tekilleşmeli (3.50 ile 3.5 aynı fiyattır, iki ayrı çelişki değil).
    bucket.set(p.toString(), p);
    byItem.set(l.itemId, bucket);
  }

  const pricedItems = new Set<string>();
  const conflictItems = new Set<string>();
  return {
    pricedItems,
    conflictItems,
    priceOf(itemId: string): Prisma.Decimal | null {
      const bucket = byItem.get(itemId);
      if (!bucket || bucket.size === 0) return null;
      if (bucket.size > 1) {
        conflictItems.add(itemId);
        return null;
      }
      pricedItems.add(itemId);
      return [...bucket.values()][0] as Prisma.Decimal;
    },
  };
}

/**
 * Sayaçların KULLANICIYA görünen cümlesi — hiçbir şey olmadıysa BOŞ string.
 *
 * "0 kalemde kullanıldı" YAZILMAZ: sıfır bir bilgi değil gürültüdür ve çelişki
 * cümlesinin önünde durup onu zayıflatır.
 */
export function describeContractPricing(
  counts: { pricedItems: number; conflictItems: number } | null | undefined,
): string {
  if (!counts) return "";
  const parts: string[] = [];
  if (counts.pricedItems > 0) parts.push(`${counts.pricedItems} kalemde sipariş fiyatı kullanıldı`);
  if (counts.conflictItems > 0) {
    parts.push(
      `${counts.conflictItems} kalemde sipariş fiyatı çelişkili — kart fiyatına düşüldü, kontrol edin`,
    );
  }
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}
