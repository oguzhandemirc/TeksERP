// Satır işareti kayıt türleri — backend `Teks-Erp/src/constants/row-mark-entities.ts` anahtarlarının AYNASI
// (izin eşlemesi sunucuda; bekçi `test_row_marks` §0 iki listeyi karşılaştırır).
export const ROW_MARK_ENTITIES = [
  "order",
  "shipment",
  "customer",
  "roll",
  "workOrder",
  "weavingOrder",
  "goodsReceipt",
  "purchaseOrder",
  "invoice",
  "quote",
  "incomingDocument",
] as const;

export type RowMarkEntity = (typeof ROW_MARK_ENTITIES)[number];
