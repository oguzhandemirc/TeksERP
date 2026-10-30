// SEVKE HAZIR İŞLER (D4-J3, ister 2.4 / 2.10) — `GET /api/shipping/ready-works` + `/:unit/:id/rolls` aynası.
// Hazırlık SUNUCUDA türetilir (`ship-readiness.helper`); durum ve müşteri süzgeci query'ye gider, istemci süzmez.
import apiClient from "@/services/apiClient";

export type ReadyWorkUnit = "workOrder" | "deliveryNote" | "customerBatch" | "customer";
export type ReadyWorkState = "READY" | "PARTIAL" | "NONE";
export type ReadinessClass = "READY" | "IN_PROCESS" | "GONE" | "SCRAP";

export interface ReadyWorkRow {
  unit: ReadyWorkUnit;
  id: string;
  label: string;
  customerId: string | null;
  customerName: string | null;
  state: ReadyWorkState;
  appliedRule: "ALL_DONE" | "METER_THRESHOLD";
  readyCount: number;
  readyMeters: number;
  inProcessCount: number;
  inProcessMeters: number;
  shippedMeters: number;
  scrapMeters: number;
  targetMeters: number | null;
}

export interface ReadyWorkSummary {
  units: number;
  ready: number;
  partial: number;
  none: number;
  readyMeters: number;
  inProcessMeters: number;
  shippedMeters: number;
}

export interface ReadyWorkPage {
  items: ReadyWorkRow[];
  nextCursor: string | null;
  summary: ReadyWorkSummary;
  policy: { rule: "ALL_DONE" | "METER_THRESHOLD"; tolerancePct: number };
}

export interface ReadyWorkRoll {
  id: string;
  barcode: string | null;
  status: string;
  readinessClass: ReadinessClass;
  currentQty: number;
  itemName: string | null;
  colorName: string | null;
  ownerCustomerId: string | null;
}

export const READY_WORKS_QUERY_KEY = "ready-works";
export const READY_WORKS_PATH = "/operations/sevke-hazir-isler";

export interface ReadyWorksParams {
  groupBy: ReadyWorkUnit;
  /** Boş dizi = tümü. Süzme SUNUCUDA (liste, imleç ve özet şeridi aynı where'den). */
  states: ReadyWorkState[];
  customerId?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Query dizgesi — saf (bekçi: durum süzgeci istemciye taşınamaz, query'de kalır). */
export function readyWorksQueryString(p: ReadyWorksParams): string {
  const q = new URLSearchParams({ groupBy: p.groupBy });
  if (p.states.length > 0) q.set("state", p.states.join(","));
  if (p.customerId) q.set("customerId", p.customerId);
  if (p.cursor) q.set("cursor", p.cursor);
  if (p.limit) q.set("limit", String(p.limit));
  return q.toString();
}

export async function getReadyWorks(p: ReadyWorksParams): Promise<ReadyWorkPage> {
  const r = await apiClient.get<{ success: boolean; data: ReadyWorkPage }>(`/api/shipping/ready-works?${readyWorksQueryString(p)}`);
  return r.data.data;
}

/** Birimin topları; `rollClass` boşsa hepsi. customerBatch kimliği `<sahipId>:<parti no>` — URL kodlanır. */
export async function getReadyWorkRolls(unit: ReadyWorkUnit, id: string, rollClass: ReadinessClass[] = []): Promise<ReadyWorkRoll[]> {
  const q = new URLSearchParams({ limit: "1000" });
  if (rollClass.length > 0) q.set("rollClass", rollClass.join(","));
  const r = await apiClient.get<{ success: boolean; data: { items: ReadyWorkRoll[]; nextCursor: string | null } }>(
    `/api/shipping/ready-works/${unit}/${encodeURIComponent(id)}/rolls?${q.toString()}`,
  );
  return r.data.data.items;
}

/** Birim türünün TÜM satırları (imleç sonuna kadar, sayfa tavanlı) — İçerideki İşler müşteri hazırlık kolonu. */
export async function getAllReadyWorks(groupBy: ReadyWorkUnit, maxPages = 10): Promise<ReadyWorkRow[]> {
  const out: ReadyWorkRow[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page: ReadyWorkPage = await getReadyWorks({ groupBy, states: [], cursor, limit: 200 });
    out.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return out;
}
