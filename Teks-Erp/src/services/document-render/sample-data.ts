// =============================================================================
// Belge Şablonu önizlemesi — örnek (mock) belge payload'ları (TEK KAYNAK)
// =============================================================================
// "Tanımlar → Belge Şablonları" panelinde admin içerik ayarını (bölüm aç/kapa,
// başlık, künye, imza, footer) düzenlerken sağda CANLI önizleme görür. Önizleme
// artık client React sheet'i değil, GERÇEK backend renderer'ının (renderHtml)
// bu örnek veriyle + taslak config override ile ürettiği HTML → önizleme baskıyla
// birebir aynı. Her payload ilgili renderHtml'in beklediği `doc` şeklindedir.
// =============================================================================

import { PrintedDocType } from "@prisma/client";

const ISO = "2026-06-07T10:30:00.000Z";

/** docType → renderHtml'in okuduğu örnek `doc`. Gerçek sevk verisi DEĞİL. */
export const SAMPLE_PRINTED_DOCS: Record<PrintedDocType, Record<string, unknown>> = {
  // Sevk İrsaliyesi / muhasebe fişi (renderShipmentDispatchHtml).
  SHIPMENT_DISPATCH: {
    header: {
      shipmentNo: "SVK-2026-0042",
      customerName: "Örnek Tekstil A.Ş.",
      customerCode: "M001",
      customerTaxNumber: "1234567890",
      branchName: "Merkez Şube",
      branchCode: "IST-01",
      procedureCode: null,
      destination: "DOMESTIC",
      status: "DISPATCHED",
      date: ISO,
      plateNumber: "34 ABC 123",
      driverName: "Mehmet Yılmaz",
      carrier: "Hızlı Nakliyat",
      orderNos: "SIP-2026-0107",
    },
    products: [
      { name: "Pamuklu Astar · Bej", rollCount: 3, totalMeters: 480 },
      { name: "Süet Kumaş · Antrasit", rollCount: 2, totalMeters: 200 },
    ],
    sacks: [
      { code: "Ç-01", seq: 1, totalMeters: 480, totalKg: 42.5, packageCount: 3 },
      { code: "Ç-02", seq: 2, totalMeters: 200, totalKg: 31, packageCount: 2 },
    ],
    cekiRows: [
      { sackCode: "Ç-01", barcode: "TR-260607-R0200", desen: "Pamuklu Astar", varyant: "Bej / 150 cm", meters: 480, kg: 42.5 },
      { sackCode: "Ç-02", barcode: "TR-260607-R0201", desen: "Süet Kumaş", varyant: "Antrasit / 140 cm", meters: 200, kg: 31 },
    ],
    totals: { totalRolls: 5, totalMeters: 680, totalKg: 73.5, sackCount: 2 },
  },

  // Fason Sevk / KUMAŞ İRSALİYESİ (renderFasonCekiHtml) — toplar ham gider.
  SUBCONTRACTOR_DISPATCH: {
    dispatchNo: "FSN-2026-0231",
    dispatchedAt: ISO,
    driverName: "Ali Demir",
    plateNumber: "16 XYZ 789",
    notes: "Acele — bugün dönüş bekleniyor",
    workOrder: { id: "wo1", workOrderNumber: "IE1207260001", type: "STOCK_PRODUCTION" },
    subcontractor: { id: "sub1", name: "Yıldız Boyahane", code: "FB-03" },
    requestedColor: "Bej",
    instruction: "Yıkama yapma, matlaştır",
    step: { stepSequence: 2, station: { name: "Boyahane (Fason)", code: "DYE" } },
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0123", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: null, colorName: null, dispatchedQty: 240, dispatchedWeight: 38, qualityGrade: "A", width: 150 },
      { sequence: 2, barcode: "TR-260607-R0124", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: null, colorName: null, dispatchedQty: 260, dispatchedWeight: 41, qualityGrade: "A", width: 150 },
    ],
    totals: { rollCount: 2, totalQty: 500, totalWeight: 79 },
  },

  // Fasondan Doğrudan Sevk İrsaliyesi (renderFasonDirectShipHtml).
  SUBCONTRACTOR_DIRECT_SHIP: {
    directShip: true,
    dispatchNo: "DSF-2026-0012",
    directShippedAt: ISO,
    directShipReason: "Müşteri acil talep — fabrikaya dönmeden sevk",
    directShippedBy: "Ayşe Kaya",
    dispatchedAt: ISO,
    driverName: "Ali Demir",
    plateNumber: "16 XYZ 789",
    notes: null,
    customer: { id: "cus1", name: "Örnek Tekstil A.Ş.", code: "M001", taxNumber: "1234567890", branchName: "Merkez Şube", branchCode: "IST-01" },
    workOrder: { id: "wo1", workOrderNumber: "IE1207260001", type: "ORDER_PRODUCTION" },
    subcontractor: { id: "sub1", name: "Yıldız Boyahane", code: "FB-03" },
    step: { id: "st1", stepSequence: 2, station: { name: "Boyahane (Fason)", code: "DYE" } },
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0123", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 240, dispatchedWeight: 38, qualityGrade: "A", width: 150 },
      { sequence: 2, barcode: "TR-260607-R0124", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 260, dispatchedWeight: 41, qualityGrade: "A", width: 150 },
    ],
    allocations: [
      { orderNumber: "SIP-2026-0107", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorName: "Bej", qty: 500 },
    ],
    totals: { rollCount: 2, totalQty: 500, totalWeight: 79 },
  },

  // Kartela Çeki Listesi (renderKartelaCekiHtml).
  KARTELA_DISPATCH: {
    dispatchNo: "KRT-2026-0058",
    dispatchedAt: ISO,
    driverName: "Hasan Kaya",
    plateNumber: "06 KRT 060",
    notes: null,
    subcontractor: { id: "ks1", name: "Desen Kartela", code: "KF-01" },
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0200", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 6, dispatchedWeight: 1.2, qualityGrade: "A", width: 150 },
      { sequence: 2, barcode: "TR-260607-R0201", itemCode: "KMS-014", itemName: "Süet Kumaş", colorCode: "ANT", colorName: "Antrasit", dispatchedQty: 6, dispatchedWeight: 1.1, qualityGrade: "B", width: 140 },
    ],
    totals: { rollCount: 2, totalQty: 12, totalWeight: 2.3 },
  },
};
