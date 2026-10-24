// =============================================================================
// BASIM HATA KODLARI — panelin yazdırma geçmişine bildirdiği TEK katalog (izlenebilirlik A2)
// =============================================================================
// Ham hata metni (yol, IP, sürücü iletisi) satıra gitmez: sınıflı kod + kısa Türkçe mesaj gider.
// Yazdırma geçmişi sayfası (A3) ipucu metnini bu koddan seçer — yeni kod buraya eklenir.
// =============================================================================

import type { DocPrintErrorCode } from "@shared/doc-print";

export const PRINT_ERROR_MESSAGES = {
  // Belge (işletim sistemi yazıcısı)
  SURUCU_YOK: "Bu bilgisayarda kurulu yazıcı bulunamadı.",
  YAZICI_BULUNAMADI: "Seçili yazıcı bu bilgisayarda bulunamadı.",
  BELGE_COK_BUYUK: "Belge yazdırma için çok büyük.",
  PDF_OLUSTURULAMADI: "PDF oluşturulamadı ya da kaydedilemedi.",
  // Etiket (doğrudan gönderim)
  YAZICI_YAPILANDIRILMADI: "Bu bilgisayara etiket yazıcısı seçilmemiş.",
  YAZICI_DILI_YOK: "Yazıcı dili çözülemedi (Cihaz Kaydı yazıcısı seçilmemiş).",
  YAZICI_BAGLANTI_REDDI: "Yazıcı bağlantıyı reddetti (kapalı ya da port yanlış).",
  AG_ULASILAMAZ: "Yazıcıya ağdan ulaşılamıyor.",
  ZAMAN_ASIMI: "Yazıcı zamanında cevap vermedi.",
  SERIPORT_YOK: "Seri port açılamadı ya da bulunamadı.",
  SERI_SURUCU_YOK: "Seri sürücü bu derlemede hazır değil.",
  CUPS_HATA: "Yazdırma kuyruğu (CUPS) işi reddetti.",
  WINSPOOL_HATA: "Windows yazdırma kuyruğu işi reddetti.",
  ICERIK_ALINAMADI: "Etiket içeriği sunucudan alınamadı.",
  GONDERIM_HATASI: "Yazıcıya gönderilemedi.",
  BILINMEYEN: "Yazdırılamadı (bilinmeyen hata).",
} as const;

export type PrintErrorCode = keyof typeof PRINT_ERROR_MESSAGES;

// Ana süreç kodları bu kataloğun alt kümesidir — derleyici ölçer.
type DocCodesCovered = DocPrintErrorCode extends PrintErrorCode ? true : never;
export const DOC_PRINT_CODES_COVERED: DocCodesCovered = true;

export type LabelTransport = "serial" | "tcp" | "cups" | "winspool";

/**
 * Etiket gönderim hatası → kod. Ham metin yalnız sınıflamaya girer; satıra kodun Türkçe
 * mesajı gider (COM yolu / IP / kuyruk adı ayrıca `printerAddress` alanında durur).
 */
export function classifyLabelError(raw: string | null | undefined, transport: LabelTransport | undefined): PrintErrorCode {
  const m = (raw ?? "").toLowerCase();
  if (m.includes("econnrefused") || m.includes("reddet")) return "YAZICI_BAGLANTI_REDDI";
  if (m.includes("etimedout") || m.includes("timeout") || m.includes("zaman aşımı")) return "ZAMAN_ASIMI";
  if (m.includes("ehostunreach") || m.includes("enetunreach") || m.includes("enotfound") || m.includes("eai_again")) return "AG_ULASILAMAZ";
  if (transport === "serial") return m.includes("sürücü") ? "SERI_SURUCU_YOK" : "SERIPORT_YOK";
  if (transport === "cups") return "CUPS_HATA";
  if (transport === "winspool") return "WINSPOOL_HATA";
  return "GONDERIM_HATASI";
}

export function printErrorMessage(code: PrintErrorCode): string {
  return PRINT_ERROR_MESSAGES[code];
}
