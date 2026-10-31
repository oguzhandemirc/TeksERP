// Sipariş + cari sözlüğü: fabrika projeksiyonlarındaki ham enum → Türkçe etiket (+ durum tonu).
// Kaynak enum'lar (Teks-Erp/prisma/schema.prisma): OrderStatus {PENDING, APPROVED, PARTIAL_SHIPPED, COMPLETED, CANCELLED} ·
// ShipmentDestination {DOMESTIC, EXPORT} (`siparis.yon`) · ItemUnit {MT, KG, ADET} (`siparis-kalemi.birim`) ·
// CariKind {CUSTOMER, SUBCONTRACTOR} (`cari-hesap.tur`). Etiketler panelin `orderStatusLabels`ıyla aynı; bilinmeyen değer ham döner.
import type { StatusEntry } from "./ortak";

export type OrderStatus = "PENDING" | "APPROVED" | "PARTIAL_SHIPPED" | "COMPLETED" | "CANCELLED";

export const ORDER_STATUS: Readonly<Record<OrderStatus, StatusEntry>> = {
  PENDING: { label: "Beklemede", tone: "uyari" },
  APPROVED: { label: "Onaylandı", tone: "bilgi" },
  PARTIAL_SHIPPED: { label: "Kısmi sevk", tone: "bilgi" },
  COMPLETED: { label: "Tamamlandı", tone: "iyi" },
  CANCELLED: { label: "İptal", tone: "bilgi" },
};

/** Liste süzgecinin sırası (sunucu `durum` parametresi tam eşitlikle süzer). */
export const ORDER_STATUS_ORDER: readonly OrderStatus[] = ["PENDING", "APPROVED", "PARTIAL_SHIPPED", "COMPLETED", "CANCELLED"];

/** Fabrikanın "gecikmiş" saydığı açık durumlar (`derived.ts` OPEN_ORDER_STATUSES ile aynı küme). */
const OPEN: ReadonlySet<string> = new Set<OrderStatus>(["PENDING", "APPROVED", "PARTIAL_SHIPPED"]);

export const DESTINATION: Readonly<Record<string, string>> = { DOMESTIC: "Yurt içi", EXPORT: "İhracat" };
export const UNIT: Readonly<Record<string, string>> = { MT: "m", KG: "kg", ADET: "adet" };
export const CARI_KIND: Readonly<Record<string, string>> = { CUSTOMER: "Müşteri hesabı", SUBCONTRACTOR: "Fason hesabı" };

/** Bilinmeyen durum ham etiketle "bilgi" tonunda döner (ekranda yine görünür; bekçi eksiği yakalar). */
export function orderStatus(value: unknown): StatusEntry {
  if (typeof value !== "string") return { label: "—", tone: "bilgi" };
  return (ORDER_STATUS as Readonly<Record<string, StatusEntry | undefined>>)[value] ?? { label: value, tone: "bilgi" };
}

export function isOpenOrder(value: unknown): boolean {
  return typeof value === "string" && OPEN.has(value);
}

function dictLabel(dict: Readonly<Record<string, string>>, value: unknown): string {
  if (typeof value !== "string" || value === "") return "—";
  return dict[value] ?? value;
}

export const destinationLabel = (v: unknown): string => dictLabel(DESTINATION, v);
export const unitLabel = (v: unknown): string => dictLabel(UNIT, v);
export const cariKindLabel = (v: unknown): string => dictLabel(CARI_KIND, v);

/**
 * Termin rozeti — YALNIZ fabrikanın `gecikmis` alanından (uygulama tarih karşılaştırmaz):
 * gecikmiş → kritik "Gecikti"; açık + terminli + gecikmemiş → iyi "Zamanında"; kapanmış ya da terminsiz → yok.
 */
export function deadlineBadge(kayit: Readonly<Record<string, unknown>>): StatusEntry | null {
  if (kayit.gecikmis === true) return { label: "Gecikti", tone: "kritik" };
  if (kayit.gecikmis === false && isOpenOrder(kayit.durum) && typeof kayit.termin === "string" && kayit.termin !== "") return { label: "Zamanında", tone: "iyi" };
  return null;
}

/** Cari rolleri (kimlik ayrı, rol bayrak): `cari-kart` satırının rol bayraklarından etiketler. */
export const CARI_ROLES = [
  { key: "musteriRolu", label: "Müşteri" },
  { key: "tedarikciRolu", label: "Tedarikçi" },
  { key: "fasonRolu", label: "Fason" },
] as const;

export type CariRoleKey = (typeof CARI_ROLES)[number]["key"];

export function cariRoles(kayit: Readonly<Record<string, unknown>>): (typeof CARI_ROLES)[number][] {
  return CARI_ROLES.filter((r) => kayit[r.key] === true);
}

/** Cari hareket kaynağı (`cari-hareket.kaynak` ← CariTxnSource); etiketler panelin audit sözlüğüyle aynı. */
export const CARI_TXN_SOURCE: Readonly<Record<string, string>> = {
  INVOICE: "Fatura",
  INVOICE_CANCEL: "Fatura iptali",
  PAYMENT: "Tahsilat / Ödeme",
  PAYMENT_CANCEL: "Tahsilat / Ödeme iptali",
  ADJUSTMENT: "Düzeltme kaydı",
  ADJUSTMENT_CANCEL: "Düzeltme iptali",
  CHEQUE_RECEIVE: "Çek/senet alındı",
  CHEQUE_ISSUE: "Çek/senet verildi",
  CHEQUE_ENDORSE: "Çek/senet cirosu",
  CHEQUE_BOUNCE: "Çek/senet karşılıksız",
  CHEQUE_CANCEL: "Çek/senet iptali",
  CHEQUE_ENDORSE_CANCEL: "Çek/senet ciro stornosu",
  CHEQUE_BOUNCE_CANCEL: "Çek/senet karşılıksız stornosu",
  CHEQUE_RETURN_CANCEL: "Çek/senet iade stornosu",
  CARI_TRANSFER: "Cari virman",
  CARI_TRANSFER_CANCEL: "Cari virman stornosu",
};

export const cariTxnSourceLabel = (v: unknown): string => dictLabel(CARI_TXN_SOURCE, v);
