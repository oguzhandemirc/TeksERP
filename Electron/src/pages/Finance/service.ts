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

export function money(value: number, currency: Currency): string {
  return `${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY_SYMBOL[currency]}`;
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
