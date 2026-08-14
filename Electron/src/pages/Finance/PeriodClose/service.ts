// =============================================================================
// DÖNEM KAPANIŞI API İSTEMCİSİ (C3)
// =============================================================================
// ⚠️ Yollar TAM yazılır ("/api/finance/period-closes/...") — `apiClient.baseURL`
// `/api` İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran sessizce
// "kayıt yok" gösterir; kapanış ekranında bu, "dönem açık" yalanı demektir.
//
// ⚠️ İKİ FARKLI UNWRAP — karıştırma:
//   • liste ucu   → `res.data`      ({ success, data[], pagination })
//   • tekil uçlar → `res.data.data` ({ success, data })
// Yanlış seçilirse alanlar `undefined` basar ve HİÇBİR HATA ÇIKMAZ.
//
// ⚠️ DECIMAL ALANLAR STRING GELİR. Prisma `Decimal.toJSON()` string döndürür
// ("15000.00"). `number` olarak tiplemek derlemede sessiz geçer, sonra
// `toLocaleString(...)` string üzerinde çalışıp biçimlendirmeyi ham basar. Bu
// yüzden tipler `string | number` ve para daima `moneyOf()` ile basılır.
// Aritmetik İSTEMCİDE YAPILMAZ — bakiye/fark backend'de Decimal ile hesaplanır.
// =============================================================================

import apiClient from "@/services/apiClient";
import { money, type Currency } from "../service";

/** Backend Decimal alanı — JSON'da string gelir, sayı gibi davranmaz. */
export type Decimalish = string | number;

export interface PeriodCloseRow {
  id: string;
  cariId: string;
  cariCode: string;
  cariName: string;
  currency: Currency;
  /** `@db.Date` gün anahtarı — UTC gece yarısı. `formatDayKey` ile bas. */
  periodEnd: string;
  closingBalance: Decimalish;
  txnCount: number;
  notes: string | null;
  closedById: string | null;
  createdAt: string;
  /** Dolu ise mühür KIRILMIŞ — satır silinmez, işaretlenir (denetim izi). */
  reopenedAt: string | null;
  reopenedById: string | null;
  reopenReason: string | null;
}

/** Kapanışa engel olan / kapanıştan önce gelen komşu kapanış. */
export interface NeighbourClose {
  id: string;
  periodEnd: string;
  closingBalance: Decimalish;
}

export interface PeriodPreview {
  periodEnd: string;
  /** Kapsamın DIŞ sınırı (`txnDate < cut`) — gerçek bir an, gün anahtarı değil. */
  cut: string;
  closingBalance: Decimalish;
  txnCount: number;
  totalDebit: Decimalish;
  totalCredit: Decimalish;
  /** Tam olarak bu dönem zaten kapalı mı. */
  alreadyClosed: boolean;
  /** Bu dönemi zaten kapsayan (aynı ya da daha ileri) aktif kapanış. */
  blockingClose: NeighbourClose | null;
  /** Bu dönemden ÖNCE biten en yeni aktif kapanış — devrin dayanağı. */
  previousClose: NeighbourClose | null;
}

export interface PeriodStatus {
  /** Nereye kadar kapalı. `null` HATA DEĞİL: kapanış opsiyoneldir. */
  closedThrough: string | null;
  closingBalance: Decimalish | null;
  closeId: string | null;
}

export interface PeriodVerify {
  id: string;
  periodEnd: string;
  stored: { closingBalance: Decimalish; txnCount: number };
  derived: { closingBalance: Decimalish; txnCount: number };
  /** true = saklanan fotoğraf ile bugünkü defter AYRIŞMIŞ. */
  drift: boolean;
  balanceDelta: Decimalish;
  countDelta: number;
}

type Paged<T> = { data: T[]; pagination: { total: number; totalPages: number } };

export const PERIOD_CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

/**
 * Para basımı — Decimal string'i sayıya çevirip ortak `money()`'ye verir.
 *
 * ⚠️ Bu bir GÖSTERİM dönüşümüdür, hesap değil. `Number()` sonucu hiçbir yerde
 * toplanmaz/çıkarılmaz: iki para birimini toplamak da, kuruş yuvarlamasını
 * istemcide yapmak da bu modülün reddettiği şeylerdir.
 */
export function moneyOf(value: Decimalish | null | undefined, currency: Currency): string {
  if (value === null || value === undefined) return "—";
  return money(Number(value), currency);
}

/**
 * `@db.Date` gün anahtarını gg.aa.yyyy basar — UTC parçalarından.
 *
 * ⚠️ `toLocaleDateString()` KULLANMA: `periodEnd` bir AN değil bir TAKVİM
 * GÜNÜdür ve UTC gece yarısı olarak gelir. Yerel saate çevirmek negatif ofsetli
 * bir makinede günü bir GERİ kaydırır — kapanış ekranında bu, kullanıcının
 * yanlış dönemi mühürlemesi demektir. Backend `formatDayKeyTr`'nin aynası.
 */
export function formatDayKey(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** Gerçek bir AN (createdAt/reopenedAt/cut) — yerel saatle basılır. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * `<input type="date">` değeri — YEREL parçalardan.
 *
 * ⚠️ `toISOString().slice(0,10)` KULLANMA: UTC'ye çevirir ve TR'de gece
 * yarısından önceki saatlerde günü bir geri kaydırır.
 */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Geçen ayın son günü — kapanışın açık ara en sık kullanılan tarihi. */
export function lastDayOfPreviousMonth(today = new Date()): Date {
  return new Date(today.getFullYear(), today.getMonth(), 0);
}

/** Geçen yılın son günü. */
export function lastDayOfPreviousYear(today = new Date()): Date {
  return new Date(today.getFullYear() - 1, 11, 31);
}

/**
 * Kapanış listesi.
 *
 * ⚠️ `includeReopened` yalnız `"true"` string'i olarak anlamlıdır (backend
 * `z.enum(["true","false"])`); boolean gönderilirse axios `?includeReopened=true`
 * yazar — aynı sonuç, ama sözleşmeyi açıkça yazmak ileride birinin `1`
 * göndermesini engeller.
 */
export async function listPeriodCloses(params: {
  page: number;
  pageSize: number;
  cariId?: string;
  currency?: Currency;
  includeReopened?: boolean;
}): Promise<Paged<PeriodCloseRow>> {
  const res = await apiClient.get("/api/finance/period-closes", {
    params: {
      page: params.page,
      pageSize: params.pageSize,
      cariId: params.cariId || undefined,
      currency: params.currency || undefined,
      includeReopened: params.includeReopened ? "true" : undefined,
    },
  });
  return res.data;
}

/** "Bu cari bu para biriminde nereye kadar kapalı" — ekranın kilit rozeti. */
export async function getPeriodStatus(params: {
  cariId: string;
  currency: Currency;
}): Promise<PeriodStatus> {
  const res = await apiClient.get("/api/finance/period-closes/status", { params });
  return res.data.data as PeriodStatus;
}

/**
 * ÖNİZLEME — hiçbir şey yazmaz.
 *
 * `periodEnd` düz takvim günü olarak ("2025-12-31") gönderilir; backend
 * `z.string().date()` ile kabul edip fabrika takvim gününe çevirir. Yerel bir
 * ISO an göndermek de çalışır ama gereksizdir ve saat dilimi tartışması açar.
 */
export async function getPeriodPreview(params: {
  cariId: string;
  currency: Currency;
  periodEnd: string;
}): Promise<PeriodPreview> {
  const res = await apiClient.get("/api/finance/period-closes/preview", { params });
  return res.data.data as PeriodPreview;
}

/** DOĞRULAMA — salt okuma; hiçbir şeyi DÜZELTMEZ. */
export async function verifyPeriodClose(id: string): Promise<PeriodVerify> {
  const res = await apiClient.get(`/api/finance/period-closes/${id}/verify`);
  return res.data.data as PeriodVerify;
}

/** DÖNEMİ KAPAT (mühürler). Gövde backend'de `.strict()` — fazla alan 400 verir. */
export async function closePeriod(body: {
  cariId: string;
  currency: Currency;
  periodEnd: string;
  notes?: string | null;
}) {
  const res = await apiClient.post("/api/finance/period-closes", body);
  return res.data as { data: { id: string; periodEnd: string }; message?: string };
}

/** YENİDEN AÇ — gerekçe ZORUNLU (backend min 3 karakter), satır silinmez. */
export async function reopenPeriod(id: string, reason: string) {
  const res = await apiClient.post(`/api/finance/period-closes/${id}/reopen`, { reason });
  return res.data as { data: { id: string; periodEnd: string }; message?: string };
}
