// =============================================================================
// SATIR İŞARETİ — kayıt türü kümesi ve her türün OKUMA izni (tek kaynak).
// Güvenlik sınırıdır: türü okuyamayan kişi işaret/notu da okuyamaz/yazamaz (kaydın
// varlığı ve not sızmaz). Tanınmayan tür 400 (fail-closed). Panel aynası:
// Electron/src/lib/row-mark-entities.ts (yalnız anahtarlar). Bekçi: test_row_marks §0.
// =============================================================================

export const ROW_MARK_ENTITY_PERMISSIONS = {
  order: "order:read",
  shipment: "shipping:read",
  customer: "customer:read",
  roll: "roll:read",
  workOrder: "workorder:read",
  weavingOrder: "weavingorder:read",
  goodsReceipt: "goods-receipt:read",
  purchaseOrder: "purchase-order:read",
  invoice: "finance:read",
  quote: "quote:read",
  incomingDocument: "gelen-belge:read",
} as const satisfies Record<string, string>;

export type RowMarkEntity = keyof typeof ROW_MARK_ENTITY_PERMISSIONS;
export const ROW_MARK_ENTITIES = Object.keys(ROW_MARK_ENTITY_PERMISSIONS) as RowMarkEntity[];

export const ROW_MARK_NOTE_MAX = 500;
export const ROW_MARK_LOOKUP_MAX = 200;
