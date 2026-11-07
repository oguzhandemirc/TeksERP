// "Depoda hazır", "Depoda (tümü)" ve "Üretimde" kaynakları — YALNIZ mevcut uçlar (yeni uç yok; 2.11.7'de de var).
//   · Depoda hazır : `GET /api/reports/inventory/scorecard/kalem` `bitmis[]` — Stok & Ölü Stok "Bitmiş depo"
//                    tanımı (WAREHOUSE + A1_STOCK, sevke/çuvala girmemiş); kat kırılımı toplamada erir.
//   · Depoda tümü  : `GET /api/rolls?filter[statusIn]=WAREHOUSE,A1_STOCK&filter[includeFire]=true` — aynı statü
//                    kümesi, sackId/shipmentId SÜZÜLMEZ (kalem ucu süzer; o yüzden ondan türetilemez).
//   · Üretimde     : `GET /api/rolls?filter[statusIn]=IN_PRODUCTION,AT_SUBCONTRACTOR` → `currentStep.workOrder`
//                    başına metre. Canlı top tanımı backend `LOCATION_LIVE_STATUSES` (İE "Şu an nerede") aynası.
// Ölçülemeyen kaynak `null` döner + gerekçe; sayı uydurulmaz, hata toast'ı basılmaz (dosyaya not düşer).
import apiClient from "@/services/apiClient";
import { buildCursorQueryString } from "@/lib/query-builder";
import { drainCursor, EXPORT_PAGE_LIMIT, type DrainPage } from "@/lib/export-drain";
import type { StockCellInput } from "./aggregate";

/** Backend `workorder-location.helper.ts` LOCATION_LIVE_STATUSES aynası — değişirse ikisi birlikte. */
export const LIVE_ROLL_STATUSES = ["IN_PRODUCTION", "AT_SUBCONTRACTOR"] as const;

/** Backend `stock-scorecard.report.service.ts` FINISHED aynası — değişirse ikisi birlikte. */
export const FINISHED_ROLL_STATUSES = ["WAREHOUSE", "A1_STOCK"] as const;

export interface SourceResult<T> {
  value: T | null;
  /** Ölçülemediyse kullanıcıya dosyada gösterilecek Türkçe gerekçe; uyarı (satır tavanı) da buraya. */
  notes: string[];
}

interface StockKalemBody {
  data?: { bitmis?: Array<{ itemId: string; colorId: string | null; width: number | null; qty: number }> };
  warnings?: string[];
}

export async function loadFinishedStock(canRead: boolean): Promise<SourceResult<StockCellInput[]>> {
  if (!canRead) return { value: null, notes: ["Depoda hazır (serbest) ölçülemedi: stok raporu izniniz yok (report:inventory)."] };
  try {
    const res = await apiClient.get<StockKalemBody>("/api/reports/inventory/scorecard/kalem", { suppressErrorToast: true });
    const rows = res.data.data?.bitmis;
    if (!Array.isArray(rows)) return { value: null, notes: ["Depoda hazır (serbest) ölçülemedi: sunucu stok kırılımı göndermedi."] };
    return {
      value: rows.map((r) => ({ itemId: r.itemId, colorId: r.colorId, width: r.width, qty: Number(r.qty) || 0 })),
      notes: (res.data.warnings ?? []).map((w) => `Depoda hazır (serbest): ${w}`),
    };
  } catch {
    return { value: null, notes: ["Depoda hazır (serbest) ölçülemedi: stok raporu açılamadı (rapor kapalı ya da sunucu hatası)."] };
  }
}

interface FinishedRoll {
  itemId: string;
  colorId: string | null;
  width: number | string | null;
  currentQty: number | string;
}

/**
 * Depodaki HER bitmiş top (çuvaldaki + sevkiyata ayrılmış dahil). Fire kalitesi de dahil
 * (`includeFire`), çünkü kalem ucu kaliteye bakmaz: tümü ⊇ serbest kalır.
 */
export async function loadAllFinishedStock(canRead: boolean): Promise<SourceResult<StockCellInput[]>> {
  if (!canRead) return { value: null, notes: ["Depoda (tümü) ölçülemedi: top listesi izniniz yok (roll:read)."] };
  try {
    const { rows, truncated } = await drainCursor<FinishedRoll>(async (cursor) => {
      const qs = buildCursorQueryString({
        cursor,
        limit: EXPORT_PAGE_LIMIT,
        filters: { statusIn: FINISHED_ROLL_STATUSES.join(","), includeFire: "true" },
      });
      const res = await apiClient.get<DrainPage<FinishedRoll>>(`/api/rolls${qs}`, { suppressErrorToast: true });
      return res.data;
    });
    if (truncated) return { value: null, notes: ["Depoda (tümü) ölçülemedi: depodaki top listesi tavana çarptı."] };
    return { value: finishedCells(rows), notes: [] };
  } catch {
    return { value: null, notes: ["Depoda (tümü) ölçülemedi: depodaki toplar okunamadı."] };
  }
}

/** Top başına hücre; en Decimal olduğu için telde metin gelebilir. */
export function finishedCells(rolls: FinishedRoll[]): StockCellInput[] {
  return rolls.map((r) => ({
    itemId: r.itemId,
    colorId: r.colorId ?? null,
    width: r.width == null || r.width === "" ? null : Number(r.width),
    qty: Number(r.currentQty) || 0,
  }));
}

interface LiveRoll {
  currentQty: number | string;
  currentStep?: { workOrder: { id: string } | null } | null;
}

export async function loadLiveMetersByWorkOrder(
  canRead: boolean,
  productionEnabled: boolean,
): Promise<SourceResult<Map<string, number>>> {
  // Üretim kapalı kurulumda iş emri yok → üretimde gerçekten 0 (ölçülemedi değil).
  if (!productionEnabled) return { value: new Map(), notes: [] };
  if (!canRead) return { value: null, notes: ["Üretimde ölçülemedi: top listesi izniniz yok (roll:read)."] };
  try {
    const { rows, truncated } = await drainCursor<LiveRoll>(async (cursor) => {
      const qs = buildCursorQueryString({
        cursor,
        limit: EXPORT_PAGE_LIMIT,
        filters: { statusIn: LIVE_ROLL_STATUSES.join(",") },
      });
      const res = await apiClient.get<DrainPage<LiveRoll>>(`/api/rolls${qs}`, { suppressErrorToast: true });
      return res.data;
    });
    if (truncated) return { value: null, notes: ["Üretimde ölçülemedi: üretimdeki top listesi tavana çarptı."] };
    return { value: liveMetersByWorkOrder(rows), notes: [] };
  } catch {
    return { value: null, notes: ["Üretimde ölçülemedi: üretimdeki toplar okunamadı."] };
  }
}

/** Adımı olmayan top İE "nerede"sine girmez (backend: currentStepId dolu VE canlı statü). */
export function liveMetersByWorkOrder(rolls: LiveRoll[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rolls) {
    const wo = r.currentStep?.workOrder?.id;
    if (!wo) continue;
    m.set(wo, (m.get(wo) ?? 0) + (Number(r.currentQty) || 0));
  }
  return m;
}
