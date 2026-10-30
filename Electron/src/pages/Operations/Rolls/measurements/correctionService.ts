// Tambur kesim metresi düzeltmesi — POST /api/tambur/meter-readings/:id/correct (D4-B2 ucu; izin kursun:meter-approve).
import axios from "axios";
import apiClient from "@/services/apiClient";

export interface CutCorrectionBody {
  meters: number;
  reason: string;
  clientToken: string;
}

export async function correctCutReading(readingId: string, body: CutCorrectionBody): Promise<unknown> {
  // Hata diyalogun içinde gösterilir (409 metni); genel toast ikinci kez basmasın.
  const res = await apiClient.post(`/api/tambur/meter-readings/${readingId}/correct`, body, { suppressErrorToast: true });
  return res.data;
}

/** 409 kodları (backend `tambur-meter-correct.service`) → kullanıcı metni; sunucu mesajı varsa o esas. */
const CODE_TEXT: Record<string, string> = {
  SERVICE_ALREADY_BILLED: "Bu kesim metresi faturaya bağlı — önce faturayı iptal edin.",
  METER_READING_ALREADY_CORRECTED: "Bu okuma az önce düzeltildi ya da geri alındı — listeyi yenileyip tekrar deneyin.",
  METER_READING_REVOKED: "Bu düzeltme sonradan yeniden düzeltildi ya da geri alındı — listeyi yenileyin.",
  ROLL_NOT_CORRECTABLE: "Top iptal edilmiş ya da kesimi geri alınmış — kesim metresi düzeltilemez.",
  CLIENT_TOKEN_COLLISION: "Bu düzeltme kimliği başka bir değer için kullanılmış — formu yeniden açın.",
};

/** Hata kodu yalnız `details.code`ten (kök kural); metin önceliği: sunucu mesajı → kod metni → genel. */
export function correctionErrorText(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Düzeltme kaydedilemedi.";
  if (!error.response) return "Sunucuya ulaşılamadı — aynı düzeltme güvenle yeniden gönderilebilir.";
  const data = error.response.data as { message?: unknown; details?: { code?: unknown } } | undefined;
  const code = typeof data?.details?.code === "string" ? data.details.code : null;
  if (typeof data?.message === "string" && data.message.trim()) return data.message;
  if (code && CODE_TEXT[code]) return CODE_TEXT[code];
  return error.response.status >= 500 ? "Sunucu hatası — aynı düzeltme güvenle yeniden gönderilebilir." : "Düzeltme kaydedilemedi.";
}
