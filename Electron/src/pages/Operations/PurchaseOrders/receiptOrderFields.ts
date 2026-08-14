// =============================================================================
// MAL KABUL FORMUNDAKİ SİPARİŞ ALANLARI — SAF KURALLAR
// =============================================================================
// Mal kabul ekranı FABRİKADA DA kullanılıyor (alım-satım kurulumunun giriş
// kapısı, ama üretici fabrika da tek depolu bir mal kabul yapabiliyor). Alış
// siparişi ise TİCARET paketine aittir. Bu yüzden fiş formundaki sipariş
// seçicisi ve "kalemleri siparişten doldur" düğmesi KOŞULLUDUR.
//
// ⚠️ KURAL SAF BİR FONKSİYONDA YAŞAR, bileşenin içindeki bir `&&` zincirinde
// DEĞİL: zincir olarak bırakılsaydı tersine çevrilmesi hiçbir testi kırmazdı ve
// fabrikadaki bir mal kabul ekranında bir gün sessizce "Alış siparişi" kutusu
// belirirdi (projenin yazılı deseni: `canQuickShip`, `resolveRollTabs`,
// `canDraftInvoice`). Bekçi: `receiptOrderFields.test.ts`.
// =============================================================================
import { emptyLine, type DraftLine } from "../GoodsReceipts/ReceiptLineRows";
import { toNum, type DecimalLike, type ItemRef } from "./service";

/**
 * Fiş formunda sipariş alanları çizilir mi?
 *
 * İKİ koşul, ikisi de gerekli:
 *  ① **TİCARET REJİMİ** (`finance.enabled`) — fabrikada alış siparişi modülü
 *     kapalı; uçlar `requireFinanceEnabled` ile 403 döner, yani seçici çizilse
 *     bile boş kalır ve depocu "sipariş yok" sanardı.
 *  ② **OKUMA YETKİSİ** (`purchase-order:read | :write`) — yetkisi olmayan
 *     kullanıcıya seçici çizmek, açtığında 403 alan bir liste vaat etmektir.
 *
 * Belirsizken (bayrak henüz yüklenmedi) FALSE → fabrika görünümüne düşülür.
 * Yanlış tarafa düşmek fabrikada "kutu titremesi" demekti; ticarette yalnız
 * kısa bir gecikme (`useOperationsVisibilityContext` ile aynı yön).
 */
export function showPurchaseOrderFields(ctx: {
  financeEnabled: boolean;
  canReadPurchaseOrders: boolean;
}): boolean {
  return ctx.financeEnabled && ctx.canReadPurchaseOrders;
}

/** "Siparişten doldur" için gereken en küçük kalem şekli. */
export interface FillSourceLine {
  item: Pick<ItemRef, "id" | "name" | "unit" | "itemType">;
  /** Bekleyen miktar (backend `open-lines` bunu daima > 0 döndürür). */
  remainingQty: DecimalLike;
  unitPrice: DecimalLike | null;
}

export interface FillResult {
  lines: DraftLine[];
  /** Miktarı ÖN DOLDURULAN ürün adları (iplik/kg — kalem = tek hareket). */
  prefilled: string[];
  /** Miktarı BİLEREK boş bırakılan ürünler + bekleyen miktarları (kumaş). */
  blank: Array<{ name: string; remaining: number; unit: string }>;
}

/**
 * Sipariş kalemlerinden fiş taslak satırları üretir.
 *
 * ⚠️⚠️ METRAJ ÖN DOLDURULMAZ (kumaşta) ve bu, özelliğin EN ÖNEMLİ kuralıdır.
 * Fiş formunda `initialQty` **TOP BAŞINA** metredir, `count` ise kaç top
 * geldiğidir. Siparişin bekleyen miktarı ise bir TOPLAMDIR. 500 m bekleyen bir
 * kalemi `initialQty = 500, count = 1` diye doldurmak, kamyondan 5 adet ~100
 * metrelik top inerken sisteme **500 metrelik TEK bir top** yazmak demektir:
 * barkod sayısı yanlış, kesim/sevk/iade akışlarının tamamı yanlış ve hata
 * çıkmaz. Bu yüzden kumaşta yalnız ÜRÜN + FİYAT doldurulur, metrajı depocu
 * girer — ve bekleyen miktar ekranda referans olarak GÖSTERİLİR.
 *
 * ⚠️ İPLİKTE (YARN) durum tersidir: iplik satırı `Roll` doğurmaz, kg'lık tek bir
 * `YarnMovement` yazar. Orada "top başına" diye bir şey yoktur, kalan miktar
 * doğrudan doğru cevaptır — bu yüzden yalnız orada ön doldurulur.
 *
 * ⚠️ FİYAT ÖN DOLDURULUR ama EZİCİ DEĞİLDİR: satır fiyatı boş bırakılırsa
 * backend zaten cari/ürün fiyat listesinden çözüyor. Buradaki değer siparişin
 * ANLAŞILAN fiyatıdır ve fiş formunda düzenlenebilir kalır.
 *
 * ⚠️ Boş sonuç MEŞRU: tüm kalemler karşılanmışsa hiç satır üretilmez. Çağıran
 * bunu "hiçbir şey olmadı" diye sessiz geçmemeli, söylemeli.
 */
export function fillLinesFromOrder(sources: FillSourceLine[]): FillResult {
  const lines: DraftLine[] = [];
  const prefilled: string[] = [];
  const blank: FillResult["blank"] = [];

  for (const src of sources) {
    const remaining = toNum(src.remainingQty);
    // Karşılanmış (ya da bozuk) kalem satır üretmez — depocuya doldurulacak bir
    // şey kalmamış kalemi göstermek, formu gereksiz satırla şişirir.
    if (remaining <= 0) continue;

    const isYarn = src.item.itemType === "YARN";
    const unitPrice = src.unitPrice != null ? toNum(src.unitPrice) : null;

    lines.push({
      ...emptyLine(),
      itemId: src.item.id,
      // Kumaşta 0 = "depocu girecek"; iplikte kalan miktarın kendisi.
      initialQty: isYarn ? remaining : 0,
      unitPrice,
      count: 1,
    });

    if (isYarn) prefilled.push(src.item.name);
    else blank.push({ name: src.item.name, remaining, unit: src.item.unit });
  }

  return { lines, prefilled, blank };
}

/**
 * Doldurma sonucunun kullanıcıya söylenecek cümlesi.
 *
 * ⚠️ SESSİZ BAŞARI YOK: "3 satır eklendi" deyip metrajın neden boş kaldığını
 * yutmak, depocuyu boş kutulara bakıp "bozuk" demeye ya da daha kötüsü kalan
 * miktarı tek top diye yazmaya iter. Kural cümlede AÇIKÇA yazılır.
 */
export function describeFill(result: FillResult): string {
  if (result.lines.length === 0) {
    return "Bu siparişte bekleyen kalem kalmamış — eklenecek satır yok.";
  }
  const parts = [`${result.lines.length} satır eklendi`];
  if (result.prefilled.length > 0) {
    parts.push(`${result.prefilled.length} iplik kaleminin miktarı sipariş kalanından dolduruldu`);
  }
  if (result.blank.length > 0) {
    parts.push(
      `${result.blank.length} kumaş kaleminde METRE boş bırakıldı — metre TOP BAŞINA girilir, ` +
        `sipariş kalanı toplamdır`,
    );
  }
  return `${parts.join("; ")}.`;
}
