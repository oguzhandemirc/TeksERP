// =============================================================================
// KURŞUN GRAMAJI — panel tarafı tek okuma noktası (KQ-D6)
// =============================================================================
// Gramaj değerleri kodda DEĞİL: "Kurşunlu" bayrağının ÇEŞİT özelliğinin (KQ-D4
// `variantOfPropertyId`) aktif değerleridir. Fallback yok — çeşit tanımlı değilse
// boş döner ve hedef gramaj alanı hiç çizilmez.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { FabricProperty } from "@/pages/FabricProperties/types";

/** Kurşun bayrağının kodu — backend `KURSUN_PROPERTY_CODE` ile aynı sabit. */
export const KURSUN_PROPERTY_CODE = "KURSUN";

export interface GramajOption {
  id: string;
  name: string;
}

export interface KursunGramajCatalog {
  /** Çeşit özelliğinin kimliği (hedef yazımında `propertyId`); yoksa null. */
  propertyId: string | null;
  options: GramajOption[];
}

export async function loadKursunGramajCatalog(): Promise<KursunGramajCatalog> {
  const res = await loadAllForPicker(fabricPropertyService, { sortBy: "sortOrder", filters: { isActive: "true" } });
  const rows = (res.data ?? []) as FabricProperty[];
  const flag = rows.find((p) => p.code === KURSUN_PROPERTY_CODE);
  const variant = flag ? rows.find((p) => p.variantOfPropertyId === flag.id && p.isActive) : undefined;
  if (!variant) return { propertyId: null, options: [] };
  const options = (variant.values ?? [])
    .filter((v) => v.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((v) => ({ id: v.id, name: v.name }));
  return { propertyId: variant.id, options };
}

export const KURSUN_GRAMAJ_CATALOG_KEY = ["fabric-properties", "kursun-gramaj-catalog"] as const;

export function useKursunGramajCatalog() {
  const q = useQuery({ queryKey: KURSUN_GRAMAJ_CATALOG_KEY, queryFn: loadKursunGramajCatalog, staleTime: 60_000 });
  return { catalog: q.data ?? { propertyId: null, options: [] }, isLoading: q.isLoading };
}

// ── Gramaj özeti (İE kartı + parti izi) ─────────────────────────────────────

export type KursunSource = "TABLET" | "KAGIT";

export interface KursunSummaryRow {
  valueId: string | null;
  valueName: string;
  source: KursunSource;
  rollCount: number;
  stepCount: number;
  /** Decimal string ("1666.00"). */
  meters: string;
  deviatesFromTarget: boolean;
}

export interface KursunSummary {
  target: { propertyId: string; valueId: string; valueName: string } | null;
  rows: KursunSummaryRow[];
  totals: { rollCount: number; meters: string };
}

export type ProcessSummaryScope = { workOrderId: string } | { batchId: string };

export function processSummaryUrl(scope: ProcessSummaryScope): string {
  return "workOrderId" in scope
    ? `/api/work-orders/${scope.workOrderId}/process-summary`
    : `/api/batches/${scope.batchId}/process-summary`;
}

export function processSummaryKey(scope: ProcessSummaryScope) {
  return ["process-summary", "workOrderId" in scope ? `wo:${scope.workOrderId}` : `batch:${scope.batchId}`] as const;
}

/** Gelen belgeden türeyen hedef gramaj önerisi (H9b) — yalnız İE kapsamında ve gelen belge modülü açıkken gelir. */
export interface DeliveryNoteGramajSuggestion {
  /** Kapsanan bütün toplar tek çeşitte birleştiyse; aksi halde null (liste gösterilir). */
  suggested: { valueId: string; valueName: string } | null;
  rollCount: number;
  coveredRollCount: number;
  entries: Array<{ valueId: string | null; valueName: string | null; processText: string | null; rollCount: number }>;
  /** Kurşun dışı çeşit özellikleri (brode deseni vb., D4-D1), özellik başına aynı birleştirme; yoksa / eski backend → yok. */
  variants?: Array<{
    propertyId: string;
    propertyName: string;
    suggested: { valueId: string; valueName: string } | null;
    entries: Array<{ valueId: string | null; valueName: string | null; processText: string | null; rollCount: number }>;
  }>;
}

export interface ProcessSummaryData {
  kursun: KursunSummary;
  /** Anahtar yok = modül kapalı ya da parti kapsamı; null = toplarda gelen belge satırı yok. */
  deliveryNoteGramaj?: DeliveryNoteGramajSuggestion | null;
}

export async function fetchProcessSummary(scope: ProcessSummaryScope): Promise<ProcessSummaryData> {
  const res = await apiClient.get<{ success: true; data: ProcessSummaryData }>(processSummaryUrl(scope));
  return res.data.data;
}

/** Yalnız gövdedeki özelliklerin hedefi değişir; `valueId: null` = o özelliğin hedefini kaldır (sunucu damgalar). */
export async function putWorkOrderTargetValues(
  workOrderId: string,
  items: Array<{ propertyId: string; valueId: string | null }>,
): Promise<{ changed: boolean }> {
  const res = await apiClient.put<{ success: true; data: { changed: boolean } }>(
    `/api/work-orders/${workOrderId}/target-values`,
    { items },
  );
  return res.data.data;
}
