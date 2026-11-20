// Destek — saf metin ve hata eşlemesi (bulut sözleşmesi §4–§5). Karar `details.code` ile verilir (`ApiError.code`
// zaten oradan okunur); 4xx'te bulutun `message`ı gösterilebilir Türkçedir. Burada yalnız istemcinin KENDİ cümlesini
// kurması gereken durumlar eşlenir (ağ · merkez erişilemez · 429 · 413 · yeniden açma süresi).
// Örnek: saha uygulaması `mobil/src/screens/Destek/destekMetin.ts` (elle kopya; paketler birbirini içe aktarmaz).
import { ApiError } from "../api/client";
import type { DestekDurum, DestekEk, DestekTur } from "../api/destek-wire";

export const AYDINLATMA = "Destek talepleri Etkili Yazılım destek sisteminde işlenir.";

export const TUR_ETIKET: Readonly<Record<DestekTur, string>> = { BUG: "Hata", QUESTION: "Soru", REQUEST: "İstek" };
export const TUR_SIRASI: readonly DestekTur[] = ["BUG", "QUESTION", "REQUEST"];

export const DURUM_ETIKET: Readonly<Record<DestekDurum, string>> = {
  NEW: "Yeni",
  IN_PROGRESS: "İnceleniyor",
  WAITING_CUSTOMER: "Sizden bilgi bekleniyor",
  ANSWERED: "Yanıtlandı",
  CLOSED: "Kapandı",
};

export type DestekDurumTonu = "info" | "warning" | "success" | "soft";
export const DURUM_TONU: Readonly<Record<DestekDurum, DestekDurumTonu>> = {
  NEW: "info",
  IN_PROGRESS: "info",
  WAITING_CUSTOMER: "warning",
  ANSWERED: "success",
  CLOSED: "soft",
};

/** Merkez yeni durum eklerse ham değer gösterilir — çökme yok. */
export function durumEtiketi(s: string): string {
  return (DURUM_ETIKET as Readonly<Record<string, string>>)[s] ?? s;
}

export function durumTonu(s: string): DestekDurumTonu {
  return (DURUM_TONU as Readonly<Record<string, DestekDurumTonu>>)[s] ?? "soft";
}

export function boyutMetni(bayt: number): string {
  if (!Number.isFinite(bayt) || bayt < 0) return "—";
  if (bayt < 1024) return `${bayt} B`;
  if (bayt < 1024 * 1024) return `${Math.round(bayt / 1024)} KB`;
  return `${(bayt / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function silinmisEkMetni(ek: Pick<DestekEk, "name" | "size">): string {
  return `Ek süresi dolduğu için silindi · ${ek.name} · ${boyutMetni(ek.size)}`;
}

/** Sonucu BELİRSİZ mi (ağ yok · zaman aşımı · 5xx)? Talep açmada aynı `clientToken` ile tekrar denenir. */
export function belirsizMi(err: unknown): boolean {
  return !(err instanceof ApiError) || err.ambiguous;
}

export function hataKodu(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

/** Kapanıştan 14 gün geçmiş talebe yanıt — "Yeni talep aç" önerilir. */
export function yeniTalepGerekirMi(err: unknown): boolean {
  return hataKodu(err) === "REOPEN_WINDOW_EXPIRED";
}

function beklemeMetni(sn: number): string {
  if (sn >= 60) return `${Math.ceil(sn / 60)} dakika sonra tekrar deneyin.`;
  if (sn > 0) return `${sn} saniye sonra tekrar deneyin.`;
  return "Biraz sonra tekrar deneyin.";
}

const BUYUK = "Ekran görüntüsü çok büyük. Görüntüyü kaldırıp tekrar deneyin.";
const ULASILAMADI = "Destek merkezine şu an ulaşılamıyor. Biraz sonra tekrar deneyin.";

/** Kullanıcıya gösterilecek sade Türkçe hata metni. */
export function destekHataMetni(err: unknown): string {
  if (!(err instanceof ApiError)) return "Beklenmeyen bir hata oluştu. Tekrar deneyin.";
  if (err.status === 0) return "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";
  switch (err.code) {
    case "DESTEK_ULASILAMADI":
    case "DESTEK_ZAMAN_ASIMI":
      return ULASILAMADI;
    case "DESTEK_YAPILANDIRMA":
      return "Destek bağlantısında bir yapılandırma sorunu var. Sistem yöneticinize bildirin.";
    case "RATE_LIMITED":
    case "HIZ_SINIRI":
      return `Çok fazla istek gönderildi. ${beklemeMetni(Number(err.details.retryAfterSec) || 0)}`;
    case "MODULE_DISABLED":
      return "Destek şu an kapalı.";
    case "NOT_FOUND":
    case "BULUNAMADI":
      return "Talep bulunamadı.";
    case "FORBIDDEN":
      return "Bu talebe erişiminiz yok.";
    case "REOPEN_WINDOW_EXPIRED":
      return "Bu talep kapanalı 14 günden fazla oldu. Lütfen yeni talep açın.";
    case "ATTACHMENT_EXPIRED":
      return "Ek süresi dolduğu için silindi.";
    case "PAYLOAD_TOO_LARGE":
    case "PAKET_BUYUK":
    case "ATTACHMENT_TOO_LARGE":
      return BUYUK;
    default:
      break;
  }
  if (err.status === 413) return BUYUK;
  if (err.status === 429) return `Çok fazla istek gönderildi. ${beklemeMetni(0)}`;
  if (err.status >= 500) return ULASILAMADI;
  return err.message || "İşlem tamamlanamadı.";
}
