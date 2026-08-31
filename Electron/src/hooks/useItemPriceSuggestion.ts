// =============================================================================
// KALEM FİYAT ÖNERİSİ — ortak kanca (fatura satırı · sipariş kalemi · alış siparişi)
// =============================================================================
// D2'nin tüketici yarısı: `GET /api/item-prices/resolve` (müşteri istisnası >
// kart varsayılanı > null) üç yüzeyde de AYNI kurallarla alana yazılır. Üç ayrı
// uygulama "aynı kalem iki formda farklı fiyat önerdi" demekti — kural TEK.
//
// ── YAZMA KURALI (saf katman: `shouldApplySuggestion`) ─────────────────────
//   • Alan BOŞ/0 iken → öneri YAZILIR.
//   • Alan hâlâ kancanın en son YAZDIĞI değeri taşıyorsa (kullanıcı dokunmadı)
//     ve kaynak değişti (başka kalem/müşteri/tür) → öneri TAZELENİR.
//   • Kullanıcı elle bir değer yazdıysa → ASLA ezilmez.
//   • Çözüm YOKSA alan aynen kalır; yalnız kancanın kendi yazdığı bayat öneri
//     temizlenir (`shouldClearSuggestion`) — başka kalemin fiyatını sessizce
//     taşımak, boş bırakmaktan kötüdür.
//   • Fiyat çözülemezse SIFIR YAZILMAZ (backend sözleşmesi: "bulunamadı" ≠
//     "bedava"); mesaj küçük yardımcı metin olarak gösterilir.
//
// ── REJİM KAPISI ────────────────────────────────────────────────────────────
// `/api/item-prices/*` router'ı `requireFinanceEnabled` taşır — bayrak kapalı
// fabrikada istek 403 üretir VE interceptor toast basar. Bu yüzden kanca
// `financeEnabled`'ı KENDİSİ okur ve bayrak kapalıyken istek HİÇ atılmaz;
// tüketicinin unutabileceği bir kapı değil, kancanın kendi sözleşmesidir.
//
// ⚠️ Saf fonksiyonlar (isBlank* / sameSuggestionValue / shouldApply* /
// computeDueDateSuggestion / describeSuggestion) React'sız test edilir —
// `useItemPriceSuggestion.test.ts`. Kuralı değiştirirken önce testi değiştir.
// =============================================================================
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";

// ─────────────────────────────────────────────────────────────────────────────
// SAF KATMAN — React yok, HTTP yok.
// ─────────────────────────────────────────────────────────────────────────────

export type SuggestionValue = string | number | null | undefined;

/** `/resolve` ucunun kabul ettiği para birimleri — Zod enum'unun aynası.
 *  Sipariş formunun para birimi SERBEST METİNDİR (max 8 karakter); enum dışı
 *  bir değerle istek atmak kesin 400 + toast üretirdi → istek hiç atılmaz. */
export const RESOLVABLE_CURRENCIES = ["TRY", "USD", "EUR", "GBP", "RUB"] as const;
export type ResolvableCurrency = (typeof RESOLVABLE_CURRENCIES)[number];

export function isResolvableCurrency(c: string | null | undefined): c is ResolvableCurrency {
  return Boolean(c) && (RESOLVABLE_CURRENCIES as readonly string[]).includes(c as string);
}

export type ItemPriceKind = "SALE" | "PURCHASE";

/** Fatura türü → fiyat türü. İade, yönün AYNISINI kullanır (satış iadesi satış
 *  fiyatından kesilir — iade orijinal belgeyi aynalar). */
export function priceKindForInvoiceType(
  t: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN",
): ItemPriceKind {
  return t === "PURCHASE" || t === "PURCHASE_RETURN" ? "PURCHASE" : "SALE";
}

/** Fiyat alanı için "boş" tanımı: hiç değer yok YA DA 0 (formların boş satır
 *  varsayılanı 0'dır). Sayıya çevrilemeyen metin kullanıcının yazdığı bir
 *  şeydir → boş SAYILMAZ, dokunulmaz. */
export function isBlankPrice(v: SuggestionValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return false;
  return n === 0;
}

/** Metin alanı (açıklama / tarih) için "boş" tanımı — yalnız gerçekten boş. */
export function isBlankText(v: SuggestionValue): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

/** İki alan değeri aynı mı? Sayıya çevrilebilen çift SAYISAL karşılaştırılır
 *  ("100" ↔ 100 aynıdır — sipariş formu fiyatı string tutar), aksi hâlde metin
 *  birebir. Boş değer hiçbir şeyle "aynı" değildir. */
export function sameSuggestionValue(a: SuggestionValue, b: SuggestionValue): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (sa === "" || sb === "") return false;
  const na = Number(sa);
  const nb = Number(sb);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return sa === sb;
}

/**
 * ÇEKİRDEK YÜKLEM — öneri ne zaman YAZAR.
 *
 *   boşken          → yazar
 *   kaynak değişince → alan hâlâ en son yazdığımız değeri taşıyorsa yazar
 *   değişmişken     → (kullanıcı elle yazdı) ASLA yazmaz
 *   çözüm yoksa     → yazmaz (temizleme ayrı yüklem: `shouldClearSuggestion`)
 */
export function shouldApplySuggestion(args: {
  current: SuggestionValue;
  /** Kancanın bu alana en son YAZDIĞI değer — kullanıcı dokunduysa artık eşleşmez. */
  lastApplied: string | number | null;
  resolved: string | number | null;
  /** Boşluk tanımı — fiyatta 0 da boştur, metin/tarihte değildir. */
  isBlank?: (v: SuggestionValue) => boolean;
}): boolean {
  const blank = args.isBlank ?? isBlankPrice;
  if (args.resolved === null || args.resolved === undefined) return false;
  if (blank(args.current)) return true;
  if (args.lastApplied !== null && sameSuggestionValue(args.current, args.lastApplied)) return true;
  return false;
}

/** Kaynak değişti ve YENİ kaynak için çözüm yok: alan hâlâ ESKİ önerimizi
 *  taşıyorsa temizlenir. Kullanıcının elle yazdığı değere dokunmaz. */
export function shouldClearSuggestion(args: {
  current: SuggestionValue;
  lastApplied: string | number | null;
}): boolean {
  return args.lastApplied !== null && sameSuggestionValue(args.current, args.lastApplied);
}

/**
 * Vade önerisi: fatura tarihi (YYYY-MM-DD) + cari vade günü → YYYY-MM-DD.
 * `termDays` yoksa `null` — UYDURMA VADE YOK; yaşlandırmanın "vadesiz" kovası
 * dürüst kalır. Gün aritmetiği yerel takvimle yapılır (saat dilimi oynamaz);
 * ay/yıl taşmasını `Date` kendisi normalleştirir.
 */
export function computeDueDateSuggestion(
  issueYmd: string,
  termDays: number | null | undefined,
): string | null {
  if (termDays === null || termDays === undefined) return null;
  if (!Number.isInteger(termDays) || termDays < 0) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueYmd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + termDays);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type ResolvedPriceSource = "CUSTOMER" | "DEFAULT";

/**
 * Alan altındaki yardımcı metin. Backend cümlesi ("… uygulandı.") yalnız değer
 * GERÇEKTEN alandayken aynen basılır; kullanıcı kendi fiyatını korumuşsa
 * "uygulandı" demek yalan olurdu → tanımlı fiyat bilgi olarak söylenir.
 * Çözüm yoksa backend'in kendi cümlesi geçer ("Tanımlı fiyat yok — fiyatı elle
 * girin.") — 0 TL DENMEZ.
 */
export function describeSuggestion(args: {
  price: number | null;
  source: ResolvedPriceSource | null;
  message: string | null;
  current: SuggestionValue;
}): string | null {
  if (args.message === null) return null;
  if (args.price === null) return args.message;
  if (sameSuggestionValue(args.current, args.price)) return args.message;
  const kaynak = args.source === "CUSTOMER" ? "müşteriye özel" : "kart varsayılanı";
  const tutar = args.price.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Tanımlı fiyat ${tutar} (${kaynak}) — elle girilen değer korundu.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP istemcisi
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedItemPriceSuggestion {
  /** Çözülen birim fiyat — YOKSA null (asla 0'a düşürülmez). */
  price: number | null;
  source: ResolvedPriceSource | null;
  /** Backend'in çözüm cümlesi — yardımcı metin olarak aynen basılır. */
  message: string | null;
}

/** `GET /api/item-prices/resolve` — yol TAM yazılır (`apiClient.baseURL` `/api`
 *  içermez; öneksiz yol 404 alır ve hata sessizce "öneri yok" görünürdü). */
export async function resolveItemPriceRequest(params: {
  itemId: string;
  kind: ItemPriceKind;
  currency: ResolvableCurrency;
  customerId?: string | null;
}): Promise<ResolvedItemPriceSuggestion> {
  const res = await apiClient.get("/api/item-prices/resolve", {
    params: {
      itemId: params.itemId,
      kind: params.kind,
      currency: params.currency,
      // Hiç göndermemek = kart varsayılanı (backend "" transform'u da aynı yere
      // çıkar; parametreyi hiç taşımamak daha net).
      ...(params.customerId ? { customerId: params.customerId } : {}),
    },
  });
  const body = res.data as {
    success: boolean;
    data: { id: string; price: number | string; source: ResolvedPriceSource } | null;
    message?: string;
  };
  const n = body.data === null || body.data === undefined ? null : Number(body.data.price);
  return {
    price: n !== null && Number.isFinite(n) ? n : null,
    source: body.data?.source ?? null,
    message: body.message ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KANCA
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemPriceSuggestionArgs {
  itemId: string | null | undefined;
  kind: ItemPriceKind;
  /** Serbest metin olabilir (sipariş formu) — enum dışıysa istek atılmaz. */
  currency: string | null | undefined;
  /** Müşteri istisnası için CUSTOMER tarafının id'si; fason cari / tedarikçisiz
   *  bağlamda null → kart varsayılanı aranır. */
  customerId?: string | null;
  /** Ek kapı (ör. salt-okunur form). `financeEnabled` kapısı kancanın KENDİ
   *  içindedir, buraya taşınmaz. */
  enabled?: boolean;
  /** Alanın ŞU ANKİ değeri — yazma kararı bununla verilir. */
  current: SuggestionValue;
  /** Öneri yazılırken çağrılır; `null` = bayat önerimizi temizle (yalnız alan
   *  hâlâ bizim yazdığımız değeri taşıyorsa gelir). */
  onApply: (price: number | null) => void;
}

export interface ItemPriceSuggestionState {
  /** Ham çözüm mesajı — çoğu yüzey `describeSuggestion` çıktısını basar. */
  message: string | null;
  source: ResolvedPriceSource | null;
  price: number | null;
  isLoading: boolean;
}

export function useItemPriceSuggestion(args: ItemPriceSuggestionArgs): ItemPriceSuggestionState {
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const customerId = args.customerId ?? null;

  const active =
    financeEnabled &&
    (args.enabled ?? true) &&
    Boolean(args.itemId) &&
    isResolvableCurrency(args.currency);

  const q = useQuery({
    queryKey: ["item-price-suggestion", args.itemId ?? null, args.kind, args.currency ?? null, customerId],
    queryFn: () =>
      resolveItemPriceRequest({
        itemId: args.itemId as string,
        kind: args.kind,
        currency: args.currency as ResolvableCurrency,
        customerId,
      }),
    enabled: active,
    staleTime: 30_000,
  });

  // Alan değeri ve callback REF'ten okunur: effect'in bağımlılığı yalnız ÇÖZÜM
  // olmalı. `current` bağımlılığa girseydi kullanıcının alanı boşaltması
  // effect'i yeniden koşturur ve bilinçli boşaltılan alan sessizce geri
  // dolardı ("boşken doldur" kuralı yalnız ÇÖZÜM ANI için geçerlidir).
  const currentRef = useRef<SuggestionValue>(args.current);
  currentRef.current = args.current;
  const onApplyRef = useRef(args.onApply);
  onApplyRef.current = args.onApply;
  const lastAppliedRef = useRef<number | null>(null);

  const data = active ? q.data : undefined;

  useEffect(() => {
    if (!data) return;
    if (data.price !== null) {
      if (
        shouldApplySuggestion({
          current: currentRef.current,
          lastApplied: lastAppliedRef.current,
          resolved: data.price,
          isBlank: isBlankPrice,
        })
      ) {
        onApplyRef.current(data.price);
        lastAppliedRef.current = data.price;
      }
    } else if (
      shouldClearSuggestion({ current: currentRef.current, lastApplied: lastAppliedRef.current })
    ) {
      onApplyRef.current(null);
      lastAppliedRef.current = null;
    }
  }, [data]);

  return {
    message: active && data !== undefined ? data.message : null,
    source: active ? (data?.source ?? null) : null,
    price: active ? (data?.price ?? null) : null,
    isLoading: active && q.isLoading,
  };
}
