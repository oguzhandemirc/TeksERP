// =============================================================================
// Belge veri sözleşmesi KAYDI — docType başına TEK satır, docType adına göre ALFABETİK.
// =============================================================================
// Yeni belge türü (port dilimi, teklif, muayene raporu…) yalnız kendi satırını ekler;
// çakışmada iki satır da korunur. Okuma `kayit.ts` üzerinden yapılır (bekçi sırayı ölçer).
// =============================================================================

export { goodsReceiptContract } from "./goods-receipt"; // GOODS_RECEIPT
export { kartelaDispatchContract } from "./kartela-dispatch"; // KARTELA_DISPATCH
export { qualityCertificateContract } from "./quality-certificate"; // QUALITY_CERTIFICATE
export { shipmentDispatchContract } from "./shipment-dispatch"; // SHIPMENT_DISPATCH
export { stockCountContract } from "./stock-count"; // STOCK_COUNT
export { subcontractorDirectShipContract } from "./subcontractor-direct-ship"; // SUBCONTRACTOR_DIRECT_SHIP
export { subcontractorDispatchContract } from "./subcontractor-dispatch"; // SUBCONTRACTOR_DISPATCH
export { subcontractorReceiptContract } from "./subcontractor-receipt"; // SUBCONTRACTOR_RECEIPT
export { transferDispatchContract } from "./transfer-dispatch"; // TRANSFER_DISPATCH
