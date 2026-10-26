// =============================================================================
// Belge veri sözleşmesi KAYDI — docType başına TEK satır, docType adına göre ALFABETİK.
// =============================================================================
// Yeni belge türü (port dilimi, teklif, muayene raporu…) yalnız kendi satırını ekler;
// çakışmada iki satır da korunur. Okuma `kayit.ts` üzerinden yapılır (bekçi sırayı ölçer).
// =============================================================================

export { chequeDeliveryNoteContract } from "./cheque-delivery-note"; // CHEQUE_DELIVERY_NOTE
export { freeDocumentContract } from "./free-document"; // FREE_DOCUMENT
export { goodsReceiptContract } from "./goods-receipt"; // GOODS_RECEIPT
export { inspectionReportContract } from "./inspection-report"; // INSPECTION_REPORT
export { invoiceInternalContract } from "./invoice-internal"; // INVOICE_INTERNAL
export { kartelaDispatchContract } from "./kartela-dispatch"; // KARTELA_DISPATCH
export { paymentReceiptContract } from "./payment-receipt"; // PAYMENT_RECEIPT
export { priceListContract } from "./price-list"; // PRICE_LIST
export { qualityCertificateContract } from "./quality-certificate"; // QUALITY_CERTIFICATE
export { reconciliationLetterContract } from "./reconciliation-letter"; // RECONCILIATION_LETTER
export { returnDispatchContract } from "./return-dispatch"; // RETURN_DISPATCH
export { salesQuoteContract } from "./sales-quote"; // SALES_QUOTE
export { shipmentDispatchContract } from "./shipment-dispatch"; // SHIPMENT_DISPATCH
export { stockCountContract } from "./stock-count"; // STOCK_COUNT
export { subcontractorDirectShipContract } from "./subcontractor-direct-ship"; // SUBCONTRACTOR_DIRECT_SHIP
export { subcontractorDispatchContract } from "./subcontractor-dispatch"; // SUBCONTRACTOR_DISPATCH
export { subcontractorReceiptContract } from "./subcontractor-receipt"; // SUBCONTRACTOR_RECEIPT
export { transferDispatchContract } from "./transfer-dispatch"; // TRANSFER_DISPATCH
export { travelerCardContract } from "./traveler-card"; // TRAVELER_CARD
