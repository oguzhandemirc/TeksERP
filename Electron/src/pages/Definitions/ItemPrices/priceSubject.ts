// =============================================================================
// KALEM FİYATI KONUSU — ürün kartı mı hizmet kartı mı (saf katman, D2)
// =============================================================================
// Hizmet kartı ayrı tabloda (`service_items`); fiyat uçları konu kimliğini (`itemId`) iki tabloda çözer, ama panel
// kartın adını/birimini doğru uçtan okumalı ve seçici doğru modalı açmalı. Bekçi: `ItemPricesPage.test.tsx`.
// =============================================================================
import type { ItemPriceRow } from "./service";

export type PriceSubjectKind = "PRODUCT" | "SERVICE";

export const PRICE_SUBJECT_LABEL: Record<PriceSubjectKind, string> = { PRODUCT: "Ürün", SERVICE: "Hizmet" };

export interface PriceSubject {
  kind: PriceSubjectKind;
  id: string;
}

/** Fiyat satırının konusu — `serviceItemId` doluysa hizmet kartı. */
export const priceSubjectOfRow = (r: Pick<ItemPriceRow, "itemId" | "serviceItemId">): PriceSubject =>
  r.serviceItemId ? { kind: "SERVICE", id: r.serviceItemId } : { kind: "PRODUCT", id: r.itemId };
