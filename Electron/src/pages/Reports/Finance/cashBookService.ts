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
};

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
}

export interface CashBookReport {
  accounts: CashBookAccountSummary[];
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
}

export async function getCashBookReport(p: CashBookApiParams): Promise<ReportResponse<CashBookReport>> {
  // Boş değer GÖNDERİLMEZ: backend şeması `.strict()` ve boş string tarih
  // "Geçersiz tarih formatı" 400'ü üretir.
  const params: Record<string, string> = {};
  if (p.dateFrom) params.dateFrom = p.dateFrom;
  if (p.dateTo) params.dateTo = p.dateTo;
  if (p.accountId) params.accountId = p.accountId;
  if (p.accountKind) params.accountKind = p.accountKind;
  if (p.includeInactive) params.includeInactive = "true";
  const res = await apiClient.get<ReportResponse<CashBookReport>>(
    "/api/reports/finance/cash-book",
    { params },
  );
  return res.data;
}

/** Defter yüklenirken tabloyu iskeletiyle çizebilmek için boş kabuk. */
export function emptyCashBookReport(): CashBookReport {
  return { accounts: [], rows: [], rowsTruncated: false, storedComparable: false, totals: null, notes: [] };
}
