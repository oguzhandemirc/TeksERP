// İş emri Hareketler — saf katman (sorgu parametresi · altbilgi). Satır başlığı
// ve Türkçe etiketler SUNUCUDAN gelir; burada ikinci bir sözlük tutulmaz.
import apiClient from "@/services/apiClient";
import { fetchAllTimeline, timelineFooterText } from "@/components/timeline/EventTimeline";
import type { ExportColumn } from "@/lib/list-export";

export type TimelineGroup = "DURUM" | "PLAN" | "SIPARIS" | "PARTI" | "FASON" | "TAMBUR" | "KAPANIS";

export interface TimelineItem {
  id: string;
  at: string;
  group: TimelineGroup;
  title: string;
  detail: string | null;
  reason: string | null;
  actor: string | null;
  channel: string | null;
  trigger: string | null;
  /** Geçmişten sonradan türetildi (backfill) — rozetle ayrılır. */
  derived: boolean;
  /** Belge düzeyi satırın topları (iş emri iptali dönüşü); yoksa alan gelmez. */
  rolls?: Array<{ barcode: string | null; qty: number; to: string | null }>;
}

export interface TimelinePageResponse {
  data: TimelineItem[];
  nextCursor: string | null;
  hasMore: boolean;
  groups: Array<{ key: TimelineGroup; label: string; count: number }>;
}

/** Grup süzgeci CSV olarak gider; boş süzgeçte parametre HİÇ gitmez. */
export function eventsQueryParams(opts: { group?: TimelineGroup | ""; cursor?: string; limit: number }) {
  return {
    limit: opts.limit,
    ...(opts.group ? { group: opts.group } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  };
}

export async function getWorkOrderEvents(
  workOrderId: string,
  opts: { group?: TimelineGroup | ""; cursor?: string; limit: number },
): Promise<TimelinePageResponse> {
  const res = await apiClient.get(`/api/work-orders/${workOrderId}/events`, { params: eventsQueryParams(opts) });
  const body = res.data as {
    data: TimelineItem[];
    pagination: { nextCursor: string | null; hasMore: boolean };
    groups: TimelinePageResponse["groups"];
  };
  return { data: body.data, nextCursor: body.pagination.nextCursor, hasMore: body.pagination.hasMore, groups: body.groups };
}

/** Kırpma sessiz değil — ortak zaman çizelgesinin altbilgisi (geriye uyum adı). */
export const eventsFooterText = timelineFooterText;

export const formatEventInstant = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * TEK SÜTUN MODELİ — ekrandaki tablo ve Excel dışa aktarımı BURADAN türer (ekrandaki
 * sütunlar = Excel sütunları). Bir sütun eklenirse ikisine birden gider.
 */
export const EVENT_COLUMNS: ExportColumn<TimelineItem>[] = [
  { label: "Zaman", value: (r) => formatEventInstant(r.at) },
  { label: "Olay", value: (r) => (r.derived ? `${r.title} (sonradan türetildi)` : r.title) },
  { label: "Ayrıntı", value: (r) => [r.detail, r.reason ? `Sebep: ${r.reason}` : null].filter(Boolean).join("\n") },
  {
    label: "Kim · nereden",
    value: (r) => [r.actor ?? "—", [r.channel, r.trigger].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
  },
];

/** Dışa aktarım listenin TAMAMINI alır — ekranda yüklenmiş sayfalarla sınırlı değil. */
export function fetchAllWorkOrderEvents(workOrderId: string, group: TimelineGroup | ""): Promise<TimelineItem[]> {
  return fetchAllTimeline((o) => getWorkOrderEvents(workOrderId, { group, cursor: o.cursor, limit: o.limit }), group);
}

export interface LookupHit {
  id: string;
  workOrderNumber: string;
  status: string;
  createdAt: string;
  via: "WORK_ORDER_NUMBER" | "ROLL_BARCODE";
}

export async function lookupWorkOrdersForEvents(q: string): Promise<LookupHit[]> {
  const res = await apiClient.get("/api/work-orders/events/lookup", { params: { q } });
  return (res.data as { data: LookupHit[] }).data;
}
