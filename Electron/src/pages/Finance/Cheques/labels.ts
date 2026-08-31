// =============================================================================
// ÇEK / SENET EKRAN SÖZLÜKLERİ
// =============================================================================
// ⚠️ Sözlükler TEK YERDE: liste satırı, olay defteri ve onay diyalogları AYNI
// durumu AYNI kelimeyle söylemeli. Ayrışırlarsa aynı çek bir ekranda "Bankada",
// diğerinde "Tahsilde" görünür ve vardiya ortasındaki kullanıcı iki farklı şey
// olduğunu sanar.
//
// ⚠️ HER rozet sınıfı `dark:` varyantını DA taşır — panel tema-duyarlıdır ve
// yalnız `bg-amber-100` yazan bir satır koyu temada okunmaz olur.
//
// ⚠️ Metinler backend'in `STATUS_LABEL`/`DOCTYPE_LABEL` sözlüğüyle AYNI anlamı
// taşır (backend onları hata cümlelerinde kullanıyor: "… zaten tahsil edildi").
// Burada baş harfler büyük çünkü etiket/rozet olarak tek başına duruyorlar.
// =============================================================================
import type { ChequeDocType, ChequeEventType, ChequeKind, ChequeStatus } from "./service";

export const KIND_LABEL: Record<ChequeKind, string> = {
  RECEIVED: "Aldığımız",
  ISSUED: "Verdiğimiz",
};

export const DOCTYPE_LABEL: Record<ChequeDocType, string> = {
  CHEQUE: "Çek",
  PROMISSORY_NOTE: "Senet",
};

export const STATUS_LABEL: Record<ChequeStatus, string> = {
  PORTFOLIO: "Elimizde",
  AT_BANK: "Bankada (tahsilde)",
  ENDORSED: "Ciro edildi",
  COLLECTED: "Tahsil edildi",
  BOUNCED: "Karşılıksız",
  RETURNED: "İade edildi",
  ISSUED: "Verildi",
  PAID: "Ödendi",
  CANCELLED: "İptal",
};

/**
 * Rozet renkleri anlam taşır ve keyfi değildir:
 *   yeşil  = para geldi / iş bitti iyi (COLLECTED)
 *   mavi   = yolda, henüz para yok (AT_BANK, ENDORSED)
 *   amber  = bizde bekliyor / bizden çıkacak (PORTFOLIO, ISSUED)
 *   kırmızı= kötü sonuç (BOUNCED)
 *   gri    = kapandı, etkisi geri alındı (RETURNED, CANCELLED) · PAID nötr
 */
export const STATUS_BADGE: Record<ChequeStatus, string> = {
  PORTFOLIO: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  AT_BANK: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  ENDORSED: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  COLLECTED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  BOUNCED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  RETURNED: "bg-muted text-muted-foreground",
  ISSUED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PAID: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-200",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

/** Olay defteri satır başlıkları — "ne oldu" sorusunun cevabı. */
export const EVENT_LABEL: Record<ChequeEventType, string> = {
  RECEIVE: "Giriş — çek/senet alındı",
  ISSUE: "Çıkış — çek/senet verildi",
  DEPOSIT: "Bankaya verildi (tahsile/teminata)",
  COLLECT: "Tahsil edildi",
  COLLECT_CANCEL: "Tahsil stornosu — para hesaptan geri çekildi",
  ENDORSE: "Ciro edildi",
  BOUNCE: "Karşılıksız çıktı",
  RETURN: "Sahibine iade edildi",
  PAY: "Ödendi",
  CANCEL: "İptal edildi (storno)",
};

/** Olay noktasının rengi — zaman çizelgesinde göz taraması için. */
export const EVENT_DOT: Record<ChequeEventType, string> = {
  RECEIVE: "bg-amber-500",
  ISSUE: "bg-amber-500",
  DEPOSIT: "bg-sky-500",
  COLLECT: "bg-emerald-500",
  // Storno ailesi gri: "etkisi geri alındı" (CANCEL/RETURN ile aynı anlam kovası).
  COLLECT_CANCEL: "bg-muted-foreground",
  ENDORSE: "bg-violet-500",
  BOUNCE: "bg-red-500",
  RETURN: "bg-muted-foreground",
  PAY: "bg-emerald-500",
  CANCEL: "bg-muted-foreground",
};

/** Cari tarafın görünen adı — `../service.partyName`'in null-güvenli ikizi. */
export function cariName(c: { customer: { name: string } | null; subcontractor: { name: string } | null } | null): string {
  if (!c) return "—";
  return c.customer?.name ?? c.subcontractor?.name ?? "—";
}
