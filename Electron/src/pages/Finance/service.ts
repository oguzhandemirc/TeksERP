// Ön muhasebe API istemcisi.
// ⚠️ Yollar TAM yazılır ("/api/finance/...") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "boş liste"
// gösterir (2026-08-12'de FilterBar lookup'larında tam bu yaşandı).
import apiClient from "@/services/apiClient";
// H1 (2026-08-14): gecikme yüklemi + kuruş aritmetiği TEK kaynaktan — kapama
// ekranının saf katmanı. Buraya kopyalamak, "aynı fatura kapama ekranında
// gecikmiş, listede değil" tutarsızlığının kapısını açardı.
import { isOverdue, toKurus } from "./Allocations/allocationMath";

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
  /** Serbest not — backend 2026-08-14'ten beri list/findById yanıtında taşır. */
  notes: string | null;
  isActive: boolean;
  balances: Array<{ currency: Currency; balance: number }>;
  /** Vadesi geçmiş AÇIK tutar, para birimi bazında (H2). YALNIZ `withOverdue`
   *  ile istenince gelir; eski backend'de hiç gelmez → alan OPSİYONEL okunur.
   *  ⚠️ Tutar STRING'tir ("3400.00") — yaşlandırma raporu para hassasiyeti için
   *  string basar ve `money()` string kabul eder; `Number()`a çevirip toplama. */
  overdue?: Array<{ currency: Currency; amount: string }>;
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
  /** Kapamalarla kapanan tutar (denormalize sayaç). AÇIK/KISMİ/KAPALI bir kolon
   *  DEĞİLDİR — `settlementOf` ile `grandTotal`'dan TÜRETİLİR (backend
   *  payment-allocation.service başlığındaki kural). */
  paidTotal: number;
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
  /** Ters kayıt bağı (I3, 2026-08-14) — eski backend'de gelmez, OPSİYONEL okunur. */
  reversesTxnId?: string | null;
  /** Bu satırı tersleyen satırın id'si — doluysa satır TERSLENMİŞTİR. */
  reversedByTxnId?: string | null;
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

// -----------------------------------------------------------------------------
// KAPAMA TÜRETİMİ (H1) — saf fonksiyon, tek kaynak
// -----------------------------------------------------------------------------

export type SettlementState = "ACIK" | "KISMI" | "KAPALI";

export interface Settlement {
  state: SettlementState;
  /** Kuruş (tam sayı) — gösterime `fromKurus` ile çevrilir. */
  paidK: number;
  openK: number;
  /** Vadesi geçti VE hâlâ açık tutar var. Tam kapanmış faturada DAİMA false. */
  overdue: boolean;
}

/**
 * AÇIK/KISMİ/KAPALI + gecikme — fatura LİSTESİ rozetlerinin tek kaynağı.
 *
 * ⚠️ Durum bir KOLON değildir: backend `payment-allocation.service` başlığı
 * gereği `paidTotal` ↔ `grandTotal` karşılaştırmasıyla TÜRETİLİR (ikinci bir
 * denormalize alan bir gün ayrışırdı). Karşılaştırma KURUŞTA yapılır — float
 * toplamı "1 kuruş açık kaldı" diye KISMİ basardı (`allocationMath` gerekçesi).
 *
 * ⚠️ YALNIZ CONFIRMED faturada anlamlı → diğer statülerde `null`:
 *   • DRAFT deftere hiç işlemedi — "AÇIK" rozeti var olmayan bir alacağı ima eder.
 *   • CANCELLED'da kapamalar iptalde çözülür (`releaseAllocationsForInvoiceTx`)
 *     — rozet basmak "iptal ama tahsil edilmemiş" gibi okunurdu.
 * Gecikme rozeti de aynı kapıdan geçer: `overdue` yalnız açık tutar varken true
 * (tam kapalı faturaya "vadesi geçti" basmak çözülmüş bir sorunu ihbar eder);
 * vadesiz faturada `isOverdue(null)` zaten false döner.
 */
export function settlementOf(
  inv: Pick<InvoiceRow, "status" | "grandTotal" | "paidTotal" | "dueDate">,
): Settlement | null {
  if (inv.status !== "CONFIRMED") return null;
  const grandK = toKurus(inv.grandTotal);
  const paidK = toKurus(inv.paidTotal);
  const openK = Math.max(0, grandK - paidK);
  const state: SettlementState = openK <= 0 ? "KAPALI" : paidK <= 0 ? "ACIK" : "KISMI";
  return { state, paidK, openK, overdue: openK > 0 && isOverdue(inv.dueDate) };
}

export const SETTLEMENT_LABEL: Record<SettlementState, string> = {
  ACIK: "Açık",
  KISMI: "Kısmi",
  KAPALI: "Kapalı",
};

/**
 * FATURA ROZETLERİ — liste satırı ve DETAY yüzeyi AYNI sözlükten okur.
 *
 * ⚠️ Kopyalamak yasak (Cheques `labels.ts` başlığındaki gerekçe): ayrışırlarsa
 * aynı fatura listede "Onaylı", detayda başka bir kelimeyle görünür ve vardiya
 * ortasındaki kullanıcı iki farklı şey olduğunu sanar. Bu sözlükler 2026-08-14'e
 * kadar `InvoicesPage` içinde modül-yerel duruyordu; detay yüzeyi eklenirken
 * buraya taşındı — ikinci tüketici doğduğu an tek kaynak zorunlu hale geldi.
 *
 * ⚠️ Her sınıf `dark:` varyantını DA taşır; yalnız `bg-amber-100` yazan bir satır
 * koyu temada okunmaz olur.
 *
 * İKİ ROZET İKİ AYRI SORUDUR ve birleştirilemez: durum "belge ne durumda"
 * (TASLAK/ONAYLI/İPTAL), kapama "parası geldi mi" (AÇIK/KISMİ/KAPALI). Kapama
 * yalnız ONAYLI faturada anlamlıdır — kapısı `settlementOf`'tadır.
 */
export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Taslak", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  CONFIRMED: { label: "Onaylı", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  CANCELLED: { label: "İptal", cls: "bg-muted text-muted-foreground line-through" },
};

/** AÇIK amber (bekleyen alacak) · KISMİ mavi · KAPALI yeşil. */
export const SETTLEMENT_BADGE: Record<SettlementState, string> = {
  ACIK: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  KISMI: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  KAPALI: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

// -----------------------------------------------------------------------------
// FATURA DETAYI (`GET /api/finance/invoices/:id`)
// -----------------------------------------------------------------------------

export interface InvoiceLineRow {
  id: string;
  lineNo: number;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  withholdingRate: number;
  lineTotal: number;
  vatAmount: number;
  item: { id: string; code: string; name: string } | null;
}

/**
 * Detay yanıtı — backend `invoice.service.DETAIL_SELECT` aynası.
 *
 * ⚠️ Alan kümesi backend'de BEKÇİYLE sabitlenmiş (`test_finance_invoice` detay
 * bölümü) ve burada yalnız OKUNAN alanlar tiplenmiştir. `cari` listedekinden
 * ZENGİNDİR (vergi no/dairesi) — bu yüzden `InvoiceRow`'un cari'si spread ile
 * miras alınmaz, yeniden yazılır.
 *
 * KAYNAK BAĞLARI (2026-08-15): dördü de İNSANCA ADIYLA gelir (goodsReceipt /
 * shipment / directShipment / subcontractorReceipt — id + belge no). Çıplak iç
 * FK'ler yanıtta yine GEZMEZ; tek istisna `returnGroupId` — iade grubunun
 * ilişkisi yoktur (grup lideri RollReturn id'sidir), skaler tek taşıyıcıdır.
 */
export interface InvoiceDetail extends Omit<InvoiceRow, "cari"> {
  shipment: { id: string; shipmentNo: string } | null;
  directShipment: { id: string; shipmentNo: string } | null;
  subcontractorReceipt: { id: string; receiptNo: string } | null;
  returnGroupId: string | null;
  notes: string | null;
  subtotal: number;
  discountTotal: number;
  vatTotal: number;
  withholdingTotal: number;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  cari: {
    id: string;
    kind: string;
    taxOffice: string | null;
    customer: { id: string; code: string; name: string; taxNumber: string | null } | null;
    subcontractor: { id: string; code: string; name: string; taxNumber: string | null } | null;
  };
  goodsReceipt: { id: string; receiptNo: string; deliveryNoteNo: string | null } | null;
  lines: InvoiceLineRow[];
}

export async function getInvoice(id: string): Promise<InvoiceDetail> {
  const res = await apiClient.get(`/api/finance/invoices/${id}`);
  return (res.data as { data: InvoiceDetail }).data;
}

type Paged<T> = { data: T[]; pagination: { total: number; totalPages: number } };

export async function listCari(params: {
  page: number;
  pageSize: number;
  search?: string;
  kind?: string;
  onlyWithBalance?: boolean;
  /** Vadesi geçmiş açık tutarları da iste (H2) — backend bayraksız istekte
   *  ek sorgu koşmaz, yanıtta `overdue` alanı hiç olmaz. */
  withOverdue?: boolean;
}): Promise<Paged<CariRow>> {
  const res = await apiClient.get("/api/finance/cari", { params });
  return res.data;
}

/**
 * CARİ KART GÜNCELLEME — vade / risk limiti / vergi dairesi / para birimi / aktiflik.
 *
 * ⚠️ GÖVDE `.strict()` (backend `finance.routes.ts:125`): şemada OLMAYAN tek bir
 * anahtar 400 ile tüm isteği düşürür. Kabul edilenler bu tipte sayılıdır;
 * `customerId`/`subcontractorId` PATCH'te `omit` edilmiştir (cari kartın hangi
 * tarafa bağlı olduğu değiştirilemez) — göndermeye kalkma.
 *
 * ⚠️ `null` ile `undefined` AYRI ŞEYLERDİR ve ayrım backend'de gerçek:
 * `input.X !== undefined` olan alan YAZILIR (`cari.service.ts:243-249`), yani
 * `null` göndermek alanı TEMİZLER, alanı hiç göndermemek DOKUNMAZ. Vade günü
 * için bu ayrım kritiktir: `0` = peşin (fatura günü vadeli) ≠ `null` = vadesiz.
 *
 * `notes` 2026-08-14 dikişiyle eklendi: okuma yolu (list/findById map'leri) aynı
 * gün açıldı — okunamayan alan yazdırılmaz kuralı böyle sağlandı (alan bir süre
 * bilinçli olarak tipte yoktu).
 *
 * `suppressErrorToast` YOK: "bakiyesi sıfırlanmadan pasifleştirilemez" gibi 409
 * cümleleri interceptor toast'ıyla aynen gösterilir (mevcut sözleşme).
 */
export interface CariUpdateInput {
  /** `null` → vergi dairesini temizle. */
  taxOffice?: string | null;
  defaultCurrency?: Currency;
  /** `null` → vadesiz · `0` → peşin. İkisi AYRI. */
  paymentTermDays?: number | null;
  /** Ondalık STRING (nokta ayraçlı) ya da `null` → limitsiz. */
  riskLimit?: string | null;
  /** `null` → notu temizle. */
  notes?: string | null;
  isActive?: boolean;
}

export async function updateCari(id: string, body: CariUpdateInput) {
  const res = await apiClient.patch(`/api/finance/cari/${id}`, body);
  return res.data as { data: { id: string }; message?: string };
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
  /** Devrin kaynağı MÜHÜRLÜ kapanışsa dolu (K5, 2026-08-14) — mühürsüz cari /
   *  eski backend'de gelmez; yoksa devir düz toplamdan ve not basılmaz. */
  carriedFrom?: { periodEnd: string; closingBalance: number } | null;
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
  /** Kaynak iade grubu — aynı kural, satış-iade tarafı (H8, 2026-08-14). */
  returnGroupId?: string | null;
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
