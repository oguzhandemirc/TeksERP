// Ön muhasebe API istemcisi.
// ⚠️ Yollar TAM yazılır ("/api/finance/...") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "boş liste"
// gösterir (2026-08-12'de FilterBar lookup'larında tam bu yaşandı).
import apiClient from "@/services/apiClient";

export type Currency = "TRY" | "USD" | "EUR" | "GBP" | "RUB";
export type InvoiceType = "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";
export type InvoiceStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  TRY: "₺",
  USD: "$",
  EUR: "€",
  GBP: "£",
  RUB: "₽",
};

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  SALES: "Satış Faturası",
  PURCHASE: "Alış Faturası",
  SALES_RETURN: "Satış İadesi",
  PURCHASE_RETURN: "Alış İadesi",
};

export interface CariRow {
  id: string;
  kind: "CUSTOMER" | "SUBCONTRACTOR";
  code: string;
  name: string;
  taxNumber: string | null;
  taxOffice: string | null;
  defaultCurrency: Currency;
  paymentTermDays: number | null;
  riskLimit: number | null;
  isActive: boolean;
  balances: Array<{ currency: Currency; balance: number }>;
}

export interface InvoiceRow {
  id: string;
  docNo: string;
  type: InvoiceType;
  status: InvoiceStatus;
  currency: Currency;
  exchangeRate: number;
  issueDate: string;
  dueDate: string | null;
  externalNo: string | null;
  grandTotal: number;
  grandTotalTry: number;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cari: {
    id: string;
    kind: string;
    customer: { code: string; name: string } | null;
    subcontractor: { code: string; name: string } | null;
  };
}

export interface PaymentRow {
  id: string;
  docNo: string;
  direction: "IN" | "OUT";
  method: "CASH" | "BANK_TRANSFER" | "CREDIT_CARD" | "OTHER";
  status: "ACTIVE" | "CANCELLED";
  currency: Currency;
  amount: number;
  amountTry: number;
  paymentDate: string;
  reference: string | null;
  cashBox: { id: string; name: string } | null;
  bankAccount: { id: string; name: string } | null;
  cari: {
    id: string;
    customer: { code: string; name: string } | null;
    subcontractor: { code: string; name: string } | null;
  };
}

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  bankName?: string | null;
  iban?: string | null;
  currency: Currency;
  balance: number;
  isActive: boolean;
}

export interface RateRow {
  id: string;
  rateDate: string;
  currency: Currency;
  rate: number;
  source: "MANUAL" | "TCMB";
}

export interface StatementRow {
  id: string;
  txnDate: string;
  description: string | null;
  sourceType: string;
  docNo: string | null;
  debit: number;
  credit: number;
  running: number;
}

/** Cari tarafın görünen adı — hangi tarafa bağlıysa oradan. */
export function partyName(c: { customer: { name: string } | null; subcontractor: { name: string } | null }): string {
  return c.customer?.name ?? c.subcontractor?.name ?? "—";
}

/**
 * Tutar biçimlendirici.
 *
 * ⚠️ ÖNCEKİ YORUM YANLIŞTI ve düzeltildi (2026-08-14). "Prisma `Decimal` JSON'a
 * STRING düşer, dolayısıyla MEVCUT ekranlarda tutarlar binlik ayraçsız
 * basılıyor" deniyordu. Backend bunu `app.ts`'te `installDecimalNumberSerializer()`
 * ile ZATEN çözüyor (`Decimal.prototype.toJSON` override'ı) — HTTP üzerinden
 * ÖLÇÜLDÜ: `grandTotal` yanıtta `107640` (number), string DEĞİL. İlk ölçüm
 * bağımsız bir script'te yapılmıştı ve o script `app.ts`'i import etmediği için
 * override yüklü değildi; yani ölçüm doğruydu ama YANLIŞ YOLU ölçüyordu.
 * Kayıt burada duruyor ki biri "Decimal string gelir" varsayımıyla başka bir
 * yeri "düzeltmesin".
 *
 * `number | string` kabulü yine de KORUNDU — ama gerekçesi artık farklı ve
 * mütevazı: (a) serializer TEK bir global override'dır, kaldırılırsa/atlanırsa
 * (ör. `res.json` yerine elle `JSON.stringify` kullanan bir yol) bu fonksiyon
 * sessizce bozulmak yerine doğru basmaya devam eder — derinlik savunması;
 * (b) `null`/`undefined`/NaN'da `—` basar. Bu ikincisi GERÇEK bir iyileştirme:
 * eskiden `money(undefined)` çalışma zamanında patlıyordu.
 *
 * ⚠️ Çevrilemeyen değerde `—` basılır, `NaN ₺` DEĞİL — ve `0,00 ₺` de değil:
 * sıfır bir TUTARDIR, "bilinmiyor" ile karıştırılamaz.
 */
export function money(value: number | string | null | undefined, currency: Currency): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY_SYMBOL[currency]}`;
}

type Paged<T> = { data: T[]; pagination: { total: number; totalPages: number } };

export async function listCari(params: {
  page: number;
  pageSize: number;
  search?: string;
  kind?: string;
  onlyWithBalance?: boolean;
}): Promise<Paged<CariRow>> {
  const res = await apiClient.get("/api/finance/cari", { params });
  return res.data;
}

export async function getStatement(params: {
  cariId: string;
  currency: Currency;
  from: string;
  to: string;
}): Promise<{
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  rows: StatementRow[];
}> {
  const res = await apiClient.get(`/api/finance/cari/${params.cariId}/statement`, {
    params: { currency: params.currency, from: params.from, to: params.to },
  });
  return res.data.data;
}

/**
 * DEVİR STORNOSU — aktif (terslenmemiş) ADJUSTMENT devrini tipli ters kayıtla
 * iptal eder. Uç satır KİMLİĞİ almaz: backend cari+para birimi başına en fazla
 * bir aktif devir tutar ve onu kendisi bulur.
 *
 * ⚠️ `suppressErrorToast`: 404/409 mesajları çağıranın onay diyaloğunda AYNEN
 * gösterilir (backend gerçek yolu söylüyor — "zaten iptal edilmiş", "dönem
 * kapalı"…); genel toast aynı mesajın bağlamsız ikinci bir kopyasını basardı.
 */
/**
 * DEVİR BAKİYESİ GİRİŞİ — sisteme geçişteki mevcut borç/alacağı ADJUSTMENT
 * kaynaklı bir DEFTER SATIRI olarak yazar (bakiyeye elle yazmaz: ekstrede
 * görünür, ters kayıtla düzeltilebilir). Cari + para birimi başına TEK aktif
 * devir — ikincisi backend'de 409.
 *
 * ⚠️ `balance` İMZALIDIR: POZİTİF = cari BİZE borçlu (borç satırı) · NEGATİF =
 * biz ona borçluyuz (alacak satırı). İşareti kuran tek yer çağıran formdur.
 *
 * `suppressErrorToast`: 409'un "zaten girilmiş" mesajı formun kendi hata
 * alanında AYNEN gösterilir (cancelOpeningBalance ile aynı gerekçe).
 */
export async function setOpeningBalance(params: {
  cariId: string;
  currency: Currency;
  balance: string;
  description?: string | null;
  /** "YYYY-MM-DD" ya da ISO an — verilmezse backend şimdiyi yazar. */
  txnDate?: string;
}) {
  const res = await apiClient.post(
    `/api/finance/cari/${params.cariId}/opening-balance`,
    {
      currency: params.currency,
      balance: params.balance,
      description: params.description ?? null,
      ...(params.txnDate ? { txnDate: params.txnDate } : {}),
    },
    { suppressErrorToast: true },
  );
  return res.data as { data: { id: string }; message?: string };
}

export async function cancelOpeningBalance(params: {
  cariId: string;
  currency: Currency;
  /** ZORUNLU (backend min 3 karakter) — storno gerekçesiyle kayda geçer. */
  reason: string;
}) {
  const res = await apiClient.post(
    `/api/finance/cari/${params.cariId}/opening-balance/cancel`,
    { currency: params.currency, reason: params.reason },
    { suppressErrorToast: true },
  );
  return res.data as { data: { id: string; reversesTxnId: string }; message?: string };
}

export async function listInvoices(params: {
  page: number;
  pageSize: number;
  search?: string;
  type?: string;
  status?: string;
  cariId?: string;
}): Promise<Paged<InvoiceRow>> {
  const res = await apiClient.get("/api/finance/invoices", { params });
  return res.data;
}

export interface InvoiceLineInput {
  itemId?: string | null;
  description: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  discountRate?: number;
  vatRate?: number;
  withholdingRate?: number;
}

export async function createInvoice(body: {
  type: InvoiceType;
  customerId?: string | null;
  subcontractorId?: string | null;
  currency?: Currency;
  exchangeRate?: number | null;
  issueDate?: string;
  dueDate?: string | null;
  externalNo?: string | null;
  notes?: string | null;
  /** Kaynak sevkiyat — "bir sevkiyat → tek aktif fatura" (backend partial unique). */
  shipmentId?: string | null;
  /** Kaynak mal kabul fişi — aynı kural, alış tarafı. */
  goodsReceiptId?: string | null;
  lines: InvoiceLineInput[];
  clientToken?: string;
}) {
  const res = await apiClient.post("/api/finance/invoices", body);
  return res.data as { data: { id: string; docNo: string }; message?: string };
}

export async function confirmInvoice(id: string) {
  const res = await apiClient.post(`/api/finance/invoices/${id}/confirm`);
  return res.data as { message?: string };
}

export async function cancelInvoice(id: string, reason?: string) {
  const res = await apiClient.post(`/api/finance/invoices/${id}/cancel`, { reason });
  return res.data as { message?: string };
}

export async function deleteInvoice(id: string) {
  const res = await apiClient.delete(`/api/finance/invoices/${id}`);
  return res.data as { message?: string };
}

export async function listPayments(params: {
  page: number;
  pageSize: number;
  direction?: string;
  status?: string;
  search?: string;
}): Promise<Paged<PaymentRow>> {
  const res = await apiClient.get("/api/finance/payments", { params });
  return res.data;
}

export async function createPayment(body: {
  direction: "IN" | "OUT";
  method: string;
  customerId?: string | null;
  subcontractorId?: string | null;
  currency?: Currency;
  amount: number;
  cashBoxId?: string | null;
  bankAccountId?: string | null;
  paymentDate?: string;
  reference?: string | null;
  notes?: string | null;
  clientToken?: string;
}) {
  const res = await apiClient.post("/api/finance/payments", body);
  return res.data as { data: { id: string; docNo: string }; message?: string };
}

export async function cancelPayment(id: string, reason?: string) {
  const res = await apiClient.post(`/api/finance/payments/${id}/cancel`, { reason });
  return res.data as { message?: string };
}

export async function listCashBoxes(): Promise<Paged<AccountRow>> {
  const res = await apiClient.get("/api/finance/cash-boxes", {
    params: { page: 1, pageSize: 200, sortBy: "name", sortOrder: "asc" },
  });
  return res.data;
}

export async function listBankAccounts(): Promise<Paged<AccountRow>> {
  const res = await apiClient.get("/api/finance/bank-accounts", {
    params: { page: 1, pageSize: 200, sortBy: "name", sortOrder: "asc" },
  });
  return res.data;
}

export async function createCashBox(body: { name: string; currency: Currency; notes?: string | null }) {
  const res = await apiClient.post("/api/finance/cash-boxes", body);
  return res.data;
}

export async function createBankAccount(body: {
  name: string;
  bankName?: string | null;
  iban?: string | null;
  currency: Currency;
  notes?: string | null;
}) {
  const res = await apiClient.post("/api/finance/bank-accounts", body);
  return res.data;
}

export async function listRates(): Promise<Paged<RateRow>> {
  const res = await apiClient.get("/api/finance/exchange-rates", {
    params: { page: 1, pageSize: 100, sortBy: "rateDate", sortOrder: "desc" },
  });
  return res.data;
}

export async function createRate(body: { rateDate: string; currency: Currency; rate: number }) {
  const res = await apiClient.post("/api/finance/exchange-rates", body);
  return res.data;
}

export interface TcmbFetchSummary {
  /** Bülten tarihi (YYYY-MM-DD) — fetch günü değil. */
  fetched: string;
  written: Array<{ currency: Currency; rate: string }>;
  /** Elle girilmiş (MANUAL) olduğu için dokunulmayanlar. */
  skippedManual: Array<{ currency: Currency; rate: string }>;
  unchanged: Array<{ currency: Currency; rate: string }>;
  missing: Currency[];
}

export async function fetchTcmbRates(): Promise<TcmbFetchSummary> {
  const res = await apiClient.post("/api/finance/exchange-rates/fetch-tcmb");
  return (res.data as { data: TcmbFetchSummary }).data;
}
