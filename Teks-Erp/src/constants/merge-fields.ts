// =============================================================================
// BİRLEŞTİRMEDE ALAN SEÇİMİ (survivorship) — tek kaynak (panel v2 P2, 2026-08-22)
// =============================================================================
// MDM kalıbı "altın kayıt": hayatta kalan kayıt seçilir, sonra ALAN ALAN hangi
// değerin kalacağına karar verilir (Dynamics 365 merge'ün "master + alan seçimi"
// düzeni). Bizde de öyle: `preview` her alan için mevcut değerleri + bir ÖNERİ
// döndürür, operatör isterse kaynağın değerini seçer, `merge` seçilenleri
// survivor'a yazar (tx içinde, kaynaklar tombstone olduktan SONRA).
//
// ⚠️ SEÇİM DEĞER DEĞİL **KAYIT** ÜZERİNDEN yapılır (`fieldPicks[field] = recordId`).
// Serbest metin alınsaydı uç, "birleştirme" kılığında sınırsız bir alan düzenleme
// API'si olurdu (Zod ne yazarsa yazsın: kimlik alanı, başka bir müşterinin VKN'si…).
// Kayıt id'si ile sunucu değeri KENDİ okur; yazılabilecek değer kümesi = o gruptaki
// kayıtların mevcut değerleri.
//
// ⚠️ `code` BİLİNÇLİ OLARAK SEÇİLEBİLİR DEĞİL. İki sebep: (1) `@unique` — survivor'a
// kaynağın kodunu yazmak, kaynak hâlâ o kodu taşıdığı için kısıt kavgası demektir
// (kaynağın kodunu "serbest bırakmak" ise tombstone'un kimliğini bozar: birleşmiş
// kaydı arayan kişi onu kodundan bulur); (2) kod belgelere basılır — sevk irsaliyesi,
// çeki listesi, etiket. Kodu değiştirmek isteyen bunu AYRI bir karar olarak,
// tanım ekranından yapar.
//
// ⚠️ KİMLİK ALANLARI (`Customer.type`, `Item.unit`) burada YOK: onlar zaten
// birleştirmeyi ENGELLER (`META.identityFields` → blocker). "MT ölçülen kumaşı KG'a
// birleştirme" kararı bir alan seçimi değil, bir hatadır.
// =============================================================================
import type { MergeEntity } from "./merge-map";

export interface MergeableField {
  /** Prisma/DB kolon adı. */
  field: string;
  /** Panelde görünen Türkçe etiket. */
  label: string;
  /**
   * `text`   — düz metin (varsayılan)
   * `ref`    — başka bir kaydın id'si (panel ham UUID basmaz, "atanmış/atanmamış" der)
   * `number` — sayısal
   */
  kind?: "text" | "ref" | "number";
}

/**
 * Varlık → seçilebilir alanlar. Sıra PANELDEKİ sıradır (en çok bakılan üstte).
 * ⚠️ Buraya alan eklemek, o alanın survivor'a YAZILABİLİR olması demektir; kolonun
 * gerçekten var olduğunu bekçi (`test_merge_field_picks` §0, DMMF) doğrular.
 */
export const MERGEABLE_FIELDS: Record<MergeEntity, readonly MergeableField[]> = {
  customer: [
    { field: "name", label: "Ad" },
    { field: "taxNumber", label: "Vergi no" },
    { field: "exportCode", label: "İhracat kodu" },
    { field: "address", label: "Adres" },
    { field: "city", label: "İl" },
    { field: "district", label: "İlçe" },
    { field: "country", label: "Ülke" },
    { field: "contactName", label: "Yetkili" },
    { field: "contactPhone", label: "Telefon" },
    { field: "email", label: "E-posta" },
    { field: "notes", label: "Not" },
    { field: "documentProfileId", label: "Belge profili", kind: "ref" },
  ],
  subcontractor: [
    { field: "name", label: "Ad" },
    { field: "taxNumber", label: "Vergi no" },
    { field: "phone", label: "Telefon" },
    { field: "address", label: "Adres" },
    { field: "documentProfileId", label: "Belge profili", kind: "ref" },
  ],
  item: [
    { field: "name", label: "Ad" },
    // `unit` ve `itemType` kimlik alanı sayılır (unit blocker; itemType değişimi
    // kumaşı iplik yapar) — seçime AÇILMAZ.
  ],
  color: [
    { field: "name", label: "Ad" },
    { field: "hex", label: "Renk kodu (HEX)" },
    { field: "sortOrder", label: "Sıra", kind: "number" },
  ],
};

/** Alan seçilebilir mi (uçtaki Zod ve serviste aynı kaynak). */
export function isMergeableField(entity: MergeEntity, field: string): boolean {
  return MERGEABLE_FIELDS[entity].some((f) => f.field === field);
}

/** Ad alanı — seçilirse mükerrer ad guard'ı koşar (tek yerde yazılı). */
export const MERGE_NAME_FIELD = "name";
