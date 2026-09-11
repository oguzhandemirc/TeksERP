// =============================================================================
// ÇEK / SENET PORTFÖY API İSTEMCİSİ
// =============================================================================
// ⚠️ Yollar TAM yazılır ("/api/finance/cheques…") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "boş liste"
// gösterir (2026-08-12'de FilterBar lookup'larında tam bu yaşandı).
//
// ⚠️ BACKEND ZOD ŞEMALARI `.strict()` — TANIMADIĞI anahtar 400 döndürür. Yani
// "ne olur ne olmaz" diye fazladan alan göndermek, işlemi sessizce değil GÜRÜLTÜLÜ
// biçimde ama YANLIŞ sebeple düşürür (kullanıcı "tutar hatalı" sanır). En kolay
// düşülen tuzak `cancel`: o uç YALNIZ `reason` kabul eder — `eventDate`/`notes`
// göndermek 400'dür. Bu yüzden imzası diğer geçişlerden bilinçli olarak FARKLI.
//
// ⚠️ TUTARLAR Decimal'dir ve JSON'a STRING olarak düşebilir (Prisma
// `Decimal.toJSON()` → string). `money()` `number` bekler; string geçilirse
// `String.prototype.toLocaleString` devreye girer, HATA VERMEZ ve tutarı
// BİÇİMSİZ basar ("1234.50 ₺"). Bu yüzden ekrana giden her tutar `toNum()`
// süzgecinden geçer — tek dönüşüm noktası (`RatesPage`'in `Number(r.rate)`
// sarmalamasıyla aynı gerekçe).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { Currency } from "../service";

export type ChequeKind = "RECEIVED" | "ISSUED";
export type ChequeDocType = "CHEQUE" | "PROMISSORY_NOTE";

/** Backend `ChequeStatus` enum'unun aynası (Electron backend'i import edemez). */
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

/** Backend `ChequeEventType` enum'unun aynası. */
export type ChequeEventType =
  | "RECEIVE"
  | "ISSUE"
  | "DEPOSIT"
  | "COLLECT"
  | "COLLECT_CANCEL"
  | "ENDORSE"
  | "BOUNCE"
  | "RETURN"
  | "PAY"
  | "CANCEL"
  | "ENDORSE_CANCEL"
  | "BOUNCE_CANCEL"
  | "RETURN_CANCEL"
  | "PAY_CANCEL";

/** Decimal kolonun JSON karşılığı — number DA string DE gelebilir (dosya başlığı). */
export type DecimalLike = number | string;

/** Ekrana giden tek dönüşüm noktası. Geçersiz değerde 0 — NaN basmaktansa. */
export function toNum(value: DecimalLike | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Cari referansı — hangi tarafa bağlıysa adı oradan okunur (`partyName`). */
export interface CariRef {
  id: string;
  customer: { code: string; name: string } | null;
  subcontractor: { code: string; name: string } | null;
}

export interface ChequeRow {
  id: string;
  docNo: string;
  kind: ChequeKind;
  docType: ChequeDocType;
  status: ChequeStatus;
  currency: Currency;
  amount: DecimalLike;
  amountTry: DecimalLike;
  /**
   * İŞLEM tarihi — defterin/belge numarasının/kurun çıpası (SINIF 1, 2026-08-14).
   * Liste ucu da dönüyor (backend `list` select'ine aynı gün eklendi — eski
   * "HENÜZ dönmüyor" notu bayattı); tip yine OPSİYONEL kalır: eski backend'e
   * karşı tablo yalnız keşideyi basar, "—" uydurmaz.
   */
  postingDate?: string;
  /** KEŞİDE tarihi — kâğıdın üzerindeki tarih (hukuki veri); defteri ETKİLEMEZ. */
  issueDate: string;
  dueDate: string;
  serialNo: string | null;
  bankName: string | null;
  drawerName: string | null;
  /** Faturaya kapatılan tutar — >0 ise karşılıksız/iade/iptal REDDEDİLİR. */
  allocatedTotal: DecimalLike;
  bankAccount: { id: string; name: string } | null;
  cari: CariRef;
  /** Ciro edildiyse ALAN cari. Ciro sonrası da DOLU KALIR (backend NULL'lamaz). */
  endorsedToCari: CariRef | null;
}

export interface ChequeEventRow {
  id: string;
  type: ChequeEventType;
  /** Doğuş satırında NULL — atomik claim'in "neyi tükettiği" bilgisi. */
  fromStatus: ChequeStatus | null;
  toStatus: ChequeStatus;
  eventDate: string;
  /** Yazım anı — storno zincirinin kronolojisi (eventDate geriye tarihlenebilir). Eski backend göndermez. */
  createdAt?: string;
  notes: string | null;
  counterCari: CariRef | null;
  bankAccount: { id: string; name: string } | null;
  cashBox: { id: string; name: string } | null;
}

export interface ChequeDetail extends ChequeRow {
  /** Detay ucu (`findById` select) her zaman döner — kolon NOT NULL. */
  postingDate: string;
  branchName: string | null;
  notes: string | null;
  exchangeRate: DecimalLike;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  /** APPEND-ONLY defter, KRONOLOJİK sırada (backend `eventDate asc`). */
  events: ChequeEventRow[];
}

export interface ChequeSummaryRow {
  kind: ChequeKind;
  status: ChequeStatus;
  currency: Currency;
  count: number;
  amount: DecimalLike;
  amountTry: DecimalLike;
}

type Paged<T> = {
  data: T[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
};

/** Geçiş uçlarının ortak yanıtı — mesaj BACKEND'İN cümlesidir, ezme. */
type MutationResult = { data?: { id: string; docNo: string }; message?: string };

// -----------------------------------------------------------------------------
// OKUMA
// -----------------------------------------------------------------------------

export async function listCheques(params: {
  page: number;
  pageSize: number;
  kind?: string;
  docType?: string;
  /** CSV — backend bu parametreyi virgülle bölüp `IN` sorgusuna çevirir. */
  status?: string;
  cariId?: string;
  currency?: string;
  bankAccountId?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
}): Promise<Paged<ChequeRow>> {
  const res = await apiClient.get("/api/finance/cheques", { params });
  return res.data;
}

export async function getChequeSummary(kind?: string): Promise<ChequeSummaryRow[]> {
  const res = await apiClient.get("/api/finance/cheques/summary", {
    params: kind ? { kind } : undefined,
  });
  return (res.data as { data: ChequeSummaryRow[] }).data;
}

export async function getCheque(id: string): Promise<ChequeDetail> {
  const res = await apiClient.get(`/api/finance/cheques/${id}`);
  return (res.data as { data: ChequeDetail }).data;
}

// -----------------------------------------------------------------------------
// DOĞUŞ
// -----------------------------------------------------------------------------

export async function createCheque(body: {
  kind: ChequeKind;
  docType?: ChequeDocType;
  customerId?: string | null;
  subcontractorId?: string | null;
  currency?: Currency;
  /** Boş bırakılırsa backend kur tablosundan çözer; bulamazsa yol gösteren 400 verir. */
  exchangeRate?: number | null;
  amount: number;
  /** KEŞİDE tarihi — kâğıdın bilgisi. Verilmezse backend "şimdi"yi yazar. */
  issueDate?: string;
  /**
   * İŞLEM tarihi — belge no, kur, cari defter satırı ve dönem kilidi BUNDAN
   * çözülür (keşideden DEĞİL). Verilmezse backend BUGÜNÜ kullanır — "çek bugün
   * işleniyor" varsayımı doğru varsayılandır (backend Swagger sözleşmesi).
   */
  postingDate?: string;
  dueDate: string;
  serialNo?: string | null;
  bankName?: string | null;
  branchName?: string | null;
  drawerName?: string | null;
  notes?: string | null;
  clientToken?: string;
}): Promise<MutationResult> {
  const res = await apiClient.post("/api/finance/cheques", body);
  return res.data as MutationResult;
}

// -----------------------------------------------------------------------------
// GEÇİŞLER
// -----------------------------------------------------------------------------
// Hepsi ATOMİK CLAIM'dir: aynı çeke ikinci istek 409 alır. İstemcide ayrıca
// "tıklandı" kilidi vardır (ConfirmDialog) ama asıl koruma sunucudadır.

/** Ortak olay gövdesi — tarih verilmezse backend "şimdi"yi kullanır. */
export interface ChequeEventBody {
  eventDate?: string;
  notes?: string | null;
}

export async function chequeDeposit(
  id: string,
  body: { bankAccountId: string } & ChequeEventBody,
): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/deposit`, body);
  return res.data as MutationResult;
}

/** Kasa VEYA banka — İKİSİ BİRDEN gönderilirse backend 400 verir (XOR seddi). */
export async function chequeCollect(
  id: string,
  body: { cashBoxId?: string | null; bankAccountId?: string | null } & ChequeEventBody,
): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/collect`, body);
  return res.data as MutationResult;
}

/**
 * TAHSİL STORNOSU (K-2) — yanlış COLLECT geri alınır. Uç YALNIZ `reason` kabul
 * eder (`.strict()`; sebep ZORUNLU): tarih/not/hesap GÖNDERİLMEZ — hesabı ve
 * dönülecek durumu backend son COLLECT olayından kendisi çözer, ters satır
 * BUGÜNE düşer (storno sözleşmesi).
 */
/** Tipli storno uçları — beşi de yalnız `reason` kabul eder (`.strict()`). */
export type ChequeReversalPath =
  | "collect-cancel"
  | "endorse-cancel"
  | "bounce-cancel"
  | "return-cancel"
  | "pay-cancel";

export async function chequeReverse(id: string, path: ChequeReversalPath, reason: string): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/${path}`, { reason });
  return res.data as MutationResult;
}

export async function chequeCollectCancel(id: string, reason: string): Promise<MutationResult> {
  return chequeReverse(id, "collect-cancel", reason);
}

export async function chequeEndorse(
  id: string,
  body: {
    toCustomerId?: string | null;
    toSubcontractorId?: string | null;
  } & ChequeEventBody,
): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/endorse`, body);
  return res.data as MutationResult;
}

export async function chequeBounce(id: string, body: ChequeEventBody): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/bounce`, body);
  return res.data as MutationResult;
}

export async function chequeReturn(id: string, body: ChequeEventBody): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/return`, body);
  return res.data as MutationResult;
}

export async function chequePay(
  id: string,
  body: { cashBoxId?: string | null; bankAccountId?: string | null } & ChequeEventBody,
): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/pay`, body);
  return res.data as MutationResult;
}

/**
 * İPTAL — şemasında `eventDate`/`notes` YOKTUR (bkz. dosya başlığı).
 * `reason` opsiyoneldir ama boş göndermek "neden iptal edildi" sorusunu
 * cevapsız bırakır; ekran onu zorunlu sorar.
 */
export async function chequeCancel(id: string, reason?: string): Promise<MutationResult> {
  const res = await apiClient.post(`/api/finance/cheques/${id}/cancel`, { reason });
  return res.data as MutationResult;
}

// -----------------------------------------------------------------------------
// RESMÎ TESLİM BORDROSU (2026-08-15, J2 #18)
// -----------------------------------------------------------------------------
// ⚠️ AYRI KAYNAK, AYRI YOL: `/api/finance/cheque-delivery-notes` — `…/cheques`
// ile çakışmaz (Express tam segment eşler). Gövdeyi ekran ELLE KURMAZ,
// `chequeDeliveryNote.buildDeliveryNoteBody` üretir (kurallar orada).
//
// ⚠️ İZİN `finance:write`, `finance:cheque` DEĞİL — bordro çekin DURUM
// MAKİNESİNE dokunmaz, yalnız kâğıt üretir. Yazmayı `finance:cheque`e bağlamak
// "teslim tutanağı bastır" isteyen kişiye çek tahsil etme yetkisi vermek olurdu
// (backend rotasındaki gerekçenin aynısı; iki taraf hizalı kalmalı).

export async function createChequeDeliveryNote(body: {
  chequeIds: string[];
  deliveryDate?: string;
  bankAccountId?: string | null;
  cariId?: string | null;
  targetLabel?: string;
  notes?: string;
  /** "Zaten aktif bir bordroda" uyarısı onaylandı (409'u geçer). */
  confirmDuplicate?: boolean;
}): Promise<{ data?: { id: string; docNo: string; count: number }; message?: string }> {
  const res = await apiClient.post("/api/finance/cheque-delivery-notes", body);
  return res.data as { data?: { id: string; docNo: string; count: number }; message?: string };
}

/**
 * Kesilmiş bordrolar — belgeye DÖNÜŞ YOLU (2026-08-15). Gerekçe:
 * `../officialDocs.ts` başlığı (kesilen belgeye ulaşılamıyordu; iptal ucu
 * yazılmıştı ama hiçbir kullanıcı tetikleyemiyordu).
 */
export interface DeliveryNoteRow {
  id: string;
  docNo: string;
  kind: ChequeKind;
  status: "ACTIVE" | "CANCELLED";
  deliveryDate: string;
  targetLabel: string | null;
  notes: string | null;
  createdAt: string;
  bankAccount: { id: string; name: string } | null;
  cari: {
    id: string;
    customer: { code: string; name: string } | null;
    subcontractor: { code: string; name: string } | null;
  } | null;
  _count: { items: number };
}

export async function listChequeDeliveryNotes(params: {
  page?: number;
  pageSize?: number;
  kind?: ChequeKind;
  status?: "ACTIVE" | "CANCELLED";
  search?: string;
}): Promise<{ data: DeliveryNoteRow[]; pagination: { total: number } }> {
  const res = await apiClient.get("/api/finance/cheque-delivery-notes", { params });
  return res.data as { data: DeliveryNoteRow[]; pagination: { total: number } };
}

export async function cancelChequeDeliveryNote(
  id: string,
  reason?: string,
): Promise<{ message?: string }> {
  const res = await apiClient.post(`/api/finance/cheque-delivery-notes/${id}/cancel`, { reason });
  return res.data as { message?: string };
}
