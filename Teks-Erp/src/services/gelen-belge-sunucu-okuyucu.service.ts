// =============================================================================
// GELEN BELGE — "sunucu okuyucusu kullanılabilir mi" TEK BOĞAZI (adres `lib/gelen-belge/url.ts` + ayar
// `gelenBelge.serverOcrEnabled`, panel adı "Bilgisayarda ikinci okuma"). OCR/dönüştürme isteği atan her yer adresi
// BURADAN alır; `getReaderUrl` bu dosya dışında okunmaz (bekçi `test_gelen_belge_sunucu_okuma_ayari` §0).
// Ayar önbelleksiz her soruda DB'den okunur: kapatınca bir sonraki istek/tur okuma servisine gitmez.
// =============================================================================
import { AppError } from "../utils/app-error";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { getReaderUrl, type ReaderUrlSource } from "../lib/gelen-belge/url";
import { readServerOcrEnabled } from "./system-setting.service";

export interface ServerReaderState {
  /** OCR/dönüştürme için kullanılacak köken; adres yok/geçersiz ya da ayar kapalıyken null. */
  readonly url: string | null;
  /** Adresin kendi durumu (ayardan bağımsız; durum ucu "kurulu değil/geçersiz" ayrımı için). */
  readonly source: ReaderUrlSource;
  /** Panel ayarı "Bilgisayarda ikinci okuma" (varsayılan açık). */
  readonly enabled: boolean;
}

/** Adres + ayar tek cevapta. Kapalıyken `url` null — çağıran ayrımı `enabled`dan yapar. */
export async function serverReaderState(): Promise<ServerReaderState> {
  const u = getReaderUrl();
  const enabled = await readServerOcrEnabled();
  return { url: enabled ? u.url : null, source: u.source, enabled };
}

/** OCR/dönüştürme isteği için adres; adres yok ya da ayar kapalı → null (HİÇBİR istek atılmaz). */
export async function serverReaderUrl(): Promise<string | null> {
  return (await serverReaderState()).url;
}

/**
 * OCR OLMAYAN servis işleri (sağlık yoklaması, K28 fotoğraf küçültme) için yalnız adres — ayara bağlı değil:
 * "ikinci okuma kapalı" fotoğraf saklama kipini ve servis durum rozetini değiştirmez.
 */
export function readerServiceAddress(): { url: string | null; source: ReaderUrlSource } {
  return getReaderUrl();
}

/** Ayar kapalıyken okuma isteyen uçların hatası (409; tablet/panel mesajı gösterir, istemci yerel yola düşer). */
export function serverOcrDisabledError(hint = "Fotoğrafı yeniden çekin ya da bilgileri elle girin."): AppError {
  return AppError.conflict(`Bilgisayarda ikinci okuma kapalı (${settingScreenPath("gelen-belge")}); belgeyi yalnız tablet/telefon okur. ${hint}`, { code: "SERVER_OCR_DISABLED" });
}
