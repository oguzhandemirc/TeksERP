// Emanet çıkış metinleri (saf): sunucu hata kodu → Türkçe neden, tel sayısı → görüntü. Kod kullanıcıya basılmaz.
import type { ConsignmentDispatchErrorCode, ConsignmentItemKind } from "./types";
import { qtyFormatter } from "@/lib/format";

const REASON: Record<ConsignmentDispatchErrorCode, string> = {
  CONSIGNMENT_ITEMS_EMPTY: "Belgede kalem yok",
  CONSIGNMENT_OWNER_MISMATCH: "Sahibi bu müşteri değil",
  CONSIGNMENT_BEAM_NOT_READY: "Levent hazır (boşta) değil",
  CONSIGNMENT_YARN_INSUFFICIENT: "Lotun bu depodaki bakiyesi yetmiyor",
  YARN_LOT_INACTIVE: "Lot pasif — pasif lottan çıkış yapılamaz",
  CONSIGNMENT_DISPATCH_CANCELLED: "Belge zaten iptal",
  CONSIGNMENT_DISPATCH_CHANGED: "Belge önizlemeden sonra değişti — yeniden açın",
  CONSIGNMENT_BEAM_MOVED_AFTER: "Levent çıkıştan sonra başka işlem görmüş",
  CONSIGNMENT_BEAM_INVOICED: "Leventin sarım işi taslak olmayan faturada — önce faturayı iptal edin",
  CLIENT_TOKEN_COLLISION: "Aynı deneme farklı içerikle gönderildi — formu yeniden açın",
};

/** Tanınmayan kod (yeni sunucu) ham basılmaz; genel cümleye düşer. */
export function blockedReasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  return (REASON as Record<string, string>)[code] ?? "Bu kalem çıkışa uygun değil";
}

export const KIND_LABEL: Record<ConsignmentItemKind, string> = { WARP_BEAM: "Levent", YARN: "İplik" };

const NUM = qtyFormatter(2);

/** Telde string gelen sayı → "1.234,5". Sayı değilse olduğu gibi (sessiz 0 yok). */
export function fmtNum(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? NUM.format(n) : String(v);
}

export const fmtQty = (v: string | null | undefined, unit: "METER" | "KG"): string =>
  v == null ? "—" : `${fmtNum(v)} ${unit === "METER" ? "m" : "kg"}`;

/** Kullanıcının yazdığı kg → tel string'i ("12,5" → "12.5"); geçersiz/≤0 ise null. */
export function parseKg(raw: string): string | null {
  const s = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return Number(s) > 0 ? s : null;
}

const INVOICE_STATUS: Record<string, string> = { DRAFT: "Taslak", CONFIRMED: "Onaylı", CANCELLED: "İptal" };
export const invoiceStatusText = (s: string): string => INVOICE_STATUS[s] ?? "Bilinmeyen durum";
