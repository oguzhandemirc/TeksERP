// =============================================================================
// MAL KABUL SATIR HATALARI — saf katman (C8, 2026-09-17): submit ÖNCESİ yerel doğrulama + sunucu 400'ünün satıra bağlanması
// =============================================================================
// Bulgu: lot zorunluyken lotsuz iplik satırı sunucuda düşüyor, fiş başlığı doğuyor, modal kapanıyordu (içi boş fiş).
// İki hat: ① panel bayrağı biliyorsa (`useDevereLotRequired`) sunucuya GİTMEDEN satırı işaretler ve "Fişi Oluştur"u kapatır;
// ② bayrak yüklenmemişse (hook varsayılanı KAPALI) sunucunun 400 `RECEIPT_LINES_INVALID` `details.lines[{lineNo}]`i
// AYNI satıra bağlanır — modal kapanmaz, toast yok. `lineNo` sunucunun gördüğü GENİŞLETİLMİŞ satır sırasıdır (adet N →
// N satır), bu yüzden anahtar eşlemesi `expandLines` ile aynı süzgeç/çoğaltma kuralını izler (`expandLineKeys`).
// =============================================================================
import type { DraftLine } from "./ReceiptLineRows";

export const LOT_REQUIRED_TEXT = "Lot zorunlu (Devere ayarı)";
export const RECEIPT_LINES_INVALID = "RECEIPT_LINES_INVALID";

/** `expandLines` ile AYNI sırada: gönderilen her satırın taslak anahtarı (adet kadar tekrar). */
export function expandLineKeys(lines: DraftLine[]): string[] {
  return lines.filter((l) => l.itemId && l.initialQty > 0 && l.count > 0).flatMap((l) => Array.from({ length: l.count }, () => l.key));
}

/** Yerel doğrulama: lot zorunluyken lotsuz İPLİK satırı. Bayrak kapalı/yüklenmemişse boş (sunucu son sözü söyler). */
export function localLineIssues(lines: DraftLine[], yarnItemIds: ReadonlySet<string>, lotRequired: boolean): Map<string, string> {
  const out = new Map<string, string>();
  if (!lotRequired) return out;
  for (const l of lines) {
    if (l.itemId && yarnItemIds.has(l.itemId) && l.initialQty > 0 && !(l.lotNo ?? "").trim()) out.set(l.key, LOT_REQUIRED_TEXT);
  }
  return out;
}

export interface ServerLineIssue { lineNo: number; code: string; message: string }

/** Sunucu 400 gövdesi → satır anahtarı → mesaj. Tanınmayan `lineNo` (eşleşmez) atlanır. */
export function serverLineIssues(issues: ServerLineIssue[], keys: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of issues) {
    const key = keys[i.lineNo - 1];
    if (key && !out.has(key)) out.set(key, i.message);
  }
  return out;
}

/** Axios hata gövdesinden `RECEIPT_LINES_INVALID` satır listesi; başka hata → null (mevcut toast yolu). */
export function receiptLinesInvalidFrom(error: unknown): ServerLineIssue[] | null {
  const body = (error as { response?: { data?: { details?: { code?: string; lines?: ServerLineIssue[] } } } })?.response?.data;
  if (body?.details?.code !== RECEIPT_LINES_INVALID) return null;
  return Array.isArray(body.details.lines) ? body.details.lines : [];
}
