// =============================================================================
// KALEM FİYATI — API İSTEMCİSİ (Paket D · D2 panel yüzeyi)
// =============================================================================
// NEDEN VAR: Fiyat bir DEFTER KAYDI değil bir AYARDIR — kalem kartının
// varsayılanı vardır, bazı müşterilerin istisnası vardır. Bu dosya o ayarın
// panel tarafındaki tek kapısıdır.
//
// ⚠️ YOLLAR TAM YAZILIR ("/api/item-prices…") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "Sonuç yok."
// gösterir; yani YANLIŞ KAPIYA giden istek "kayıt yok" gibi okunur (2026-08-12
// FilterBar vakası).
//
// ⚠️ ÇÖZÜM SIRASI BURADA YENİDEN YAZILMAZ. Backend `item-price.service.ts`
// dosyasının başlığı bunu açıkça yasaklıyor: "Sırayı KOPYALAMA". Panel
// "hangi fiyat geçerli" sorusunu HER ZAMAN `/resolve` ucuna sorar
// (`resolveItemPrice` aşağıda). İstemcide ikinci bir uygulama, ileride kural
// değişince (ör. tarih aralıklı fiyat) iki farklı fiyat üreten iki yüzey
// demektir ve hangisinin doğru olduğu ancak fatura basılınca anlaşılır.
//
// ⚠️ TUTARLAR Decimal'dir ve JSON'a **STRING** düşer ("42" / "42.5000"). Bu
// dosyadaki `price` alanları bu yüzden `DecimalLike` tiplenir, `number` DEĞİL:
// `number` diye tiplemek derlemede yeşil kalır ama çalışma anında
// `String.prototype.toLocaleString` devreye girer ve o, `minimumFractionDigits`
// gibi seçenekleri SESSİZCE YOK SAYAR ("3324" → "3324", olması gereken
// "3.324,00"). Ekrana giden her tutar `priceText()` ya da `toNum()`
// süzgecinden geçer.
// =============================================================================
import apiClient from "@/services/apiClient";
import { CURRENCY_SYMBOL, money, type Currency } from "@/pages/Finance/service";

export type { Currency };

/** Backend `PriceKind` enum'unun aynası (Electron backend'i import edemez). */
export type PriceKind = "PURCHASE" | "SALE";

/** Fiyatın nereden geldiği — backend `PriceSource`. */
export type PriceSource = "CUSTOMER" | "DEFAULT";

/** Decimal kolonun JSON karşılığı — number DA string DE gelebilir (dosya başlığı). */
export type DecimalLike = number | string;

/** Backend Zod şemasının kabul ettiği para birimleri — sıra ekranda da bu. */
export const CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

export const PRICE_KINDS: PriceKind[] = ["PURCHASE", "SALE"];

/**
 * ⚠️ "Alış" / "Satış" — kullanıcı bu iki kelimeyi görür, `PURCHASE`/`SALE`
 * DEĞİL. Enum kimliktir, ekran metni değil.
 */
export const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  PURCHASE: "Alış",
  SALE: "Satış",
};

/** Yönün kime uygulandığını söyleyen tek cümle — form ve panel ORTAK kullanır. */
export const PRICE_KIND_HINT: Record<PriceKind, string> = {
  PURCHASE: "Bu kalemi SATIN ALIRKEN uygulanacak fiyat (mal kabul / alış faturası).",
  SALE: "Bu kalemi SATARKEN uygulanacak fiyat (satış faturası).",
};

export interface ItemPriceRow {
  id: string;
  itemId: string;
  /** ⚠️ `null` = KART VARSAYILANI. "Müşterisi silinmiş satır" DEĞİL. */
  customerId: string | null;
  kind: PriceKind;
  currency: Currency;
  price: DecimalLike;
  createdAt: string;
  updatedAt: string;
  item?: { id: string; code: string; name: string; unit: string } | null;
  customer?: { id: string; code: string; name: string } | null;
}

/** `/resolve` yanıtı — bulunamazsa `data: null` (SIFIR DEĞİL). */
export interface ResolvedPrice {
  id: string;
  price: DecimalLike;
  source: PriceSource;
  customerId: string | null;
}

export interface ResolveResult {
  /** `null` = "fiyat girilmemiş". `0` ile KARIŞTIRMA (bkz. `PriceCell`). */
  hit: ResolvedPrice | null;
  /** Backend'in kendi cümlesi — ezme, olduğu gibi bas. */
  message: string;
}

type Paged<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
};

/** Geçersiz/boş değerde 0 — NaN basmaktansa. Karşılaştırma/oran için. */
export function toNum(value: DecimalLike | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fiyat metni.
 *
 * Ortak `money()`'yi KULLANIR (kendi biçimlendiricimizi yazmıyoruz) — ama tek
 * bir yerde ondan ayrılır ve bu ayrım ÖLÇÜLMÜŞ bir yalanı kapatır: `money()`
 * iki hane basar, birim fiyat kolonu ise `Decimal(14,4)`. `0,0005 ₺` gibi bir
 * numune fiyatı iki haneye yuvarlanınca ekranda **"0,00 ₺"** yazar ve o,
 * "bedava" diye okunur — bu ekranın kapatmakla yükümlü olduğu tam da bu
 * karışıklık. Yuvarlama değeri DEĞİŞTİRİYORSA dört hane basılır.
 *
 * ⚠️ `null`/boş → "—" DEĞİL: çağıran "fiyat girilmemiş" cümlesini kendi basar
 * (bkz. `PriceCell`). Buraya boş değer gelmesi beklenmez; gelirse `money()`
 * ile aynı nötr "—" döner.
 */
export function priceText(value: DecimalLike | null | undefined, currency: Currency): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = toNum(value);
  if (!Number.isFinite(n)) return "—";
  const twoDigits = Math.round(n * 100) / 100;
  if (twoDigits === n) return money(n, currency);
  return `${n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} ${CURRENCY_SYMBOL[currency]}`;
}

// -----------------------------------------------------------------------------
// OKUMA
// -----------------------------------------------------------------------------

/**
 * Fiyat listesi.
 *
 * ⚠️ `customerId: "null"` (metin) YALNIZ kart varsayılanlarını getirir — backend
 * bu özel değeri tanır. Gerçek bir UUID değildir ve jenerik filtre yolundan
 * geçseydi "null" METNİ uuid kolonuna gidip 400 üretirdi.
 *
 * ⚠️ Sıralamayı backend belirler (kalem → önce varsayılan, sonra istisnalar).
 * İstemci yeniden sıralamaz; "temel fiyat + sapmalar" okuması oradan gelir.
 */
export async function listItemPrices(params: {
  itemId?: string;
  /** UUID · CSV · `"null"` (yalnız varsayılanlar) */
  customerId?: string;
  kind?: PriceKind;
  currency?: Currency;
  /** Kalem kodu/adı */
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paged<ItemPriceRow>> {
  const query: Record<string, string | number> = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 200,
  };
  if (params.itemId) query["filter[itemId]"] = params.itemId;
  if (params.customerId) query["filter[customerId]"] = params.customerId;
  if (params.kind) query["filter[kind]"] = params.kind;
  if (params.currency) query["filter[currency]"] = params.currency;
  if (params.search?.trim()) query.search = params.search.trim();

  const res = await apiClient.get("/api/item-prices", { params: query });
  return res.data as Paged<ItemPriceRow>;
}

/**
 * ⭐ ÇÖZÜMLEME — "bu kaleme, bu müşteriye, şu an hangi fiyat uygulanır?"
 *
 * Sıra backend'de yaşar: müşteri istisnası > kart varsayılanı > **yok**.
 * `hit === null` "fiyat girilmemiş" demektir; çağıran alanı BOŞ bırakır,
 * sıfıra düşmez.
 */
export async function resolveItemPrice(params: {
  itemId: string;
  kind: PriceKind;
  currency: Currency;
  /** Boş/`null` → yalnız kart varsayılanı aranır. */
  customerId?: string | null;
}): Promise<ResolveResult> {
  const res = await apiClient.get("/api/item-prices/resolve", {
    params: {
      itemId: params.itemId,
      kind: params.kind,
      currency: params.currency,
      // Boş string backend'de `undefined`'a çevriliyor (Zod transform); yine de
      // parametreyi hiç göndermemek en açık niyet beyanıdır.
      ...(params.customerId ? { customerId: params.customerId } : {}),
    },
  });
  const body = res.data as { data: ResolvedPrice | null; message?: string };
  return { hit: body.data ?? null, message: body.message ?? "" };
}

// -----------------------------------------------------------------------------
// YAZMA  (`price:write`)
// -----------------------------------------------------------------------------

export interface UpsertResult {
  data: ResolvedPrice & { created: boolean };
  message?: string;
}

/**
 * Fiyat yazar (yoksa açar, varsa GÜNCELLER — tek atomik `INSERT ... ON CONFLICT`).
 *
 * ⚠️ `customerId` YOKSA/`null` ise KART VARSAYILANI yazılır. Bu alanı "boş
 * bırakılmış zorunlu alan" sanıp uydurma bir değere doldurma — boşluk burada
 * ANLAM taşır.
 *
 * ⚠️ SIFIR MEŞRU, NEGATİF DEĞİL (backend Zod + DB CHECK aynısını söyler).
 */
export async function upsertItemPrice(body: {
  itemId: string;
  customerId?: string | null;
  kind: PriceKind;
  currency: Currency;
  price: number;
}): Promise<UpsertResult> {
  const res = await apiClient.post("/api/item-prices", body);
  return res.data as UpsertResult;
}

/**
 * Fiyat satırını KALDIRIR — **fiziksel silme** (bu, kök CLAUDE.md'de yazılı
 * bilinçli bir istisnadır: `ItemPrice`'ta `isActive` yoktur, çünkü "pasif
 * fiyat" çözüm sırasına üçüncü bir durum eklerdi).
 *
 * Geçmiş belgeler etkilenmez: fatura satırı fiyatı KENDİ kolonunda dondurur.
 * Kullanıcıya bunu söyleyen cümle `describeRemoval()` içinde (bkz. `prices.ts`).
 */
export async function removeItemPrice(id: string): Promise<{ message?: string }> {
  const res = await apiClient.delete(`/api/item-prices/${id}`);
  return res.data as { message?: string };
}
