// =============================================================================
// SEVKİYATTAN FATURA TASLAĞI — SATIR DÖNÜŞÜMÜ (C1 panel yarısı)
// =============================================================================
// ⭐ SATIRLARI ARTIK BACKEND KURUYOR (`GET /api/finance/shipments/:id/
//    invoice-draft-lines`). Panel eskiden sevk fişi raporundan (`products`)
//    kendi satırlarını kuruyordu ve FİYATI HİÇ ÇÖZMÜYORDU (hepsi 0): aynı
//    sevkiyat için otomatik kanca ile elle taslak İKİ FARKLI belge üretiyordu —
//    biri sözleşme/kart fiyatlı, diğeri sıfır fiyatlı. Tek kurucu, tek sonuç.
//
// ⚠️ DECIMAL JSON'DA **STRING** GELİR ("500", "42.50"). Bu dosyanın asıl işi bu:
// formun satır alanları `number` tipli ve string bir `qty` React tarafında hata
// VERMEZ — `qty * unitPrice` sayıya zorlanır, ama `toLocaleString(...)`
// seçenekleri SESSİZCE yok sayılır ve tutar/miktar biçimi bozulur (projede adı
// konmuş tuzak: `service.toNum()` başlığı). Dönüşüm TEK yerde yapılır.
//
// ⚠️ FİYAT UYDURULMAZ, ÇELİŞKİ SÖYLENİR: aynı ürüne farklı sipariş fiyatları
// düşerse backend ortalama ALMAZ, D2 zincirine (müşteri istisnası > kart) düşer
// ve `orderConflicts` sayacını doldurur. Panel o sayacı AMBER bir notla basar —
// sessiz yanlış fiyat, boş fiyattan kötüdür ve muhasebeci taslağı onaylamadan
// önce kontrol etmesi gerektiğini başka hiçbir yerden öğrenemez.
//
// Bekçi: `invoiceDraftLines.test.ts`.
// =============================================================================
import type { Currency } from "@/pages/Finance/service";

/** Backend `ShipmentDraftLine` — Decimal alanlar string DE gelebilir. */
export interface ShipmentDraftLineDto {
  itemId: string;
  description: string;
  qty: number | string;
  unit: string;
  unitPrice: number | string;
  vatRate: number;
}

export interface ShipmentDraftLinesDto {
  lines: ShipmentDraftLineDto[];
  /** Sipariş (sözleşme) fiyatıyla dolan satır sayısı. */
  orderPriced: number;
  /** Çelişkili sipariş fiyatı yüzünden kart fiyatına düşen satır sayısı. */
  orderConflicts: number;
  /** Cari kartının ön-dolum tercihi (yoksa TRY) — form onunla açılır. */
  currency: Currency;
}

/** Fatura formunun beklediği ön-dolum satırı (`InvoicePrefill["lines"][number]`). */
export interface DraftPrefillLine {
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

/** Geçersiz değerde 0 — `NaN` bir tutar alanına yazılırsa form sessizce ölür. */
function num(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Uç yanıtı → form ön-dolumu.
 *
 * ⚠️ `itemId` TAŞINIR: fiyat önerisi ve açıklama ön-dolumu ona bağlı. Düşürmek,
 * kullanıcı fiyatı silip yeniden istediğinde öneriyi ölü bırakırdı.
 */
export function toPrefillLines(dto: ShipmentDraftLinesDto | null | undefined): DraftPrefillLine[] {
  return (dto?.lines ?? []).map((l) => ({
    itemId: l.itemId || null,
    description: l.description,
    qty: num(l.qty),
    unit: l.unit || "m",
    unitPrice: num(l.unitPrice),
  }));
}

export interface DraftPriceNotice {
  tone: "warn" | "info";
  message: string;
}

/**
 * Fiyat kaynağının ekrandaki cümlesi. `null` = basma.
 *
 * ⚠️ ÇELİŞKİ ÖNCE: iki durum aynı anda doğru olabilir (bazı satırlar sipariş
 * fiyatıyla doldu, bazıları çelişkiliydi). Bilgi notunu üste koymak, kontrol
 * gerektiren tek cümleyi bir övgünün altına gömerdi.
 */
export function draftPriceNotice(dto: ShipmentDraftLinesDto | null | undefined): DraftPriceNotice | null {
  if (!dto) return null;
  if (dto.orderConflicts > 0) {
    return {
      tone: "warn",
      message:
        `${dto.orderConflicts} kalemde sipariş fiyatı çelişkili (aynı ürüne farklı fiyatlı sipariş ` +
        `kalemleri düşüyor) — o satırlar KART fiyatıyla dolduruldu. Onaylamadan önce birim ` +
        `fiyatları kontrol edin.`,
    };
  }
  if (dto.orderPriced > 0) {
    return {
      tone: "info",
      message: `${dto.orderPriced} kalemin fiyatı bağlı SİPARİŞTEN (sözleşme fiyatı) geldi.`,
    };
  }
  return null;
}
