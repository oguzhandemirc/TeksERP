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
import { OPEN_WORK_ORDER } from "../helpers/live-ref-where.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { workOrderCustomerWhere } from "../helpers/work-order-customers.helper";
import { FILTERABLE_STAGES, workOrderFirmWhere, workOrderOrderWhere, workOrderStageWhere, type FilterableStage } from "../../cloud-sync/work-order-facts";

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
  // `acik` ↔ OPEN_WORK_ORDER; müşteri adı açık bağın sipariş müşterisinden (bulut `musteriAdi`nın ERP karşılığı).
  "is-emri": {
    alanlar: ["isEmriNo", "musteriAdi", "siparisNolari"],
    terim: (t) => [
      { workOrderNumber: { contains: t, mode: "insensitive" } },
      { orderLinks: { some: { ...ACTIVE_ORDER_LINK, orderLine: { order: { customer: { nameFold: { contains: t } } } } } } },
      { orderLinks: { some: { ...ACTIVE_ORDER_LINK, orderLine: { order: { orderNumber: { contains: t, mode: "insensitive" } } } } } },
    ],
    secenekler: [
      { deger: "ACIK", alan: "acik", esit: true, where: () => OPEN_WORK_ORDER as Where },
      { deger: "KAPALI", alan: "acik", esit: false, where: () => ({ NOT: OPEN_WORK_ORDER }) as Where },
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

/** Bulut `LIST_MEMBER_FILTER_KEYS` aynası (aynı sıra). */
export const MEMBER_FILTER_KEYS = ["cariKartId", "siparisId", "fasonFirmaId", "asama"] as const;
export type MemberFilterKey = (typeof MEMBER_FILTER_KEYS)[number];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bulut `LIST_MEMBER_FILTERS` aynası: küme → anahtar → (dizi alanı, Prisma ikizi). Dizi alanını fabrika aynı parçadan
 * türetir (`work-order-facts`); `cariKartId` panelin İE müşteri süzgeci (`workOrderCustomerWhere`). Biçimsiz değer → null.
 */
export const MEMBER_FILTERS: Readonly<Record<string, Readonly<Partial<Record<MemberFilterKey, { alan: string; where: (v: string) => Promise<Where | null> }>>>>> = {
  "is-emri": {
    cariKartId: { alan: "cariKartIdleri", where: async (v) => (UUID_RE.test(v) ? ((await workOrderCustomerWhere(v.toLowerCase())) as Where) : null) },
    siparisId: { alan: "siparisIdleri", where: async (v) => (UUID_RE.test(v) ? (workOrderOrderWhere(v.toLowerCase()) as Where) : null) },
    fasonFirmaId: { alan: "fasonFirmaIdleri", where: async (v) => (UUID_RE.test(v) ? (workOrderFirmWhere(v.toLowerCase()) as Where) : null) },
    asama: { alan: "asamalar", where: async (v) => ((FILTERABLE_STAGES as readonly string[]).includes(v) ? (workOrderStageWhere(v as FilterableStage) as Where) : null) },
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

/** Bulut `ListSortKind` aynası. */
export type SortKind = "metin" | "sayi" | "tarih";
export interface SortField { readonly kind: SortKind; readonly source: string; readonly nullable: boolean }

/**
 * Bulut `LIST_SORT`un ERP'de SAKLI kolonu olan alt kümesi (D7): türetilmiş alan (müşteri adı, açık miktar, top/metre)
 * sıralanmaz. Metin yalnız ASCII kod/no alanlarında (fabrika DB'sinin harmanlaması Türkçe katlama yapmaz). `nullable`
 * kolonun şemadaki boşluğudur (Prisma `nulls: "last"` yalnız boş olabilen kolonda geçerli).
 */
export const SORT: Readonly<Record<string, Readonly<Record<string, SortField>>>> = {
  siparis: {
    siparisNo: { kind: "metin", source: "orderNumber", nullable: false },
    siparisTarihi: { kind: "tarih", source: "orderDate", nullable: false },
    termin: { kind: "tarih", source: "deadline", nullable: true },
    sevkMiktari: { kind: "sayi", source: "shippedQty", nullable: false },
  },
  "is-emri": {
    isEmriNo: { kind: "metin", source: "workOrderNumber", nullable: false },
    planBitis: { kind: "tarih", source: "plannedEndDate", nullable: true },
    olusturulma: { kind: "tarih", source: "createdAt", nullable: false },
  },
  sevkiyat: {
    sevkNo: { kind: "metin", source: "shipmentNo", nullable: false },
    cikisTarihi: { kind: "tarih", source: "dispatchedAt", nullable: false },
  },
  "cari-kart": { kod: { kind: "metin", source: "code", nullable: false } },
};
