// =============================================================================
// Sistem şablonu Liquid eşleniği KAYDI — docType başına TEK satır, ALFABETİK.
// =============================================================================
// T1B dizini açtı; eşlenikleri port dilimleri ekler (T6: sevk irsaliyesi). Okuma `kayit.ts` üzerinden yapılır.
// Satır biçimi: `export { shipmentDispatchSystem } from "./shipment-dispatch"; // SHIPMENT_DISPATCH`
// Port kalıbı: sözleşme (`sozlesme/<doc>.ts`) + `sistem/<doc>.ts` (Liquid `html`, `css(ayar)` ve
// `pageSettings(ayar)` — Liquid'de aritmetik yok, stil ayardan üretilir — + `variants`) + iki
// index satırı (burası + `scripts/test_belge_sistem_esdegeri.ts` RENDERERS); eşitlik yeşil olmalı.
// =============================================================================

export { chequeDeliveryNoteSystem } from "./cheque-delivery-note"; // CHEQUE_DELIVERY_NOTE
export { freeDocumentSystem } from "./free-document"; // FREE_DOCUMENT
export { goodsReceiptSystem } from "./goods-receipt"; // GOODS_RECEIPT
export { inspectionReportSystem } from "./inspection-report"; // INSPECTION_REPORT
export { invoiceInternalSystem } from "./invoice-internal"; // INVOICE_INTERNAL
export { kartelaDispatchSystem } from "./kartela-dispatch"; // KARTELA_DISPATCH
export { paymentReceiptSystem } from "./payment-receipt"; // PAYMENT_RECEIPT
export { priceListSystem } from "./price-list"; // PRICE_LIST
export { qualityCertificateSystem } from "./quality-certificate"; // QUALITY_CERTIFICATE
export { reconciliationLetterSystem } from "./reconciliation-letter"; // RECONCILIATION_LETTER
export { returnDispatchSystem } from "./return-dispatch"; // RETURN_DISPATCH
export { salesQuoteSystem } from "./sales-quote"; // SALES_QUOTE
export { shipmentDispatchSystem } from "./shipment-dispatch"; // SHIPMENT_DISPATCH
export { stockCountSystem } from "./stock-count"; // STOCK_COUNT
export { subcontractorDirectShipSystem } from "./subcontractor-direct-ship"; // SUBCONTRACTOR_DIRECT_SHIP
export { subcontractorDispatchSystem } from "./subcontractor-dispatch"; // SUBCONTRACTOR_DISPATCH
export { subcontractorReceiptSystem } from "./subcontractor-receipt"; // SUBCONTRACTOR_RECEIPT
export { transferDispatchSystem } from "./transfer-dispatch"; // TRANSFER_DISPATCH
export { travelerCardSystem } from "./traveler-card"; // TRAVELER_CARD
