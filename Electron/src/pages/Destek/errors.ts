// Destek uçlarının hata cümlesi — karar `details.code` ve HTTP durumuyla verilir (`body.code` hep undefined).
// Sözleşme §4: 4xx'te sunucunun `message`ı kullanıcıya gösterilebilir Türkçe metindir.
import axios from "axios";
import { apiErrorMessage } from "@/services/apiClient";

export interface DestekError {
  status: number | null;
  code: string | null;
  message: string;
  /** 429'da sunucunun söylediği bekleme (sn). */
  retryAfterSec: number | null;
  /** Kapanıştan 14 gün geçti: kullanıcıya "Yeni talep aç" önerilir. */
  suggestNewTicket: boolean;
}

interface Body {
  message?: string;
  details?: { code?: unknown; retryAfterSec?: unknown };
}

function readRetryAfter(error: unknown, body: Body | undefined): number | null {
  const fromBody = body?.details?.retryAfterSec;
  if (typeof fromBody === "number" && fromBody > 0) return Math.ceil(fromBody);
  const header = axios.isAxiosError(error) ? error.response?.headers?.["retry-after"] : undefined;
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

const UNREACHABLE = "Destek merkezine şu an ulaşılamıyor. Biraz sonra tekrar deneyin.";

function messageFor(status: number | null, code: string | null, error: unknown, retry: number | null): string {
  if (status === null) return "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.";
  if (code === "DESTEK_YAPILANDIRMA") return "Destek bağlantısı yapılandırılamadı. Lütfen sistem yöneticinize bildirin.";
  if (code === "DESTEK_ULASILAMADI" || code === "DESTEK_ZAMAN_ASIMI" || status === 502 || status === 504) {
    return UNREACHABLE;
  }
  if (status === 429) {
    return retry ? `Çok sık istek gönderildi. ${retry} saniye sonra tekrar deneyin.` : "Çok sık istek gönderildi. Biraz sonra tekrar deneyin.";
  }
  if (status === 413) return "Dosyalar çok büyük. Daha küçük ya da daha az dosya ekleyin (dosya başına en çok 10 MB).";
  if (code === "REOPEN_WINDOW_EXPIRED") {
    return "Bu talep kapanalı 14 günden fazla oldu; yanıt yazılamıyor. Lütfen yeni bir talep açın.";
  }
  if (code === "NOT_FOUND") return "Talep bulunamadı.";
  if (code === "MODULE_DISABLED") return "Destek bu kurulumda kapalı.";
  if (status >= 500) return "Sunucu hatası. Lütfen biraz sonra tekrar deneyin.";
  return apiErrorMessage(error, "İstek tamamlanamadı.");
}

export function readDestekError(error: unknown): DestekError {
  const response = axios.isAxiosError(error) ? error.response : undefined;
  const status = response?.status ?? null;
  const body = response?.data as Body | undefined;
  const code = typeof body?.details?.code === "string" ? body.details.code : null;
  const retryAfterSec = status === 429 ? readRetryAfter(error, body) : null;
  return {
    status,
    code,
    retryAfterSec,
    message: messageFor(status, code, error, retryAfterSec),
    suggestNewTicket: code === "REOPEN_WINDOW_EXPIRED",
  };
}

/** Eski backend (uç yok → 404) ya da kapalı kurulum: destek "yok" sayılır. */
export function isFeatureAbsent(error: unknown): boolean {
  const e = readDestekError(error);
  return e.status === 404 || e.code === "MODULE_DISABLED";
}
