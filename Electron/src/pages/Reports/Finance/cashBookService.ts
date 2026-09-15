// =============================================================================
// KASA / BANKA DEFTERİ — tipler + API çağrısı (backend `cash-book.report.ts` aynası)
// =============================================================================
// ⚠️ Yol TAM yazılır ("/api/reports/finance/cash-book") — `apiClient.baseURL`
// `/api` İÇERMEZ; öneksiz yol 404 alır ve ekran "hesap yok" gösterir.
//
// ⚠️ TUTARLAR STRING gelir (backend Decimal → 2 hane string). Bu dosya onları
// `string` olarak tipler; gösterim `moneyStr`, Excel hücresi `toNum` ile
// yapılır. `number`'a çevirip toplamak kuruş kaydırır (`service.ts` başlığı).
//
// ⚠️ Ayrı dosya olmasının sebebi yalnız BOY DEĞİL: yaşlandırma ile defter iki
// farklı sorudur (kim bize borçlu ↔ kasada ne oldu) ve tek dosyada birleşince
// birinin tipini düzeltirken diğerini okumadan geçmek kolaylaşıyordu.
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ReportResponse } from "../_services/types";
import type { Currency } from "./service";

export type CashAccountKind = "CASH" | "BANK";

export const ACCOUNT_KIND_LABEL: Record<CashAccountKind, string> = {
  CASH: "Kasa",
  BANK: "Banka",
};

export type CashBookSource = "PAYMENT" | "PAYMENT_CANCEL" | "CASH_TXN" | "CASH_TXN_CANCEL" | "CHEQUE";

export const CASH_SOURCE_LABEL: Record<CashBookSource, string> = {
  PAYMENT: "Tahsilat / Ödeme",
  PAYMENT_CANCEL: "Tahsilat iptali",
  CASH_TXN: "Kasa hareketi",
  CASH_TXN_CANCEL: "Kasa hareketi iptali",
  CHEQUE: "Çek",
};

/**
 * `kind` kolonu KAYNAĞA göre farklı bir enum taşır (ödeme yöntemi · kasa hareket
 * türü · çek olayı). Üçü tek sözlükte toplanır: anahtarlar çakışmıyor ve üç ayrı
 * sözlük, satırın kaynağına bakıp doğru sözlüğü seçen bir dallanma demekti.
 * Tanınmayan değer HAM basılır — sessizce boş bırakmak "türü yok" yalanıdır.
 */
export const CASH_KIND_LABEL: Record<string, string> = {
  CASH: "Nakit",
  BANK_TRANSFER: "Havale / EFT",
  CREDIT_CARD: "Kredi kartı",
  OTHER: "Diğer",
  EXPENSE: "Gider",
  INCOME: "Gelir",
  TRANSFER_OUT: "Virman (çıkış)",
  TRANSFER_IN: "Virman (giriş)",
  OPENING: "Açılış / devir",
  COLLECT: "Çek tahsili",
  PAY: "Çek ödemesi",
  // K-2 tahsil stornosu — backend defteri 2026-08-14'ten beri bu olayı da
  // basıyor (measureTx/§23-§24 evren eşitliği); etiketsiz kalsa HAM enum çıkardı.
  COLLECT_CANCEL: "Çek tahsil stornosu",
  PAY_CANCEL: "Çek ödeme stornosu",
};

/**
 * KATEGORİ KIRILIMI (H7) — kovanın TİPİ. Etiketi değil, hangi kuraldan
 * doğduğunu söyler; ekran bunu "Tür" sütununda basar ki serbest metinle
 * yazılmış bir "Çek tahsilatı" kategorisi ile GERÇEK çek kovası karışmasın.
 */
export type CashCategoryGroup = "CASH_TXN" | "TRANSFER" | "PAYMENT" | "CHEQUE";

export const CASH_CATEGORY_GROUP_LABEL: Record<CashCategoryGroup, string> = {
  CASH_TXN: "Kasa hareketi",
  TRANSFER: "Virman",
  PAYMENT: "Tahsilat / Ödeme",
  CHEQUE: "Çek",
};

export interface CashBookCategoryRow {
  /** Gruplama anahtarı — kasa hareketinde `CAT:<metin>`, diğerlerinde kova tipi. */
  key: string;
  label: string;
  group: CashCategoryGroup;
  currency: Currency;
  totalIn: string;
  totalOut: string;
  /** totalIn − totalOut. İptal çifti aynı kovaya ters yönde düştüğü için 0'lar. */
  net: string;
  movementCount: number;
}

export interface CashBookRow {
  id: string;
  source: CashBookSource;
  docNo: string;
  date: string;
  direction: "IN" | "OUT";
  /** Her zaman POZİTİF — yön `direction` kolonundadır. */
  amount: string;
  signed: string;
  /** O satırdan SONRAKİ bakiye. */
  running: string;
  kind: string | null;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  cancelled: boolean;
}

export interface CashBookAccountSummary {
  accountId: string;
  accountKind: CashAccountKind;
  code: string;
  name: string;
  currency: Currency;
  isActive: boolean;
  /** Dönem başı devir — dönemden ÖNCEKİ hareketlerin toplamı. */
  opening: string;
  totalIn: string;
  totalOut: string;
  closing: string;
  /** `cash_boxes.balance` / `bank_accounts.balance` denormalize kolonu. */
  storedBalance: string;
  /** closing − storedBalance; YALNIZ dönem sonu bugünü kapsıyorsa dolu. */
  storedDiff: string | null;
  movementCount: number;
  /**
   * Devrin dayandığı aktif dönem kapanışının son günü (ISO gün anahtarı) —
   * hesap o güne kadar MÜHÜRLÜ, devir o kapanışın rakamından (K5, 2026-08-14).
   * OPSİYONEL: mühürsüz hesapta `null`, eski backend alanı hiç göndermez —
   * iki durumda da kaynak notu basılmaz, bugünkü görünüm birebir.
   */
  sealedThrough?: string | null;
}

export interface CashBookReport {
  accounts: CashBookAccountSummary[];
  /**
   * Dönem hareketlerinin KAYNAK kırılımı — para birimi bazında olduğu için
   * hesap seçilmeden de anlamlıdır (`rows`'un aksine).
   *
   * OPSİYONEL, `sealedThrough` ile aynı gerekçe: 2026-08-14 öncesi backend bu
   * alanı hiç göndermez → blok ÇİZİLMEZ (boş tablo değil), ekran çökmez ve
   * bugünkü görünüm birebir kalır.
   */
  categories?: CashBookCategoryRow[];
  /** Yalnız TEK hesap seçiliyse dolu — çok hesapta yürüyen bakiye anlamsızdır. */
  rows: CashBookRow[] | null;
  rowsTruncated: boolean;
  /** Dönem sonu "şu an"ı kapsıyor mu — `storedDiff`in ölçülebilirlik koşulu. */
  storedComparable: boolean;
  /** Yalnız TEK para birimi varsa dolu — farklı birimli kasalar toplanmaz. */
  totals: { opening: string; totalIn: string; totalOut: string; closing: string } | null;
  notes: string[];
}

export interface CashBookApiParams {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  accountKind?: CashAccountKind;
  includeInactive?: boolean;
  /**
   * ⚠️ Üçü de YALNIZ HAREKET DÖKÜMÜNÜ daraltır (R5b-d): özet, devir ve kapanış
   * dönem gerçeğidir ve bu süzgeçlerden ETKİLENMEZ — backend sözleşmesi böyle.
   */
  cariId?: string[];
  kategori?: CashBookCategory;
  yon?: "IN" | "OUT";
}

/** Hareket dökümü kategorisi — backend enum'unun aynası. */
export type CashBookCategory = "CASH_TXN" | "TRANSFER" | "PAYMENT" | "CHEQUE";

export async function getCashBookReport(p: CashBookApiParams): Promise<ReportResponse<CashBookReport>> {
  // Boş değer GÖNDERİLMEZ: backend şeması `.strict()` ve boş string tarih
  // "Geçersiz tarih formatı" 400'ü üretir.
  const params: Record<string, string> = {};
  if (p.dateFrom) params.dateFrom = p.dateFrom;
  if (p.dateTo) params.dateTo = p.dateTo;
  if (p.accountId) params.accountId = p.accountId;
  if (p.accountKind) params.accountKind = p.accountKind;
  if (p.includeInactive) params.includeInactive = "true";
  if (p.cariId?.length) params.cariId = p.cariId.join(",");
  if (p.kategori) params.kategori = p.kategori;
  if (p.yon) params.yon = p.yon;
  const res = await apiClient.get<ReportResponse<CashBookReport>>(
    "/api/reports/finance/cash-book",
    { params },
  );
  return res.data;
}

/** Defter yüklenirken tabloyu iskeletiyle çizebilmek için boş kabuk. */
export function emptyCashBookReport(): CashBookReport {
  return { accounts: [], categories: [], rows: [], rowsTruncated: false, storedComparable: false, totals: null, notes: [] };
}
