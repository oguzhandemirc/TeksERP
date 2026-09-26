// Kartela Hareketleri — saf katman (sorgu · sütun modeli). Satır başlığı, geçiş, aktör, kanal ve
// tetik Türkçe olarak SUNUCUDAN gelir; burada ikinci bir sözlük tutulmaz.
import apiClient from "@/services/apiClient";
import type { ExportColumn } from "@/lib/list-export";
import type { TimelinePage } from "@/components/timeline/EventTimeline";
import { formatEventInstant } from "../WorkOrders/events";

export type KartelaEventGroup = "KABUL" | "CUVAL" | "SEVKIYAT" | "DUSUM";

export interface KartelaEventItem {
  id: string;
  at: string;
  group: KartelaEventGroup;
  title: string;
  detail: string | null;
  reason: string | null;
  actor: string | null;
  channel: string | null;
  trigger: string | null;
  swatchId: string;
  card: string;
  product: string;
}

export interface KartelaEventFilter {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  swatchId?: string;
}

/** Süzgeç ve grup yalnız DOLUYSA gider — boş parametre sunucuda "hepsi" demek değildir. */
export function kartelaEventsQueryParams(f: KartelaEventFilter, opts: { group?: string; cursor?: string; limit: number }) {
  return {
    limit: opts.limit,
    ...(f.search?.trim() ? { search: f.search.trim() } : {}),
    ...(f.dateFrom ? { dateFrom: f.dateFrom } : {}),
    ...(f.dateTo ? { dateTo: f.dateTo } : {}),
    ...(f.swatchId ? { swatchId: f.swatchId } : {}),
    ...(opts.group ? { group: opts.group } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  };
}

export async function getKartelaEvents(
  f: KartelaEventFilter,
  opts: { group?: string; cursor?: string; limit: number },
): Promise<TimelinePage<KartelaEventItem>> {
  const res = await apiClient.get("/api/kartela/events", { params: kartelaEventsQueryParams(f, opts) });
  const body = res.data as {
    data: KartelaEventItem[];
    pagination: { nextCursor: string | null; hasMore: boolean };
    groups: TimelinePage<KartelaEventItem>["groups"];
  };
  return { data: body.data, nextCursor: body.pagination.nextCursor, hasMore: body.pagination.hasMore, groups: body.groups };
}

/**
 * TEK SÜTUN MODELİ — ekrandaki tablo ve Excel dışa aktarımı BURADAN türer (ekrandaki
 * sütunlar = Excel sütunları). Bir sütun eklenirse ikisine birden gider.
 */
export const KARTELA_EVENT_COLUMNS: ExportColumn<KartelaEventItem>[] = [
  { label: "Zaman", value: (r) => formatEventInstant(r.at) },
  { label: "Kartela", value: (r) => r.card },
  { label: "Ürün · renk", value: (r) => r.product },
  { label: "Olay", value: (r) => r.title },
  { label: "Ayrıntı", value: (r) => [r.detail, r.reason ? `Sebep: ${r.reason}` : null].filter(Boolean).join("\n") },
  {
    label: "Kim · nereden",
    value: (r) => [r.actor ?? "—", [r.channel, r.trigger].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
  },
];
