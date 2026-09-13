// =============================================================================
// SİPARİŞ KALEMİ KAPSAMI — "hangi kalem hâlâ talep sayılır" TEK KAYNAK
// =============================================================================
// 2026-08-27'de kalem iptali eklendi (`OrderLine.cancelledAt`). O günden sonra
// "açık talep" sorgularının HEPSİ iptal edilmiş kalemi dışlamak zorunda: WO
// picker, karşılanma, üretim dengesi, talep analizi, fason doğrudan sevk
// tahsisi… Elle kopyalanan bir `cancelledAt: null` bugün doğru olur, yarın
// birinin eklediği yeni yüzeyde unutulur ve iptal edilmiş kalem sessizce
// yaşamaya devam eder — planlamacı olmayan bir işi üretime alır.
//
// Bu yüzden koşul BURADA yaşar ve elle kopyalanması AST bekçisiyle yasaktır
// (`scripts/test_order_line_scope_single_source.ts`) — fason "açık+outstanding
// sevk" koşulunun (`fason-open-dispatch.helper.ts`) birebir emsali.
//
// ⚠️ NEREDE KULLANILMAZ: DEFTER ve TARİHÇE yüzeyleri. İptal edilmiş kalemin
// SEVK EDİLMİŞ metrajı gerçektir ve kaybolmamalıdır —
//   • `computeLineLedgerTx` (sevk toplamı) iptal kalemi de okur,
//   • `recomputeOrderStatusTx` iptal kalemin İSTENEN'ini değil SEVK EDİLEN'ini sayar,
//   • sevkiyat detayı / irsaliye / muhasebe export'u geçmişi olduğu gibi basar.
// Kural tek cümleyle: **GELECEK sorusu süzer, GEÇMİŞ sorusu süzmez.**
// =============================================================================

import { ItemUnit, Prisma } from "@prisma/client";
import { isMeasuredUnit, LEDGER_UNIT } from "../../constants/item-unit";

/** İptal edilmemiş (aktif) kalem. `cancelledAt IS NULL` = aktif. */
export const ACTIVE_LINE = { cancelledAt: null } as const;

/**
 * `ACTIVE_LINE`in BELLEK-İÇİ İKİZİ — satırlar zaten çekilmişken kullanılır.
 *
 * NEDEN İKİZ GEREKTİ: bir sorgu hem AKTİF hem İPTAL kalemi aynı anda görmek
 * zorunda kalabilir (Müşteri Karnesi'nin iptal oranı: "bu dönemde verilen
 * siparişlerin ne kadarı iptal edildi"). Prisma'da aynı ilişkiyi iki farklı
 * süzgeçle bir kerede seçmek yok; alternatif iki ayrı sorgu atıp aralarında
 * bir yazma olma riskini almaktı. Bu yüzden satırlar SÜZGEÇSİZ çekilir ve
 * ayrım burada, TEK yüklemle yapılır.
 *
 * ⚠️ Yüklem `ACTIVE_LINE` ile AYNI ŞEYİ söylemek ZORUNDA — ayrışırsa aynı
 * sorunun iki cevabı olur. (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`
 * boğaz-ikiz deseninin birebir emsali.)
 */
export const isActiveLine = (line: { cancelledAt: Date | null }): boolean =>
  line.cancelledAt === null;

/**
 * Aktif VE hâlâ açık kalem: istenen > sevk edilen.
 *
 * `quantity: { gt: <shippedQty alanı> }` alan-karşılaştırmasıdır ve Prisma'da
 * `prisma.orderLine.fields` referansı ister; çağıran client'ı (prisma ya da tx)
 * geçirir çünkü tx içinde `prisma.*` kullanmak farklı bir bağlantıdır.
 */
export function openLineWhere(fields: {
  shippedQty: Prisma.FieldRef<"OrderLine", "Decimal">;
}): { cancelledAt: null; quantity: { gt: Prisma.FieldRef<"OrderLine", "Decimal"> } } {
  return { ...ACTIVE_LINE, quantity: { gt: fields.shippedQty } };
}

/**
 * Siparişin AKTİF kalemi var mı — "lines: { some: … }" biçiminde.
 * Sipariş listesi/picker'ları bunu kullanır: tüm kalemleri iptal edilmiş bir
 * sipariş artık üretilecek bir iş taşımaz.
 */
export function someOpenLine(fields: {
  shippedQty: Prisma.FieldRef<"OrderLine", "Decimal">;
}): { lines: { some: ReturnType<typeof openLineWhere> } } {
  return { lines: { some: openLineWhere(fields) } };
}

/**
 * Aktif kalemin karşılaması metre defterinden ÖLÇÜLÜR mü — Σ TALEP süzgeci.
 *
 * KG/ADET satırın `shippedQty`si hiç yazılmaz (`isMeasuredUnit`); metre toplayan
 * bir yüzey onu "hiç sevk edilmemiş 100 m" sanır ve talebe ekler. Bu yüzden metre
 * Σ soran her sorgu `ACTIVE_LINE`a ek olarak bunu da taşır (üretim dengesi, stok
 * karnesi). Bellek-içi ikizi `isMeasuredLine` — ikisi aynı şeyi söylemek ZORUNDA.
 *
 * ⚠️ NEREDE KULLANILMAZ: "üretime alınabilir mi" sorusu (WO picker, linkable).
 * KG satır üretime alınabilir kalır; o yüzeyler süzmez, `openQty`yi null yapar
 * ("ölçülmüyor"). Tahsis (`allocation.helper`) da süzmez: need = quantity − shippedQty.
 */
export const MEASURED_LINE = { unit: LEDGER_UNIT } as const;

/** `MEASURED_LINE`in bellek-içi ikizi (`unit` kolonu NOT NULL, varsayılan MT). */
export const isMeasuredLine = (line: { unit: ItemUnit | null | undefined }): boolean =>
  isMeasuredUnit(line.unit);
