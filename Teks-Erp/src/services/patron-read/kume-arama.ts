// =============================================================================
// PATRON OKUMA UCU — küme başına arama, süzgeç ve sıralama beyanları (V3a → V3c)
// =============================================================================
// Bulut `LIST_SEARCH` / `LIST_KEY_FILTERS` (`patron/sunucu/src/wire/api.ts`) beyanlarının ERP karşılığı: seçenek
// (deger, alan, esit) eşitliğini `test_patron_okuma_ucu` §1f ölçer. Türetilmiş alan süzgeci (gecikmiş, süresi
// dolmuş, kasa kategorisi) bellek yükleminin boğaz-ikiz Prisma parçasından gelir — burada yeni kural yazılmaz.
// =============================================================================
import { overdueOrderWhere } from "../helpers/order-deadline.helper";
import { quoteExpiredWhere, quoteToday } from "../helpers/sales-quote-state.helper";
import { cashCategoryWhere, parseCashCategoryKey } from "../helpers/cash-category-filter.helper";
import { cariIdsResolvingTo } from "../../cloud-sync/derived-merged-invoice";

export type Where = Record<string, unknown>;
export interface SearchOption { readonly deger: string; readonly alan: string; readonly esit: string | boolean; readonly where: (nowMs: number) => Where }
export interface SearchSpec { readonly alanlar: readonly string[]; readonly terim: (token: string) => Where[]; readonly secenekler: readonly SearchOption[] }

const eq = (deger: string, alan: string, esit: string | boolean, source: string): SearchOption => ({ deger, alan, esit, where: () => ({ [source]: esit }) });
const nameOrCode = (t: string): Where[] => [{ nameFold: { contains: t } }, { code: { contains: t, mode: "insensitive" } }];

/** Bulut `LIST_SEARCH`in sunulan kümelerdeki aynası. */
export const SEARCH: Readonly<Record<string, SearchSpec>> = {
  "cari-kart": {
    alanlar: ["ad", "kod"],
    terim: nameOrCode,
    secenekler: [eq("MUSTERI", "musteriRolu", true, "isCustomerRole"), eq("TEDARIKCI", "tedarikciRolu", true, "isSupplierRole"), eq("FASON", "fasonRolu", true, "isSubcontractorRole")],
  },
  urun: {
    alanlar: ["ad", "kod"],
    terim: nameOrCode,
    secenekler: [eq("FABRIC", "tur", "FABRIC", "itemType"), eq("YARN", "tur", "YARN", "itemType"), eq("CONSUMABLE", "tur", "CONSUMABLE", "itemType")],
  },
  renk: {
    alanlar: ["ad", "kod"],
    terim: nameOrCode,
    secenekler: [eq("AKTIF", "aktif", true, "isActive"), eq("PASIF", "aktif", false, "isActive")],
  },
  siparis: {
    alanlar: ["siparisNo", "musteriAdi"],
    terim: (t) => [{ orderNumber: { contains: t, mode: "insensitive" } }, { customer: { nameFold: { contains: t } } }],
    secenekler: [
      { deger: "GECIKMIS", alan: "gecikmis", esit: true, where: overdueOrderWhere },
      eq("BEKLEMEDE", "durum", "PENDING", "status"), eq("ONAYLANDI", "durum", "APPROVED", "status"),
      eq("KISMI_SEVK", "durum", "PARTIAL_SHIPPED", "status"), eq("TAMAMLANDI", "durum", "COMPLETED", "status"), eq("IPTAL", "durum", "CANCELLED", "status"),
    ],
  },
  teklif: {
    alanlar: ["no", "musteriAdi"],
    terim: (t) => [{ quoteNo: { contains: t, mode: "insensitive" } }, { customer: { nameFold: { contains: t } } }],
    secenekler: [
      eq("GONDERILDI", "durum", "SENT", "status"),
      // `suresiDoldu` türetilmiş: `isQuoteExpired` ↔ `quoteExpiredWhere` ikizi, fabrika günü istek anından.
      { deger: "SURESI_DOLDU", alan: "suresiDoldu", esit: true, where: (nowMs) => quoteExpiredWhere(quoteToday(new Date(nowMs))) as Where },
      eq("KABUL", "durum", "ACCEPTED", "status"), eq("SIPARIS", "durum", "CONVERTED", "status"),
      eq("RED", "durum", "REJECTED", "status"), eq("IPTAL", "durum", "CANCELLED", "status"),
    ],
  },
};

/** Bulut `LIST_KEY_FILTERS` aynası: anahtar → kabul eden kümeler. */
export const KEY_FILTERS: Readonly<Record<"kategoriAnahtari", readonly string[]>> = { kategoriAnahtari: ["kasa-hareketi"] };
export const KEY_FILTER_MAX = 200;

/**
 * Anahtar süzgeci → Prisma parçası; `null` = sonuç kesin boş. Bulut birebir eşitler: tanınmayan biçim HATA değil
 * boş liste (panel ucunun 400'ü burada uygulanmaz). Eşleşme panel/masraf özetiyle aynı helper'dan.
 */
export async function keyFilterWhere(value: string): Promise<Where | null> {
  if (parseCashCategoryKey(value) === null) return null;
  return (await cashCategoryWhere(value)) as Where;
}

/**
 * Tel değeri ÇÖZÜCÜDEN gelen kimlik süzgeçleri (`resolvedBy` kolon; ham kolon eşitliği yanlış listedir).
 * Anahtar `<küme>.<süzgeç>`; değer küçük harf UUID. `null` = sonuç kesin boş.
 */
export const RESOLVED_ID_FILTERS: Readonly<Record<string, (id: string) => Promise<Where | null>>> = {
  // Birleşmiş carinin faturası hedef hesap altında görünür (D4-K3dk2): süzgeç aynı zincirin tersiyle.
  "fatura.cariHesapId": async (id) => {
    const ids = await cariIdsResolvingTo(id);
    return ids.length > 0 ? { cariId: { in: ids } } : null;
  },
};

/**
 * Sıralama KAYNAK kolonu (bulut `sortFields`in ilk dolu alanı; kolon NOT NULL olmalı ki imleç kayıpsız olsun).
 * Bulutta sıralama alanı olmayan kök (ufuk) ve ilk alanı boş olabilen `sevkiyat` (cikisTarihi?) doğuş anıyla sıralanır.
 */
export const SORT_SOURCE: Readonly<Record<string, string>> = {
  siparis: "orderDate", "dogrudan-sevk": "shippedAt",
  "cari-hareket": "txnDate", "kasa-hareketi": "txnDate", "cek-senet": "dueDate", "cek-hareketi": "eventDate",
  fatura: "issueDate", "tahsilat-odeme": "paymentDate", teklif: "quoteDate", "standart-maliyet": "computedAt",
};
export const sortSourceOf = (name: string): string => SORT_SOURCE[name] ?? "createdAt";
