// =============================================================================
// FATURA KAPAMA (allocation) — API istemcisi
// =============================================================================
// ⚠️ Yollar TAM yazılır ("/api/finance/..."): `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "boş liste"
// gösterir — yani hata hiç görünmez, kullanıcı "kapatacak fatura yok" sanır.
//
// ⚠️ BU DOMAİNDE İKİ FARKLI SAYI ŞEKLİ VAR ve karıştırmak SESSİZ hata üretir:
//   • `/api/finance/allocations/*` uçları tutarları `Decimal.toString()` ile
//     yazar → JSON'da STRING gelir ("1500.00"). Bilinçli: kuruş hassasiyeti
//     metinde birebir korunur.
//   • `/api/finance/cheques` gibi uçlar ham `Decimal` döner; backend'deki global
//     `Decimal.prototype.toJSON` yaması onları NUMBER'a çevirir.
// Tipler bu yüzden birebir yazıldı. "Hepsi number olsun" diye basitleştirmek,
// string gelen alanlarda `+` işlecini toplama değil METİN BİRLEŞTİRME yapardı
// ("15" + "10" = "1510") ve sonuç hiçbir yerde hata vermeden yanlış olurdu.
// Okuma tek noktadan: `allocationMath.num()` / `toKurus()`.
import apiClient from "@/services/apiClient";
import { createCrudService, type CrudService } from "@/services/crudService";
import type { CariRow, Currency, InvoiceType } from "../service";

export type Direction = "IN" | "OUT";
export type SourceKind = "PAYMENT" | "CHEQUE";

export type ChequeStatus =
  | "PORTFOLIO"
  | "AT_BANK"
  | "ENDORSED"
  | "COLLECTED"
  | "BOUNCED"
  | "RETURNED"
  | "ISSUED"
  | "PAID"
  | "CANCELLED";

/**
 * Kapamaya UYGUN çek durumları — backend `chequeCanAllocate()` ile BİREBİR.
 *
 * ⚠️ Liste ayrışırsa ekran ile uç birbirine yalan söyler: ya kullanıcıya
 * seçtiremediğimiz bir çek uçta kabul edilir (özellik sessizce kaybolur), ya da
 * seçtirdiğimiz çek her denemede 409 alır. Karşılıksız/iade/iptal çek bilerek
 * DIŞARIDA — o çekin parası gelmedi, onunla borç kapatmak olmayan parayla
 * ödeme yapmaktır.
 */
export const ALLOCATABLE_CHEQUE_STATUSES: ChequeStatus[] = [
  "PORTFOLIO",
  "AT_BANK",
  "ENDORSED",
  "COLLECTED",
  "ISSUED",
  "PAID",
];

/** Açık fatura satırı — tutarlar STRING (yukarıdaki nota bak). */
export interface OpenInvoiceRow {
  id: string;
  docNo: string;
  type: InvoiceType;
  currency: Currency;
  issueDate: string;
  dueDate: string | null;
  /** `dueDate ?? issueDate` — FIFO sırasının ve "vadesi geçti mi"nin anahtarı. */
  effectiveDueDate: string;
  grandTotal: string;
  paidTotal: string;
  /** `grandTotal - paidTotal` — kapatılabilir kalan. */
  openTotal: string;
  /** FIFO ÖNERİSİ — yalnız `amount` sorulduğunda döner. Kapama YAPMAZ. */
  suggested?: string;
}

/** Bağlanmamış tahsilat/ödeme — tutarlar STRING. */
export interface UnallocatedPaymentRow {
  id: string;
  docNo: string;
  direction: Direction;
  paymentDate: string;
  amount: string;
  allocatedTotal: string;
  freeTotal: string;
}

/** Portföy listesi satırı — tutarlar NUMBER (global Decimal yaması). */
export interface ChequeListRow {
  id: string;
  docNo: string;
  kind: "RECEIVED" | "ISSUED";
  docType: "CHEQUE" | "PROMISSORY_NOTE";
  status: ChequeStatus;
  currency: Currency;
  amount: number;
  allocatedTotal: number;
  issueDate: string;
  dueDate: string;
  serialNo: string | null;
  bankName: string | null;
  drawerName: string | null;
  cari: { id: string } | null;
}

/** Mevcut kapama satırı — `amount` ve fatura tutarları NUMBER. */
export interface AllocationRow {
  id: string;
  amount: number;
  notes: string | null;
  createdAt: string;
  invoice: {
    id: string;
    docNo: string;
    type: InvoiceType;
    currency: Currency;
    grandTotal: number;
    paidTotal: number;
    issueDate: string;
    dueDate: string | null;
  };
  payment: { id: string; docNo: string; direction: Direction; paymentDate: string } | null;
  cheque: { id: string; docNo: string; kind: "RECEIVED" | "ISSUED"; status: ChequeStatus; dueDate: string } | null;
}

/**
 * Cari seçici kaynağı.
 *
 * ⚠️ MÜŞTERİ DEĞİL CARİ seçilir: kapama uçları `cariId` ister. Tahsilat formunda
 * `customerId` kullanılması yanıltmasın — orada uç müşteriden cariyi kendisi
 * türetiyor, burada öyle bir dal YOK. Yanlış id gönderilirse uç "Cari hesap
 * bulunamadı" der ve kullanıcı sebebini ekranda göremez.
 *
 * ⚠️ `isActive` SÜZGECİ BİLEREK DÜŞÜRÜLÜR. `ReferenceSelect` her çağrıya
 * `filters.isActive = "true"` ekler; burası doğru davranış DEĞİL: pasifleştirilmiş
 * bir carinin açık faturası ve serbest tahsilatı hâlâ olabilir ve muhasebe onları
 * kapatabilmelidir — cariyi kapatmak geçmişini kilitlemek anlamına gelmez.
 * Bugün uç `filter[isActive]`ı zaten okumuyor, yani süzgeç fiilen etkisiz; ama
 * ona GÜVENMEK kırılgandır (uç bir gün jenerik yola bağlanırsa pasif cariler
 * ekrandan sessizce kaybolurdu). Bu yüzden karar burada AÇIKÇA veriliyor.
 */
const cariCrud = createCrudService<CariRow>("/api/finance/cari");
export const cariPickerService: CrudService<CariRow> = {
  ...cariCrud,
  getAll: (params) => {
    const filters = { ...(params.filters ?? {}) };
    delete filters.isActive;
    return cariCrud.getAll({ ...params, filters });
  },
};

export async function getCari(id: string): Promise<CariRow> {
  const res = await apiClient.get(`/api/finance/cari/${id}`);
  return (res.data as { data: CariRow }).data;
}

export async function listOpenInvoices(params: {
  /** İkisinden TAM BİRİ: hesap kimliği (Fatura Kapama) ya da müşteri kartı (ödeme diyaloğu — hesabı bilmez; hesap yoksa boş liste). */
  cariId?: string;
  customerId?: string;
  currency: Currency;
  direction: Direction;
  /** Verilirse her satıra FIFO `suggested` eklenir — yalnız ÖNERİ. */
  amount?: string;
}): Promise<{ data: OpenInvoiceRow[]; totalOpen: string }> {
  const res = await apiClient.get("/api/finance/allocations/open-invoices", { params });
  return res.data as { data: OpenInvoiceRow[]; totalOpen: string };
}

export async function listUnallocatedPayments(params: {
  cariId: string;
  currency: Currency;
  direction: Direction;
}): Promise<{ data: UnallocatedPaymentRow[]; totalFree: string }> {
  const res = await apiClient.get("/api/finance/allocations/unallocated-payments", { params });
  return res.data as { data: UnallocatedPaymentRow[]; totalFree: string };
}

/**
 * Kapamaya uygun çek/senetler.
 *
 * ⚠️ Ayrı bir "bağlanmamış çekler" ucu YOK — portföy listesi süzülerek
 * kullanılır. `kind` süzgeci yön kuralının aynasıdır (ALINAN çek yalnız SATIŞ,
 * VERİLEN çek yalnız ALIŞ faturasını kapatır); uçta da aynı kural var, burada
 * süzmek kullanıcıyı kesin 400 alacak bir seçimden korur.
 */
export async function listAllocatableCheques(params: {
  cariId: string;
  currency: Currency;
  direction: Direction;
}): Promise<ChequeListRow[]> {
  const res = await apiClient.get("/api/finance/cheques", {
    params: {
      page: 1,
      pageSize: 200,
      cariId: params.cariId,
      currency: params.currency,
      kind: params.direction === "IN" ? "RECEIVED" : "ISSUED",
      status: ALLOCATABLE_CHEQUE_STATUSES.join(","),
    },
  });
  const rows = (res.data as { data?: ChequeListRow[] }).data ?? [];
  // ⚠️ Backend'in `cariId` süzgeci CİRO EDİLEN tarafı DA kapsar
  // (`OR endorsedToCariId`) — portföy ekranı için doğru, kapama için YANLIŞ:
  // kapama `cheque.cariId === invoice.cariId` arar. Süzülmezse ciro edilmiş bir
  // çek listede durur ve seçildiği anda "başka bir cariye ait" 400'ü alır.
  return rows.filter((c) => c.cari?.id === params.cariId);
}

export async function listAllocations(params: {
  invoiceId?: string;
  paymentId?: string;
  chequeId?: string;
}): Promise<{ data: AllocationRow[] }> {
  const res = await apiClient.get("/api/finance/allocations", { params });
  return res.data as { data: AllocationRow[] };
}

/** Tek kapama. `amount` METİN gider — float'a düşürmek kuruş sapması demekti. */
export async function allocate(body: {
  invoiceId: string;
  paymentId?: string | null;
  chequeId?: string | null;
  amount: string;
  notes?: string | null;
}) {
  const res = await apiClient.post("/api/finance/allocations", body);
  return res.data as { message?: string };
}

/** Toplu kapama — TEK transaction, HEPSİ-YA-HİÇ (uçta da öyle). */
export async function allocateBulk(body: {
  paymentId?: string | null;
  chequeId?: string | null;
  items: Array<{ invoiceId: string; amount: string; notes?: string | null }>;
}) {
  const res = await apiClient.post("/api/finance/allocations/bulk", body);
  return res.data as { message?: string };
}

/** Kapamayı çöz — satır fiziksel silinir, sayaçlar aynı tx'te düşer. */
export async function deallocate(id: string) {
  const res = await apiClient.delete(`/api/finance/allocations/${id}`);
  return res.data as { message?: string };
}

/** Toplu uçun sunucu tarafı tavanı — ekran de aynı sınırı önden söyler. */
export const BULK_MAX_ITEMS = 100;
