// =============================================================================
// Belge veri sözleşmesi KAYDI — docType başına TEK satır, docType adına göre ALFABETİK.
// =============================================================================
// Yeni belge türü (port dilimi, teklif, muayene raporu…) yalnız kendi satırını ekler;
// çakışmada iki satır da korunur. Okuma `kayit.ts` üzerinden yapılır (bekçi sırayı ölçer).
// =============================================================================

export { shipmentDispatchContract } from "./shipment-dispatch"; // SHIPMENT_DISPATCH
