// =============================================================================
// FATURA SATIRI KONUSU — Ürün / Hizmet / Açıklama (saf katman, D2 panel yarısı)
// =============================================================================
// Backend sözleşmesi (D1c, `helpers/invoice-line-subject.helper.ts`): satır `lineType` taşır — PRODUCT → `itemId`
// (ürün kartı), SERVICE → `serviceItemId` (hizmet kartı, `service_items`), TEXT → ikisi boş. Panel her satırda üçünü
// AÇIKÇA gönderir (eski `lineType`siz gövde yalnız eski panel içindir). Okurken: detay satırı `lineType` +
// `serviceItem` taşır; `item` hizmet satırında eski panel için hizmetin AYNASIDIR — yeni panel onu ürün sanmamalı.
// Bekçi: `InvoiceFormDialog.lineType.test.tsx`.
// =============================================================================

export type InvoiceLineType = "PRODUCT" | "SERVICE" | "TEXT";

export const INVOICE_LINE_TYPES: readonly InvoiceLineType[] = ["PRODUCT", "SERVICE", "TEXT"];

export const INVOICE_LINE_TYPE_LABEL: Record<InvoiceLineType, string> = {
  PRODUCT: "Ürün",
  SERVICE: "Hizmet",
  TEXT: "Açıklama",
};

export interface InvoiceLineSubject {
  lineType: InvoiceLineType;
  itemId: string | null;
  serviceItemId: string | null;
}

/** Konu taşıyan herhangi bir satır girdisi (detay, ön-dolum, sunucu önizlemesi). */
export interface InvoiceLineSubjectSource {
  lineType?: InvoiceLineType | null;
  itemId?: string | null;
  serviceItemId?: string | null;
  item?: { id: string } | null;
  serviceItem?: { id: string } | null;
}

/**
 * Kaynaktan form konusu. Açık `lineType` her şeyin önündedir (hizmet satırında `itemId`/`item` yalnız aynadır).
 * `lineType` yoksa (ürün ön-dolumu, eski sunucu): `serviceItemId` → SERVICE, kart varsa PRODUCT, yoksa TEXT.
 */
export function lineSubjectFrom(src: InvoiceLineSubjectSource): InvoiceLineSubject {
  const service = src.serviceItemId ?? src.serviceItem?.id ?? null;
  const item = src.itemId ?? src.item?.id ?? null;
  switch (src.lineType ?? null) {
    case "SERVICE":
      return { lineType: "SERVICE", itemId: null, serviceItemId: service ?? item };
    case "PRODUCT":
      return { lineType: "PRODUCT", itemId: item, serviceItemId: null };
    case "TEXT":
      return { lineType: "TEXT", itemId: null, serviceItemId: null };
    default:
      if (service) return { lineType: "SERVICE", itemId: null, serviceItemId: service };
      return item ? { lineType: "PRODUCT", itemId: item, serviceItemId: null } : { lineType: "TEXT", itemId: null, serviceItemId: null };
  }
}

/**
 * Gönderilecek konu. Türü seçilmiş ama kartı seçilmemiş satır AÇIKLAMA satırıdır (kalemsiz satır bugün de serbest);
 * öteki türün kimliği asla gitmez — backend şekil kuralı aksi hâlde 400 verir.
 */
export function lineSubjectPayload(l: InvoiceLineSubject): InvoiceLineSubject {
  if (l.lineType === "PRODUCT" && l.itemId) return { lineType: "PRODUCT", itemId: l.itemId, serviceItemId: null };
  if (l.lineType === "SERVICE" && l.serviceItemId) return { lineType: "SERVICE", itemId: null, serviceItemId: l.serviceItemId };
  return { lineType: "TEXT", itemId: null, serviceItemId: null };
}

/** Fiyat önerisi + açıklama ön-dolumu için konu kimliği (fiyat uçları kimliği iki tabloda çözer). */
export function lineSubjectId(l: InvoiceLineSubject): string | null {
  if (l.lineType === "PRODUCT") return l.itemId;
  if (l.lineType === "SERVICE") return l.serviceItemId;
  return null;
}

/** Tür değişimi: öteki türün kartı düşer (ürün kimliği hizmet satırında kalmaz). */
export function withLineType<T extends InvoiceLineSubject>(l: T, lineType: InvoiceLineType): T {
  if (l.lineType === lineType) return l;
  return { ...l, lineType, itemId: null, serviceItemId: null };
}

/** Detay satırındaki kart etiketi: hizmet satırı hizmet kartını, ürün satırı ürün kartını gösterir; açıklama satırı yok. */
export function lineCardLabel(l: {
  lineType?: InvoiceLineType | null;
  item?: { code: string; name: string } | null;
  serviceItem?: { code: string; name: string } | null;
}): string | null {
  if (l.lineType === "SERVICE") return l.serviceItem ? `Hizmet · ${l.serviceItem.code} · ${l.serviceItem.name}` : null;
  if (l.lineType === "TEXT") return null;
  return l.item ? `${l.item.code} · ${l.item.name}` : null;
}
