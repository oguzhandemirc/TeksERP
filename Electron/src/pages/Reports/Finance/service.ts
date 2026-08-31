// =============================================================================
// ÖN MUHASEBE RAPORLARI — ortak yardımcılar + YAŞLANDIRMA + CARİ EKSTRE
// =============================================================================
// (Kasa/banka defteri ayrı dosyada: `cashBookService.ts` — iki farklı soru,
//  tek dosyada birleşince birinin tipini düzeltirken diğerini okumadan geçmek
//  kolaylaşıyordu.)
//
// ⚠️ Yollar TAM yazılır ("/api/reports/finance/...") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "veri yok"
// gösterir; yani rapor BOZUK değil BOŞ görünür ve kimse fark etmez.
//
// ⚠️ NEDEN ORTAK `reportsClient` KULLANILMIYOR: o istemci bilinçli olarak yalnız
// BEŞ anahtarı querystring'e yazar (dateFrom/dateTo/compare*). Bu üç ucun kendi
// parametreleri var (`asOf`, `cariId`, `accountId`, `currency`…) ve backend
// şemaları `.strict()` — tanımadığı anahtarı 400'ler, tanıdığını da yazmayan bir
// istemciden filtre HİÇ gitmez. `reportsClient`'ı genişletmek ise onu paylaşan
// sekiz raporu etkilerdi (paylaşılan dosya). Bu yüzden burada doğrudan
// `apiClient` çağrılır.
//
// ⚠️ TUTARLAR BACKEND'DEN **STRING** GELİR (bkz. `finance-aging.report.ts` /
// `cash-book.report.ts` başlıkları): 1234.56 + 0.1 gibi float toplamları kuruş
// kaydırıyor ve muhasebe ekranında "1 kuruş tutmuyor" olarak görünüyordu.
// Tipler bunu SAKLAMAZ — `string` yazılıdır. İstemci bu değerlerle ARİTMETİK
// YAPMAZ; yalnız gösterir (`moneyStr`) ya da Excel hücresine sayı olarak
// döker (`toNum`, bkz. aşağıdaki gerekçe).
// =============================================================================

import axios from "axios";
import apiClient from "@/services/apiClient";
import { money, type Currency } from "@/pages/Finance/service";
import type { ReportResponse } from "../_services/types";

export type { Currency };

export type CariKind = "CUSTOMER" | "SUBCONTRACTOR";

export const CARI_KIND_LABEL: Record<CariKind, string> = {
  CUSTOMER: "Müşteri",
  SUBCONTRACTOR: "Fason",
};

/** Yaşlandırma kova anahtarları — SIRA ve ETİKET backend'den gelir (bkz. aşağı). */
export type AgingBucketKey = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90plus" | "noDueDate";

// -----------------------------------------------------------------------------
// GÖSTERİM YARDIMCILARI
// -----------------------------------------------------------------------------

/**
 * String tutarı ekrana basar. Tek biçimlendirici `Finance/service.money`'dir —
 * ikinci bir para biçimlendiricisi yazmak, iki ekranın aynı sayıyı farklı
 * gösterdiği gün fark edilirdi.
 *
 * ⚠️ `money` `number` bekler; buradaki `Number()` bir HESAP değil, gösterim
 * dönüşümüdür (tek değer, toplama yok). `money`'ye ham string vermek sessizce
 * yanlıştır: `String.prototype.toLocaleString` argümanları yok sayar ve
 * "1234.5 ₺" basar (binlik ayraç ve kuruş olmadan).
 */
export function moneyStr(value: string | number | null | undefined, currency: Currency): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return money(n, currency);
}

/**
 * Excel hücresi için sayıya çevirir. Excel'e string verilirse `numFmt` UYGULANMAZ
 * ve hücre metin olur — muhasebeci onun üzerinde toplama yapamaz, ki dosyayı
 * indirmesinin tek sebebi odur.
 */
export function toNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// -----------------------------------------------------------------------------
// HATA METNİ — sebebi EKRANDA yazan tek yol
// -----------------------------------------------------------------------------
/**
 * İstek düştüğünde kullanıcıya gösterilecek SOMUT sebep.
 *
 * ⚠️ BU FONKSİYON OLMADAN SEBEP KAYBOLUR ve rapor "boş" görünür. Üç kural
 * birleşince tam olarak bu oluyordu:
 *  ① `requireFinanceEnabled` modül kapalıyken **403** döner ve gövdesinde net
 *     bir cümle taşır ("Ön muhasebe modülü bu kurulumda kapalı…").
 *  ② `apiClient` interceptor'ı 403'te gövdeyi ATAR ve sabit "Bu işlem için
 *     yetkiniz bulunmuyor." toast'ı basar — yani YANLIŞ sebebi söyler.
 *  ③ Sayfa `data === undefined` görünce boş-durum metnini çizer.
 * Sonuç: fabrika kurulumunda (bayrak varsayılan KAPALI) ekran
 * "açık bakiyeli cari yok" diyordu. Para konusunda bu, hata mesajından çok daha
 * tehlikelidir: kullanıcı "kimse bize borçlu değil" diye okur ve sebebi hiçbir
 * yerde yazmaz. Gövdedeki mesaj bu yüzden `error`'dan DOĞRUDAN okunur — toast
 * onu çoktan yutmuştur.
 *
 * ⚠️ Sıra load-bearing: alan hataları → gövde mesajı → statü bazlı yedek. Sabit
 * bir metinle başlamak, backend'in söylediği tek somut cümleyi ezerdi.
 */
export function reportErrorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      | { message?: string; errors?: Array<{ message?: string }> }
      | undefined;
    const fieldMessages = (body?.errors ?? [])
      .map((e) => e?.message)
      .filter((m): m is string => Boolean(m));
    if (fieldMessages.length > 0) return fieldMessages.join(" • ");
    if (body?.message) return body.message;
    if (!error.response) return "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.";
    if (error.response.status >= 500) return "Sunucu hatası — rapor üretilemedi.";
    if (error.response.status === 403) {
      return "Bu raporu görme yetkiniz yok ya da ön muhasebe modülü bu kurulumda kapalı.";
    }
  }
  return "Rapor yüklenemedi. Filtreleri değiştirip tekrar deneyin.";
}

/** "0.00" / "-0.00" da sıfırdır — mutabakat kolonlarında yalnız SIFIR sessiz kalır. */
export function isZeroAmount(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n === 0;
}

/** Yerel gün sınırı — backend bunu MUTLAK AN olarak alır (rapor sözleşmesi). */
export function dayStartIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
export function dayEndIso(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}
export function toYmd(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  // ⚠️ `toISOString().slice(0,10)` KULLANILMAZ: UTC'ye çevirir ve TR'de gece
  // yarısından önceki saatlerde günü BİR GERİ kaydırır.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// -----------------------------------------------------------------------------
// YAŞLANDIRMA — backend `finance-aging.report.ts` ile birebir
// -----------------------------------------------------------------------------

export interface AgingOpenItem {
  /** DEVİR/düzeltme satırında `null` — o satırın faturası yoktur. */
  invoiceId: string | null;
  docNo: string;
  type: string;
  issueDate: string;
  effectiveDueDate: string | null;
  dueSource: "DOCUMENT" | "PAYMENT_TERM" | "NONE";
  grandTotal: string;
  paid: string;
  open: string;
  virtualOffset: string;
  netOpen: string;
  daysOverdue: number | null;
  bucket: AgingBucketKey;
}

export interface AgingCariRow {
  cariId: string;
  code: string;
  name: string;
  kind: CariKind;
  currency: Currency;
  gross: Record<AgingBucketKey, string>;
  net: Record<AgingBucketKey, string>;
  virtualOffset: string;
  openTotal: string;
  unappliedCredit: string;
  overdueTotal: string;
  ledgerBalance: string;
  storedBalance: string | null;
  /** SIFIR OLMAK ZORUNDA — sıfır değilse ekran bunu görünür kılar. */
  reconDiff: string;
  storedDiff: string | null;
  oldestDueDate: string | null;
  oldestDaysOverdue: number | null;
  items?: AgingOpenItem[];
}

export interface AgingCurrencyBlock {
  currency: Currency;
  /** Rapor günü kuru — yoksa `null` ve TL kolonları da `null` (uydurma kur BASILMAZ). */
  tryRate: string | null;
  rateDate: string | null;
  rows: AgingCariRow[];
  totals: {
    gross: Record<AgingBucketKey, string>;
    net: Record<AgingBucketKey, string>;
    virtualOffset: string;
    openTotal: string;
    unappliedCredit: string;
    overdueTotal: string;
    ledgerBalance: string;
  };
  totalsTry: { openTotal: string; unappliedCredit: string; overdueTotal: string } | null;
}

export interface AgingReport {
  asOf: string;
  /** ⚠️ Kova SIRASI ve ETİKETİ buradan okunur — istemci kendi listesini KURMAZ. */
  buckets: Array<{ key: AgingBucketKey; label: string }>;
  blocks: AgingCurrencyBlock[];
  notes: string[];
  reconciliation: {
    rowsChecked: number;
    mismatchedRows: number;
    samples: Array<{ cariId: string; name: string; currency: Currency; diff: string }>;
    allocationDriftInvoices: number;
    allocationDriftPayments: number;
  };
}

export interface AgingApiParams {
  /** KESİT anı (ISO). Tarih ARALIĞI değil — backend `dateFrom/dateTo`'yu 400'ler. */
  asOf?: string;
  cariId?: string;
  kind?: CariKind;
  currency?: Currency;
  onlyOverdue?: boolean;
  /** Fatura dökümü — backend yalnız `cariId` ile birlikte üretir. */
  detail?: boolean;
}

export async function getAgingReport(p: AgingApiParams): Promise<AgingReport> {
  // ⚠️ Boş değer GÖNDERİLMEZ: şema `.strict()` ve `asOf: ""` "Geçersiz tarih"
  // 400'ü üretir — kullanıcı hiçbir filtre seçmemişken rapor patlardı.
  const params: Record<string, string> = {};
  if (p.asOf) params.asOf = p.asOf;
  if (p.cariId) params.cariId = p.cariId;
  if (p.kind) params.kind = p.kind;
  if (p.currency) params.currency = p.currency;
  if (p.onlyOverdue) params.onlyOverdue = "true";
  if (p.detail) params.detail = "true";
  const res = await apiClient.get<{ success: true; data: AgingReport }>(
    "/api/reports/finance/aging",
    { params },
  );
  // ⚠️ Bu uç `reportEnvelope` KULLANMAZ (kesit raporunun `range`'i yoktur) —
  // yanıtta `range` aramak `undefined` okumak olurdu.
  return res.data.data;
}

// -----------------------------------------------------------------------------
// CARİ EKSTRE (rapor yüzeyi)
// -----------------------------------------------------------------------------
// ⚠️ Bu uç `report:finance` iznindedir; `Finance/StatementDialog` ise
// `/api/finance/cari/:id/statement`'i (izin `finance:read`) çağırır. İkisi AYNI
// servis gövdesinden beslenir ama farklı kapılardan geçer: yalnız `report:finance`
// taşıyan yönetim kullanıcısı ikinciyi 403 alır. Bu yüzden rapor tarafı KENDİ
// çağrısını yapar — mevcut diyaloğu buradan çağırmak, ekranı yetkisi olan
// kullanıcıya kapatırdı.

export interface StatementRow {
  id: string;
  txnDate: string;
  description: string | null;
  sourceType: string;
  docNo: string | null;
  debit: string;
  credit: string;
  running: string;
}

export interface StatementReport {
  /** Dönem BAŞINDAN ÖNCEKİ tüm hareketlerin toplamı. */
  opening: string;
  closing: string;
  totalDebit: string;
  totalCredit: string;
  /**
   * Devrin dayandığı dönem kapanışı (K5, 2026-08-14): devir artık düz yeniden
   * hesap değil, aktif kapanışın MÜHÜRLÜ rakamı + kapanıştan dönem başına
   * kadarki hareketlerdir. OPSİYONEL: mühürsüz cari/kurulumda `null`, eski
   * backend alanı hiç göndermez — iki durumda da devir satırı bugünkü metinle
   * birebir basılır (kaynak notu yalnız alan doluyken çıkar).
   */
  carriedFrom?: { periodEnd: string; closingBalance: string } | null;
  rows: StatementRow[];
}

/** Defter satırının kaynağı — `CariTxnSource` aynası. */
export const CARI_TXN_SOURCE_LABEL: Record<string, string> = {
  INVOICE: "Fatura",
  INVOICE_CANCEL: "Fatura iptali",
  PAYMENT: "Tahsilat / Ödeme",
  PAYMENT_CANCEL: "Tahsilat iptali",
  ADJUSTMENT: "Devir / düzeltme",
  // ⚠️ Etiket girilmezse ekstre HAM ENUM basar ("ADJUSTMENT_CANCEL") — yeni
  // `CariTxnSource` değeri eklenirken bu harita da güncellenir.
  ADJUSTMENT_CANCEL: "Devir iptali",
  CHEQUE_RECEIVE: "Çek girişi",
  CHEQUE_ISSUE: "Çek çıkışı",
  CHEQUE_ENDORSE: "Çek cirosu",
  CHEQUE_BOUNCE: "Karşılıksız çek",
  CHEQUE_CANCEL: "Çek iptali",
};

export async function getStatementReport(p: {
  cariId: string;
  currency: Currency;
  dateFrom: string;
  dateTo: string;
}): Promise<ReportResponse<StatementReport>> {
  const res = await apiClient.get<ReportResponse<StatementReport>>(
    "/api/reports/finance/statement",
    { params: { cariId: p.cariId, currency: p.currency, dateFrom: p.dateFrom, dateTo: p.dateTo } },
  );
  return res.data;
}
