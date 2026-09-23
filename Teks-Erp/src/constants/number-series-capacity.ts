// =============================================================================
// NUMARA SERİSİ — KOD KOLONU KAPASİTESİ (ölçülmüş envanter, 2026-09-23)
// =============================================================================
// Katalogdan AYRI bir dosya, çünkü bu bir KURAL değil ENVANTERDİR: her satır
// `schema.prisma`daki bir `@db.VarChar(n)`in kopyasıdır ve bekçi
// (`test_number_series_panel §7`) ikisinin AYRIŞMADIĞINI ölçer.
//
// ⭐ NEDEN VAR — ÖLÇÜLMÜŞ BİR AÇIK: biçim kapısı haneyi 1..8 arasında kabul
//    ediyordu ama hedef KOLONUN genişliğine hiç bakmıyordu. `packingLotCode`
//    bugün panelden düzenlenebilen üç seriden biri ve `PackingGroup.code`
//    `VarChar(16)`: ön ek `PRT-2609-` (9) + 8 hane = 17 karakter ⇒ o ayarla
//    üretilen HER kod kolona sığmaz ve sevk partisi açılamaz hâle gelirdi.
//    Ölçüldü (2026-09-23): kapı bu biçimi GEÇİRİYORDU.
//
// ⚠️ PAYLAR ÖLÇÜLDÜ ve %90 TÜKENME UYARISINA GİRMİYORLAR: 50 serinin 49'unda
//    kolonda 18–61 FAZLA HANE var (sıra 10^18 katına çıkmadan dolmaz), yalnız
//    `packingLotCode`ta 3 fazla hane. Yani kapasite gerçek bir SERT SINIR ama
//    pratik bir TÜKENME riski değil — bu yüzden KAPI olarak duruyor, uyarı
//    olarak değil. Kullanılmayan uyarı gürültüdür.
// =============================================================================

/**
 * Seri anahtarı → kod kolonunun karakter kapasitesi.
 *
 * ⚠️ Anahtarı OLMAYAN seri = kolon sınırsız (`TEXT`) ya da sayım kaynağı yok.
 * Kapı böyle bir seride kapasite kontrolü YAPMAZ — "bilmiyorum" hâlinde
 * reddetmek, gerçekten sınırsız olan `DirectShipment.shipmentNo`yu boşuna
 * daraltırdı.
 */
export const NUMBER_SERIES_CODE_CAPACITY: Readonly<Record<string, number>> = {
  workOrder: 64, // workOrder.workOrderNumber
  swatch: 64, // swatch.cardNumber
  sack: 64, // sack.sackNo
  shipment: 64, // shipment.shipmentNo
  subcontractorDispatch: 64, // subcontractorDispatch.dispatchNo
  subcontractorReceipt: 64, // subcontractorReceipt.receiptNo
  kartelaDispatch: 64, // kartelaDispatch.dispatchNo
  kartelaReceipt: 64, // kartelaReceipt.receiptNo
  packingLotCode: 16, // packingGroup.code   ⚠️ EN DAR PAY: 3 fazla hane
  packingLotName: 64, // packingGroup.name
  returnDoc: 64, // rollReturn.returnNo
  // directShipment: DirectShipment.shipmentNo — `@db.VarChar` YOK (TEXT), sınır yok.
  manifest: 64, // manifest.manifestNo
  order: 64, // order.orderNumber
  roll: 64, // roll.barcode — 2026-09-23'te seri açıldı, kolon kapasitesi kapıya girdi
  batchDaily: 64, // batch.batchNumber
  batchShort: 64, // batch.batchNumber (aynı kolon; iki rejim BİRBİRİNİ DIŞLAR)
  weavingOrder: 64, // weavingOrder.weavingOrderNumber
  warpBeam: 32, // warpBeam.beamNo
  doffEvent: 32, // doffEvent.code
  goodsReceipt: 32, // goodsReceipt.receiptNo
  purchaseOrder: 32, // purchaseOrder.orderNo
  warehouseTransfer: 32, // warehouseTransfer.transferNo
  stockCount: 32, // stockCount.countNo
  freeDocument: 64, // freeDocument.documentNo
  invoiceSales: 32, // invoice.docNo
  invoicePurchase: 32, // invoice.docNo
  invoiceSalesReturn: 32, // invoice.docNo
  invoicePurchaseReturn: 32, // invoice.docNo
  paymentIn: 32, // payment.docNo
  paymentOut: 32, // payment.docNo
  cashTransaction: 32, // cashTransaction.docNo
  chequeReceived: 32, // cheque.docNo
  chequeIssued: 32, // cheque.docNo
  noteReceived: 32, // cheque.docNo
  noteIssued: 32, // cheque.docNo
  chequeDeliveryNote: 32, // chequeDeliveryNote.docNo
  reconciliationLetter: 32, // reconciliationLetter.docNo
  customer: 32, // customer.code
  subcontractor: 32, // subcontractor.code
  subcontractorCategory: 32, // subcontractorCategory.code
  fabricProperty: 32, // fabricProperty.code
  item: 32, // item.code
  color: 32, // color.code
  station: 32, // station.code
  machine: 32, // machine.code
  cashAccount: 32, // cashBox.code
  bankAccount: 32, // bankAccount.code
  returnReason: 32, // returnReason.code
  productRecipe: 32, // productRecipe.code
  defectType: 32, // defectType.code
  warehouse: 32, // warehouse.code
  routeTemplate: 32, // route.code
};
