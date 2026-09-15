// =============================================================================
// İPLİK KG-STOK API İSTEMCİSİ (Paket D1 panel ayağı)
// =============================================================================
// NEDEN VAR: İplik `Roll` DEĞİLDİR — top metreyle ölçülüp tek tek izlenir, iplik
// kg ile gelir ve çuvaldan çuvala karışır. Bu yüzden iplik stoğunun kendi
// defteri (`YarnStock` + `YarnMovement`) ve kendi ekranı var; envanter (Toplar)
// ekranında GÖRÜNMEZ ve görünmemeli.
//
// ⚠️ YOLLAR TAM YAZILIR ("/api/yarn/…") — `apiClient.baseURL` `/api` İÇERMEZ.
// Öneksiz yol 404 alır, çağıran hatayı yutarsa ekran "kayıt yok" gösterir
// (2026-08-12'de FilterBar lookup'larında tam bu yaşandı).
//
// ⚠️ MİKTARLAR Decimal'dir ve JSON'a **STRING** düşer ("3324"). `number` diye
// tiplemek derlemede yakalanmaz (değer `any` olarak gelir) ama çalışma anında
// `String.prototype.toLocaleString` devreye girer ve seçenekleri SESSİZCE yok
// sayar → "3324" basılır, "3.324,00" değil. Bu yüzden tipler `DecimalLike` ve
// ekrana giden her kg `kg()` süzgecinden geçer (bkz. `qty.ts`).
//
// ⚠️ POST /movements ŞEMASI `.strict()` — TANIMADIĞI anahtar 400 döndürür.
// `clientToken` bu ucun sözleşmesinde YOKTUR; "ne olur ne olmaz" diye eklemek
// kaydı sessizce değil, GÜRÜLTÜLÜ ama YANLIŞ sebeple düşürür (kullanıcı
// "miktar hatalı" sanır). Mükerrer koruması bu uçta yok; ikinci kez basılan
// hareket ikinci bir defter satırıdır ve TERS KAYITLA kapatılır (defter
// felsefesi: geçmiş düzeltilmez, düzeltme de deftere yazılır).
//
// ⚠️ /stocks ile /movements FİLTRE SÖZLEŞMESİ FARKLIDIR:
//   • /stocks   → itemId/warehouseId **UUID ya da virgüllü UUID listesi** (CSV)
//   • /movements→ itemId/warehouseId **YALNIZ TEKİL UUID** (`z.string().uuid()`)
// Birine CSV göndermek 400 "Geçersiz kimlik" verir. Karıştırma.
// =============================================================================
import apiClient from "@/services/apiClient";

/** Backend `YarnMovementKind` enum'unun aynası (Electron backend'i import edemez). */
export type YarnMovementKind = "IN" | "OUT" | "ADJUST_IN" | "ADJUST_OUT" | "WARP_ISSUE" | "WARP_ISSUE_REVERSAL" | "WARP_RETURN" | "WARP_RETURN_REVERSAL" | "SUBCONTRACT_OUT" | "SUBCONTRACT_OUT_CANCEL" | "SUBCONTRACT_RETURN" | "SUBCONTRACT_RETURN_CANCEL";

/** Decimal kolonun JSON karşılığı — number DA string DE gelebilir (dosya başlığı). */
export type DecimalLike = number | string;

export interface YarnStockRow {
  id: string;
  balanceKg: DecimalLike;
  /** `YarnStock.updatedAt` — bakiyeye EN SON dokunulduğu an ("son hareket"). */
  updatedAt: string;
  item: { id: string; code: string; name: string; unit: string };
  warehouse: { id: string; code: string; name: string };
}

export interface YarnMovementRow {
  id: string;
  kind: YarnMovementKind;
  /** HER ZAMAN POZİTİF — yönü `kind` söyler (DB CHECK ile kilitli). */
  qtyKg: DecimalLike;
  reason: string | null;
  createdAt: string;
  goodsReceiptId: string | null;
  invoiceId: string | null;
  item: { id: string; code: string; name: string };
  warehouse: { id: string; code: string; name: string };
  user: { id: string; fullName: string | null; username: string } | null;
  goodsReceipt: { id: string; receiptNo: string } | null;
  /** Devere Faz 2: lot etiketi (lotsuz satırda null) + bobin adedi (bilgi). */
  lot?: { id: string; lotNo: string } | null;
  bobbinCount?: number | null;
}

// ── İPLİK LOTLARI (devere Faz 2) ──────────────────────────────────────────────
// Lot DURUM kaydı; `balanceKg` hareketlerden TÜRETİLİR (sunucu hesaplar). Silme yok, pasife alma.
export interface YarnLotRow {
  id: string;
  itemId: string;
  lotNo: string;
  supplierId: string | null;
  notes: string | null;
  isActive: boolean;
  item: { id: string; code: string; name: string };
  supplier: { id: string; name: string } | null;
  /** G3 emanet: lotun sahibi (müşteri); eski backend göndermez → opsiyonel. */
  ownerCustomerId?: string | null;
  ownerCustomer?: { id: string; name: string } | null;
  balanceKg: number;
  createdAt: string;
  updatedAt: string;
}

export interface YarnLotListResponse {
  success: boolean;
  data: YarnLotRow[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export async function listYarnLots(params: { limit?: number; cursor?: string; itemId?: string; supplierId?: string; search?: string; isActive?: boolean }): Promise<YarnLotListResponse> {
  const res = await apiClient.get("/api/yarn/lots", {
    params: {
      ...(params.limit ? { limit: params.limit } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.itemId ? { itemId: params.itemId } : {}),
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.search ? { search: params.search } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive ? "true" : "false" } : {}),
    },
  });
  return res.data as YarnLotListResponse;
}

export async function createYarnLot(body: { itemId: string; lotNo: string; supplierId?: string | null; notes?: string | null; ownerCustomerId?: string | null }): Promise<{ success: boolean; data: YarnLotRow; message?: string }> {
  const res = await apiClient.post("/api/yarn/lots", body);
  return res.data as { success: boolean; data: YarnLotRow; message?: string };
}

export async function updateYarnLot(id: string, body: { notes?: string | null; isActive?: boolean; supplierId?: string | null }): Promise<{ success: boolean; data: YarnLotRow }> {
  const res = await apiClient.patch(`/api/yarn/lots/${id}`, body);
  return res.data as { success: boolean; data: YarnLotRow };
}

// ⚠️ Yanıt tipleri "…ListResponse" adını taşır, "…Page" DEĞİL: bu klasörde
// `YarnStockPage` bir BİLEŞENDİR ve aynı adı bir tipe de vermek, editörün
// otomatik içe aktarmasının sayfayı beklerken tipi (ya da tersini) getirmesi
// demekti — aynı ada sahip iki şey, farklı iki dosyada.
export interface YarnStockListResponse {
  data: YarnStockRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  /** SAYFANIN değil FİLTRENİN toplamı — "depoda ne kadar iplik var" sorusunun cevabı. */
  totals: { balanceKg: DecimalLike };
}

export interface YarnMovementListResponse {
  data: YarnMovementRow[];
  /** Cursor'lu döküm: defter append-only ve yıllarca büyür (offset yok). */
  nextCursor: string | null;
}

// -----------------------------------------------------------------------------
// HAREKET TÜRÜ SÖZLÜĞÜ
// -----------------------------------------------------------------------------
// ⚠️ İŞARET (`sign`) TÜRDEN OKUNUR, miktardan değil. Tek bir işaretli miktar
// alanı, bir gün birinin `Math.abs()` yazıp eksi sayım farkını artı saymasına
// açık kapı bırakırdı — ve o hata deftere DOĞRU GÖRÜNEN bir satır olarak
// yazılırdı. Backend `yarnMovementSign`'ın aynası; ayrışırsa ekran hareketi ters
// yönde anlatır (rakam doğru, cümle yalan).
//
// ⚠️ RENK TEK BAŞINA BİLGİ TAŞIMAZ (renk körlüğü + eldivenli hızlı bakış):
// işaret her zaman metin olarak da basılır ("+" / "−").

export interface YarnKindMeta {
  /** Diyalog seçeneği — ne yaptığını tam söyler. */
  label: string;
  /** Liste rozeti — dar sütuna sığar. */
  short: string;
  sign: 1 | -1;
  /** Sayım düzeltmesi mi? Sebep alanı bunlarda ÖNE ÇIKARILIR. */
  adjustment: boolean;
  /** Diyalogda seçeneğin altına düşen açıklama — "hangisini seçmeliyim". */
  hint: string;
}

export const YARN_KIND_META: Record<YarnMovementKind, YarnKindMeta> = {
  IN: {
    label: "Giriş (+)",
    short: "Giriş",
    sign: 1,
    adjustment: false,
    hint: "Depoya iplik girdi (satın alma, fasondan dönüş, iade).",
  },
  OUT: {
    label: "Çıkış (−)",
    short: "Çıkış",
    sign: -1,
    adjustment: false,
    hint: "Depodan iplik çıktı (üretime verildi, sevk edildi).",
  },
  ADJUST_IN: {
    label: "Sayım düzeltmesi — artı (+)",
    short: "Sayım (+)",
    sign: 1,
    adjustment: true,
    hint: "Sayımda kayıttan FAZLA çıktı ya da eksik yazılmış bir giriş kapatılıyor.",
  },
  ADJUST_OUT: {
    label: "Sayım düzeltmesi — eksi (−)",
    short: "Sayım (−)",
    sign: -1,
    adjustment: true,
    hint: "Sayımda kayıttan AZ çıktı ya da yanlış yazılmış bir giriş ters kayıtla kapatılıyor.",
  },
  // Devere 1b — yalnız LEVENT yazıcısından doğar; bu ekrandan yazılmaz (YARN_KINDS dışında).
  WARP_ISSUE: { label: "Çözgü çıkışı (−)", short: "Çözgü (−)", sign: -1, adjustment: false, hint: "Levente sarılan iplik (brüt). Leventler ekranından yazılır." },
  WARP_ISSUE_REVERSAL: { label: "Çözgü çıkışı iptali (+)", short: "Çözgü iptal (+)", sign: 1, adjustment: false, hint: "Sarımın stornosu — iplik depoya döner." },
  WARP_RETURN: { label: "Levent dibi iadesi (+)", short: "Dip (+)", sign: 1, adjustment: false, hint: "Sarım bitince kalan bobin depoya döndü; sebep kodu zorunlu." },
  WARP_RETURN_REVERSAL: { label: "Dip iadesi iptali (−)", short: "Dip iptal (−)", sign: -1, adjustment: false, hint: "Dip iadesinin tersi." },
  // Fason G1 — yalnız fason sevk kaleminden doğar; bu ekrandan yazılmaz. Fasondaki bakiye türetilir (sanal depo yok).
  SUBCONTRACT_OUT: { label: "Fasona iplik çıkışı (−)", short: "Fason (−)", sign: -1, adjustment: false, hint: "Fason sevkiyle giden iplik (brüt). Fason sevk kaleminden yazılır." },
  SUBCONTRACT_OUT_CANCEL: { label: "Fasona çıkış iptali (+)", short: "Fason iptal (+)", sign: 1, adjustment: false, hint: "Fason sevkinin iptali — iplik depoya döner." },
  SUBCONTRACT_RETURN: { label: "Fasondan iplik dönüşü (+)", short: "Fason dönüş (+)", sign: 1, adjustment: false, hint: "Fasondan dönen iplik (kısmi olabilir); sebep kodu zorunlu." },
  SUBCONTRACT_RETURN_CANCEL: { label: "Fason dönüşü iptali (−)", short: "Dönüş iptal (−)", sign: -1, adjustment: false, hint: "Dönüşün tersi." },
};

/** Bu ekrandan YAZILABİLEN türler — WARP_* yalnız levent yazıcısından doğar. */
export const YARN_KINDS: YarnMovementKind[] = ["IN", "OUT", "ADJUST_IN", "ADJUST_OUT"];
/** Liste süzgecinin tanıdığı TÜM türler (backend liste şemasıyla birebir). */
export const YARN_FILTER_KINDS: YarnMovementKind[] = [...YARN_KINDS, "WARP_ISSUE", "WARP_ISSUE_REVERSAL", "WARP_RETURN", "WARP_RETURN_REVERSAL", "SUBCONTRACT_OUT", "SUBCONTRACT_OUT_CANCEL", "SUBCONTRACT_RETURN", "SUBCONTRACT_RETURN_CANCEL"];

/** Bilinmeyen tür (eski panel, yeni backend enum'u) ekranı ÇÖKERTMEZ — ham kod rozetle basılır (47 K2, 2026-09-14). */
const UNKNOWN_KIND_META: YarnKindMeta = { label: "Bilinmeyen tür", short: "?", sign: 1, adjustment: false, hint: "Panel bu hareket türünü tanımıyor — panel güncellemesi gerekir." };
export function yarnKindMeta(kind: string): YarnKindMeta {
  return YARN_KIND_META[kind as YarnMovementKind] ?? { ...UNKNOWN_KIND_META, short: kind };
}

/** Rozet tonu — sayım düzeltmesi normal giriş/çıkıştan AYRI okunmalı. */
export function kindBadgeClass(kind: YarnMovementKind): string {
  const m = yarnKindMeta(kind);
  if (m.adjustment) return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return m.sign > 0
    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    : "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100";
}

/** Ekranda bir AN — yerel saatle (defter satırının yazıldığı an). */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

/** Hareketi kimin yazdığı — ad yoksa kullanıcı adı, o da yoksa "—" (sistem). */
export function movementActor(row: YarnMovementRow): string {
  return row.user?.fullName?.trim() || row.user?.username || "—";
}

/**
 * Hareketin KAYNAĞI — elle mi girildi, bir belgeden mi doğdu.
 *
 * Mal kabul fişinden doğan satır ELLE DÜZELTİLEMEZ mantığının görünür ayağı:
 * kullanıcı "bunu ben mi yazdım" sorusunu satıra bakarak cevaplayabilmeli.
 */
export function movementSource(row: YarnMovementRow): string {
  if (row.goodsReceipt) return `Mal kabul ${row.goodsReceipt.receiptNo}`;
  if (row.goodsReceiptId) return "Mal kabul fişi";
  if (row.invoiceId) return "Fatura";
  return "Elle giriş";
}

// -----------------------------------------------------------------------------
// OKUMA (`warehouse:read`)
// -----------------------------------------------------------------------------

export async function listYarnStocks(params: {
  page: number;
  pageSize: number;
  /** UUID ya da CSV (çoklu seçim sözleşmesi). */
  itemId?: string;
  warehouseId?: string;
  /** Yalnız bakiyesi sıfır OLMAYAN satırlar. Sıfır bakiye de gerçek bir cevaptır. */
  onlyNonZero?: boolean;
  /** Kalem adı/kodu. */
  search?: string;
}): Promise<YarnStockListResponse> {
  const res = await apiClient.get("/api/yarn/stocks", {
    params: {
      page: params.page,
      pageSize: params.pageSize,
      ...(params.itemId ? { itemId: params.itemId } : {}),
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      // ⚠️ Backend `z.enum(["true","false"])` bekler — boolean `true` gönderilirse
      // query string'de "true" olur (aynı şey), ama `false` göndermek filtreyi
      // AÇMAZ; parametreyi hiç göndermemek daha dürüst.
      ...(params.onlyNonZero ? { onlyNonZero: "true" } : {}),
      ...(params.search ? { search: params.search } : {}),
    },
  });
  return res.data as YarnStockListResponse;
}

export async function listYarnMovements(params: {
  limit: number;
  cursor?: string;
  /** TEKİL UUID — bu uç CSV KABUL ETMEZ (dosya başlığı). */
  itemId?: string;
  warehouseId?: string;
  kind?: YarnMovementKind;
  goodsReceiptId?: string;
  lotId?: string;
  /** Mutlak an (ISO). Gün sınırı İSTEMCİNİNDİR — bkz. `dayStartIso`/`dayEndIso`. */
  dateFrom?: string;
  dateTo?: string;
}): Promise<YarnMovementListResponse> {
  const res = await apiClient.get("/api/yarn/movements", {
    params: {
      limit: params.limit,
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.itemId ? { itemId: params.itemId } : {}),
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.goodsReceiptId ? { goodsReceiptId: params.goodsReceiptId } : {}),
      ...(params.lotId ? { lotId: params.lotId } : {}),
      ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
      ...(params.dateTo ? { dateTo: params.dateTo } : {}),
    },
  });
  return res.data as YarnMovementListResponse;
}

// -----------------------------------------------------------------------------
// YAZMA (`yarn:write`)
// -----------------------------------------------------------------------------

export interface YarnMovementResult {
  data: { id: string; balanceKg: DecimalLike; negative: boolean };
  /** Backend'in cümlesi — yeni bakiyeyi ve gerekirse EKSİ BAKİYE uyarısını taşır. */
  message?: string;
}

/**
 * Elle hareket.
 *
 * ⚠️ `qtyKg` **STRING** gönderilir, `Number()`'a çevrilmez: çevirmek 3 haneden
 * uzun ondalıkta ve çok büyük sayılarda kullanıcının YAZDIĞI değerden farklı bir
 * rakam göndermek demektir. Backend metni kendi `Decimal`'ine çevirir ve
 * çeviremezse ne yazması gerektiğini SÖYLEYEN bir 400 döner — o mesaj ekranda
 * aynen gösterilir.
 *
 * ⚠️ Miktar HER ZAMAN POZİTİF. Eksi işaretli miktar kutusu YOK; yön `kind`tir.
 */
export async function createYarnMovement(body: {
  itemId: string;
  warehouseId: string;
  kind: YarnMovementKind;
  qtyKg: string;
  reason?: string | null;
  /** Devere Faz 2: lot etiketi (opsiyonel). */
  lotId?: string | null;
}): Promise<YarnMovementResult> {
  const res = await apiClient.post("/api/yarn/movements", body);
  return res.data as YarnMovementResult;
}

/** Backend'in cümlesi — yoksa yol gösteren bir yedek. Toast'lar kaybolur, ekran kalır. */
export function backendMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}
