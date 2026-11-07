// =============================================================================
// ESKİ İSTEMCİ UYUMLULUK YOLU — hizmet kartını `/api/items` üzerinden eski Item şekliyle sunar (plan §5)
// =============================================================================
// Hizmet kartları `service_items`'a aynı UUID ile taşındı; eski panel (K3 Hizmetler sayfası) hâlâ
// `GET /api/items?filter[itemType]=SERVICE`, `GET/PATCH /api/items/:id` ve yaşam döngüsü uçlarını çağırır.
// TEK BOĞAZ burası: `item.service.ts` yalnız buradan yönlendirir. `minVersion` YOK. Kalkma koşulu MV-05:
// sahadaki tüm paneller yeni sürümü raporlayınca bu dosya ve `ItemType.SERVICE` değeri ayrı dilimde silinir.
// =============================================================================
import type { Request } from "express";
import type { ServiceItem } from "@prisma/client";
import prisma from "../../lib/prisma";
import { parseQueryParams, readFilterList } from "../../utils/query-parser";
import { serviceItemService } from "../service-item.service";

/** Eski Item satırının hizmette anlamı olmayan kolonları — boş değerle doldurulur (panel tipleri alanı bekler). */
const ITEM_ONLY_EMPTY = {
  pendingReview: false,
  widthCm: null,
  linearDensityDen: null,
  warpSpecId: null,
  rawWidthCm: null,
  rawGsm: null,
  finishedGsm: null,
  composition: null,
  weftSpecId: null,
  weaveDesignId: null,
  allowedColors: [] as unknown[],
  allowedProperties: [] as unknown[],
} as const;

export type LegacyServiceItem = ServiceItem & typeof ITEM_ONLY_EMPTY & { itemType: "SERVICE" };

/** `service_items` satırı → eski `Item` şekli (`itemType: SERVICE`). */
export function toLegacyItemShape(row: ServiceItem): LegacyServiceItem {
  return { ...row, ...ITEM_ONLY_EMPTY, itemType: "SERVICE" };
}

/** Liste isteği YALNIZ SERVICE türünü mü istiyor? Karışık süzgeçte (`SERVICE,FABRIC`) ürün listesi döner (hizmet ayrı ekranda). */
export function wantsLegacyServiceList(req: Request): boolean {
  const types = readFilterList(parseQueryParams(req).filters.itemType);
  return types.length > 0 && types.every((t) => t === "SERVICE");
}

/** Eski şekilli hizmet listesi — arama/sayfalama/cursor hizmet kartı servisinin tek where'inden. */
export async function findLegacyServiceList(req: Request): Promise<unknown> {
  const res = (await serviceItemService.findAll(req)) as unknown as { data: ServiceItem[] } & Record<string, unknown>;
  return { ...res, data: res.data.map(toLegacyItemShape) };
}

/** Kimlik bir hizmet kartı mı? (ürün kartı yolu kayıt bulamadığında sorulur). */
export async function isServiceItemId(id: string): Promise<boolean> {
  return (await prisma.serviceItem.count({ where: { id } })) > 0;
}

/** Kimlik kümesinin hizmet kartı olanları. */
export async function serviceItemIdsOf(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.serviceItem.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** `GET /api/items/:id` hizmet id'si → eski şekil; yoksa `null`. */
export async function findLegacyServiceById(id: string): Promise<LegacyServiceItem | null> {
  const row = await prisma.serviceItem.findUnique({ where: { id } });
  return row ? toLegacyItemShape(row) : null;
}

/** Hizmet kartı servis yanıtının `data`sını eski şekle çevirir (PATCH / yaşam döngüsü yönlendirmeleri). */
export function legacyResponse<T extends { data?: unknown }>(res: T): T {
  const d = res.data as ServiceItem | null | undefined;
  return d && typeof d === "object" && "code" in d ? { ...res, data: toLegacyItemShape(d) } : res;
}
