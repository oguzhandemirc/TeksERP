// =============================================================================
// ÇEK VADE ÖZETİ — Çekler ekranının özet kartları (backend `cheque.service.dueSummary` aynası)
// =============================================================================
// ⚠️ Yol TAM yazılır ("/api/finance/cheques/due-summary") — `apiClient.baseURL`
// `/api` İÇERMEZ; öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "vadesi
// yaklaşan çek yok" gösterir. Para ekranında bu, boş ekrandan kötüdür.
//
// ⚠️ UÇ `/api/reports/...` ALTINDA DEĞİL: veri çekin KENDİ yaşam döngüsünden gelir;
// emekli Çek Vade Takvimi raporunun gösterim yardımcıları sayfasıyla kalktı (2026-11-12).
//
// ⚠️ TUTARLAR **STRING** GELİR (backend Decimal → 2 hane string; `service.ts`
// başlığındaki kuruş gerekçesi). Bu dosya onları `string` tipler; gösterim
// kartlarda yapılır; istemcide ARİTMETİK YAPILMAZ.
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ChequeKind, ChequeStatus } from "./service";
import type { Currency } from "@/pages/Finance/service";

/** Backend `CHEQUE_DUE_BUCKETS` aynası — SIRA anlamlıdır (geçmiş → uzak). */
export type ChequeDueBucket = "OVERDUE" | "SOON" | "MONTH" | "LATER" | "NO_DUE";

export interface ChequeDueBucketRow {
  bucket: ChequeDueBucket;
  kind: ChequeKind;
  currency: Currency;
  count: number;
  amount: string;
}

export interface ChequeDueCalendarRow {
  /** Hafta: pazartesi günü (`YYYY-MM-DD`) · Ay: `YYYY-MM`. */
  key: string;
  start: string;
  end: string;
  kind: ChequeKind;
  currency: Currency;
  count: number;
  amount: string;
}

export interface ChequeDueSummary {
  /** Fabrika takvim günü (`YYYY-MM-DD`) — kova sınırlarının çıpası. */
  today: string;
  /** "Yaklaşan" eşiği. ⚠️ İstemci kendi "7"sini YAZMAZ — buradan okur. */
  soonDays: number;
  buckets: ChequeDueBucketRow[];
  window: { from: string; to: string };
  weeks: ChequeDueCalendarRow[];
  months: ChequeDueCalendarRow[];
  /** Kapsam AÇIKÇA döner — liste süzgeci de bundan kurulur (tek kaynak). */
  liveStatuses: Record<ChequeKind, ChequeStatus[]>;
  notes: string[];
}

export async function getChequeDueSummary(p?: {
  /** ISO mutlak an. İKİSİ BİRDEN gönderilir — backend tek ucu 400'ler. */
  dateFrom?: string;
  dateTo?: string;
}): Promise<ChequeDueSummary> {
  // Boş değer GÖNDERİLMEZ: şema `.strict()` ve boş string "Geçersiz tarih"
  // 400'ü üretir. Hiç gönderilmezse backend İLERİ bakan varsayılanı uygular
  // (bugün + 30 gün) — varsayılanın TEK kaynağı orasıdır.
  const params: Record<string, string> = {};
  if (p?.dateFrom && p?.dateTo) {
    params.dateFrom = p.dateFrom;
    params.dateTo = p.dateTo;
  }
  const res = await apiClient.get<{ success: true; data: ChequeDueSummary }>(
    "/api/finance/cheques/due-summary",
    { params },
  );
  return res.data.data;
}
