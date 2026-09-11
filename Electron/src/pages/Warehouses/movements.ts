// =============================================================================
// DEPO HAREKET DÖKÜMÜ — saf katman (etiket · yön · kaynak · sorgu)
// =============================================================================
// NEDEN AYRI DOSYA: buradaki kuralların hiçbiri "görünüm" değil, hepsi ANLAM.
// Bileşen içinde birer `if` olarak yaşasalardı tersine çevrilmeleri hiçbir testi
// kırmazdı (projenin yazılı deseni: `yarn-regime.ts`, `qty.ts`, `cashTxnRules.ts`).
// Bekçi: `movements.test.ts`.
//
// ⚠️ YÖN SUNUCUDAN GELİR (`row.direction`), BURADA TÜRETİLMEZ. "Giren mi çıkan
// mı" sorusunun cevabı BAKAN DEPOYA görelidir: aynı TRANSFER satırı kaynak depo
// için ÇIKAN, hedef depo için GİRENdir. Panel bunu `eventType`ten türetmeye
// kalksaydı (ENTRY=giren, SHIPMENT=çıkan…) transfer satırı iki depoda da aynı
// yöne basılırdı — rakam doğru, cümle yalan. Backend zaten `warehouseId`
// parametresine göre çözüyor; ikinci bir kural ikinci bir kaynak demekti.
//
// ⚠️ RENK TEK BAŞINA BİLGİ TAŞIMAZ (renk körlüğü + depoda hızlı bakış): işaret
// her zaman metin olarak da basılır ("+" / "−") ve yön sütunu kelimeyle yazılır.
// =============================================================================
import { formatNumber } from "@/lib/format";

/** Backend `WarehouseEventType` enum'unun aynası (Electron backend'i import edemez). */
export type WarehouseEventType =
  | "ENTRY"
  | "TRANSFER"
  | "TRANSFER_REVERSAL"
  | "SHIPMENT"
  | "SHIPMENT_REVERSAL"
  | "RETURN"
  | "CANCEL"
  | "CANCEL_REVERSAL";

/** Satırın, BAKAN DEPOYA göre yönü. Depo süzgeci yoksa `null` (yön yok). */
export type MovementDirection = "IN" | "OUT" | null;

export type DecimalLike = number | string;

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
}

export interface WarehouseMovementRow {
  id: string;
  eventType: WarehouseEventType;
  direction: MovementDirection;
  /** HER ZAMAN POZİTİF — yönü `direction` söyler (backend sözleşmesi). */
  qty: DecimalLike;
  notes: string | null;
  createdAt: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromWarehouse: WarehouseRef | null;
  toWarehouse: WarehouseRef | null;
  roll: {
    id: string;
    barcode: string | null;
    width: DecimalLike | null;
    item: { id: string; name: string } | null;
    color: { id: string; name: string } | null;
  } | null;
  sack: { id: string; sackNo: string } | null;
  transfer: { id: string; transferNo: string } | null;
  goodsReceipt: { id: string; receiptNo: string } | null;
  shipment: { id: string; shipmentNo: string } | null;
  rollReturn: { id: string } | null;
  stockCount: { id: string; countNo: string } | null;
  user: { id: string; fullName: string | null; username: string } | null;
}

export interface WarehouseMovementListResponse {
  data: WarehouseMovementRow[];
  /** Cursor'lu döküm: defter append-only ve yıllarca büyür (offset yok). */
  nextCursor: string | null;
}

// -----------------------------------------------------------------------------
// OLAY TÜRÜ SÖZLÜĞÜ
// -----------------------------------------------------------------------------
// ⚠️ `hint` "hangi olay bu" sorusunu cevaplar ve gerçekten gerekiyor: ENTRY tek
// bir kapı değildir (mal kabul · KK1 ham girişi · Tambur · fason dönüşü) ve
// CANCEL "kayıt hatalıydı" ile "fire" olaylarının İKİSİNİ birden taşır. Rozete
// tek kelime basıp gerisini operatörün tahminine bırakmak, defteri yanlış
// okutmanın en kolay yolu.

export interface EventMeta {
  label: string;
  hint: string;
  /** Defter tarafında TERS (storno/iptal) olay mı — ayrı tonda okunmalı. */
  reversal: boolean;
}

export const WAREHOUSE_EVENT_META: Record<WarehouseEventType, EventMeta> = {
  ENTRY: {
    label: "Giriş",
    hint: "Mal depoya dışarıdan girdi (mal kabul, ham giriş, Tambur çıkışı, fason dönüşü).",
    reversal: false,
  },
  TRANSFER: {
    label: "Transfer",
    hint: "Depolar arası taşıma — kaynak depoda çıkan, hedef depoda giren olarak görünür.",
    reversal: false,
  },
  TRANSFER_REVERSAL: {
    label: "Transfer iptali",
    hint: "Transferin ters kaydı — mal geldiği depoya döndü.",
    reversal: true,
  },
  SHIPMENT: { label: "Sevk", hint: "Müşteriye sevk edildi — depodan çıktı.", reversal: false },
  SHIPMENT_REVERSAL: {
    label: "Sevk stornosu",
    hint: "Sevk geri alındı (mal hiç çıkmamıştı) — depoya döndü.",
    reversal: true,
  },
  RETURN: { label: "Müşteri iadesi", hint: "Müşteriden iade geldi — depoya girdi.", reversal: false },
  CANCEL: {
    label: "İptal / fire",
    hint: "Top iptal edildi ya da fireye ayrıldı — depodan düştü.",
    reversal: false,
  },
  CANCEL_REVERSAL: {
    label: "İptal stornosu",
    hint: "Kayıttan düşme geri alındı (sayım stornosu) — top depoya döndü.",
    reversal: true,
  },
};

export const WAREHOUSE_EVENT_TYPES: WarehouseEventType[] = [
  "ENTRY",
  "TRANSFER",
  "TRANSFER_REVERSAL",
  "SHIPMENT",
  "SHIPMENT_REVERSAL",
  "RETURN",
  "CANCEL",
  "CANCEL_REVERSAL",
];

/** Olay rozetinin tonu — ters (storno) olaylar ayrı okunmalı. */
export function eventBadgeClass(kind: WarehouseEventType): string {
  if (WAREHOUSE_EVENT_META[kind]?.reversal) {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
  return "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100";
}

// -----------------------------------------------------------------------------
// YÖN
// -----------------------------------------------------------------------------

export interface DirectionMeta {
  /** Sütunda basılan kelime — renkten BAĞIMSIZ okunabilmeli. */
  label: string;
  /** Miktarın önüne basılan işaret. */
  sign: "+" | "−" | "";
  className: string;
}

export const DIRECTION_META: Record<"IN" | "OUT" | "NONE", DirectionMeta> = {
  IN: { label: "Giren", sign: "+", className: "text-emerald-700 dark:text-emerald-400" },
  OUT: { label: "Çıkan", sign: "−", className: "text-slate-700 dark:text-slate-300" },
  // ⚠️ "—" bir SIFIR değil, bir BİLİNMEZ: depo süzgeci yokken satırın yönü
  // gerçekten yoktur. "+" basmak uydurma olurdu.
  NONE: { label: "—", sign: "", className: "text-muted-foreground" },
};

export function directionMeta(direction: MovementDirection): DirectionMeta {
  return DIRECTION_META[direction ?? "NONE"];
}

/** Miktar + yön işareti — işaret YALNIZ `direction`tan gelir, `eventType`ten DEĞİL. */
export function signedQty(row: Pick<WarehouseMovementRow, "direction" | "qty">): string {
  const meta = directionMeta(row.direction);
  return `${meta.sign}${formatNumber(row.qty, 2)} m`;
}

/**
 * KARŞI TARAF — satırın "öbür ucu".
 *
 * ⚠️ Depo dışına/dışından olan hareketlerde karşı taraf UYDURULMAZ: ENTRY'nin
 * kaynağı, SHIPMENT'ın hedefi ve CANCEL'ın hedefi defterde YOKTUR (sırasıyla
 * dışarısı · müşteri · stoktan düşüş). Oraya bir depo adı yazmak defterin
 * söylemediği bir şeyi söylemek olurdu; olayın kendisi zaten rozette yazıyor.
 */
export function counterpartName(row: WarehouseMovementRow): string {
  if (row.direction === "IN") return row.fromWarehouse?.name ?? "—";
  if (row.direction === "OUT") return row.toWarehouse?.name ?? "—";
  // Depo süzgeci yokken iki uç da anlamlıdır → ikisi birden gösterilir.
  const from = row.fromWarehouse?.name ?? "—";
  const to = row.toWarehouse?.name ?? "—";
  return `${from} → ${to}`;
}

/**
 * BELGE BAĞI — hareketi doğuran kayıt.
 *
 * ⚠️ Belgesiz hareket MEŞRUDUR ve "—" ile gösterilir: KK1 ham girişi, Tambur
 * çıkışı ve top iptali bir belgeden doğmaz (`warehouse-ledger.helper` sözleşmesi:
 * typed FK'ler yalnız TRANSFER/mal kabul/sevk/iade olaylarında dolar). Boşluğu
 * "Elle giriş" gibi bir cümleyle doldurmak, olmayan bir bilgiyi iddia etmek olur.
 */
export function movementSource(row: WarehouseMovementRow): string {
  if (row.transfer) return `Transfer ${row.transfer.transferNo}`;
  if (row.goodsReceipt) return `Mal kabul ${row.goodsReceipt.receiptNo}`;
  if (row.shipment) return `Sevk ${row.shipment.shipmentNo}`;
  if (row.rollReturn) return "İade kaydı";
  if (row.stockCount) return `Sayım ${row.stockCount.countNo}`;
  return "—";
}

/** Hareketi kimin yazdığı — ad yoksa kullanıcı adı, o da yoksa "—" (sistem). */
export function movementActor(row: WarehouseMovementRow): string {
  return row.user?.fullName?.trim() || row.user?.username || "—";
}

/**
 * TOP ETİKETİ.
 *
 * ⚠️ Barkodsuz top GERÇEKTİR (açık kumaş / fason dönüşü barkodsuz doğar) ve
 * satır boş bırakılamaz — boş hücre "veri kayıp" diye okunur.
 */
export function rollLabel(row: WarehouseMovementRow): string {
  const code = row.roll?.barcode?.trim() || "(barkodsuz)";
  const item = row.roll?.item?.name?.trim();
  const color = row.roll?.color?.name?.trim();
  return [code, item, color].filter(Boolean).join(" · ");
}

/** Ekranda bir AN — yerel saatle (defter satırının yazıldığı an). */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

// -----------------------------------------------------------------------------
// KIRPMA SESSİZ DEĞİL
// -----------------------------------------------------------------------------
// ⚠️ Döküm CURSOR'LUDUR: ekranda görünen, defterin TAMAMI değil bir DİLİMİDİR.
// Sayfa sonunu sessiz bırakmak, "bu depoya başka bir şey girmemiş" sonucuna
// götürür — ve o sonuç sayım kararını değiştirir. Bu yüzden altbilgi HER ZAMAN
// listenin bitip bitmediğini SÖYLER; "N kayıt" tek başına yeterli değildir.

export function pageFooterText(shown: number, hasMore: boolean): string {
  if (shown === 0) return "";
  const head = `${shown} hareket gösteriliyor (en yeniden eskiye).`;
  return hasMore
    ? `${head} Liste KIRPILDI — devamı için “Daha fazla yükle”.`
    : `${head} Bu filtrede başka hareket yok.`;
}

// -----------------------------------------------------------------------------
// SORGU
// -----------------------------------------------------------------------------

export interface MovementFilter {
  eventType: WarehouseEventType | "";
  /** `<input type="date">` değeri (YYYY-MM-DD) — boş olabilir. */
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_MOVEMENT_FILTER: MovementFilter = { eventType: "", dateFrom: "", dateTo: "" };

export function isFiltered(f: MovementFilter): boolean {
  return Boolean(f.eventType || f.dateFrom || f.dateTo);
}
