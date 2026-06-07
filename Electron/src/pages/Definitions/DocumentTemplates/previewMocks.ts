// =============================================================================
// Belge Şablonları önizlemesi için örnek (mock) veri. Gerçek belge "sheet"
// bileşenleri (NoteSheet / PrintableSheet / PrintableCeki) bu verilerle render
// edilir; admin taslak ayarı anında bunlar üzerinde görür. Yalnız önizleme amaçlı.
// =============================================================================

import type { ShipmentDetail } from "@/pages/Operations/Shipments/types";
import type { DispatchPrintSnapshot } from "@/pages/Operations/WorkOrders/service";
import type { KartelaDispatchDetail } from "@/pages/Operations/Kartela/service";

const ISO = "2026-06-07T10:30:00.000Z";

/** Sevk İrsaliyesi önizleme verisi — 1 sipariş, 2 çuval (ürün dökümü + kartela). */
export const MOCK_SHIPMENT: ShipmentDetail = {
  id: "preview-shipment",
  shipmentNo: "SVK-2026-0042",
  status: "DISPATCHED",
  plateNumber: "34 ABC 123",
  driverName: "Mehmet Yılmaz",
  carrier: "Hızlı Nakliyat",
  readyAt: ISO,
  dispatchedAt: ISO,
  customer: { id: "c1", code: "M001", name: "Örnek Tekstil A.Ş." },
  branch: { id: "b1", name: "Merkez Şube" },
  orders: [
    {
      id: "o1",
      orderNumber: "SIP-2026-0107",
      status: "PRODUCTION",
      deadline: ISO,
      lines: [
        {
          lineId: "l1",
          item: { id: "i1", code: "KMS-001", name: "Pamuklu Astar" },
          color: { id: "col1", code: "BEJ", name: "Bej" },
          width: 150,
          customerItemName: "Astar (müşteri kodu A-12)",
          customerColorName: "Açık Bej",
          requested: 800,
          shipped: 0,
          openQty: 320,
          thisShipment: 480,
        },
        {
          lineId: "l2",
          item: { id: "i2", code: "KMS-014", name: "Süet Kumaş" },
          color: { id: "col2", code: "ANT", name: "Antrasit" },
          width: 140,
          customerItemName: null,
          customerColorName: null,
          requested: 300,
          shipped: 0,
          openQty: 100,
          thisShipment: 200,
        },
      ],
    },
  ],
  rolls: [],
  swatches: [],
  sacks: [
    {
      id: "s1",
      sackNo: 1,
      seq: 1,
      weightKg: 42.5,
      rolls: [],
      swatches: [],
      rollCount: 3,
      swatchCount: 0,
      productSummary: [
        {
          itemCode: "KMS-001",
          itemName: "Pamuklu Astar",
          colorCode: "BEJ",
          colorName: "Bej",
          width: 150,
          totalQty: 480,
          rollCount: 3,
        },
      ],
    },
    {
      id: "s2",
      sackNo: 2,
      seq: 2,
      weightKg: 31,
      rolls: [],
      swatches: [],
      rollCount: 2,
      swatchCount: 1,
      productSummary: [
        {
          itemCode: "KMS-014",
          itemName: "Süet Kumaş",
          colorCode: "ANT",
          colorName: "Antrasit",
          width: 140,
          totalQty: 200,
          rollCount: 2,
        },
      ],
    },
  ],
  returnedRolls: [],
  summary: {
    rollCount: 5,
    swatchCount: 1,
    totalMeters: 680,
    sackCount: 2,
    totalKg: 73.5,
    returnedCount: 0,
    returnedMeters: 0,
  },
};

/** Fason Sevk İrsaliyesi önizleme verisi. */
export const MOCK_FASON: DispatchPrintSnapshot = {
  dispatchNo: "FSN-2026-0231",
  dispatchedAt: ISO,
  driverName: "Ali Demir",
  plateNumber: "16 XYZ 789",
  notes: "Acele — bugün dönüş bekleniyor",
  workOrder: { id: "wo1", batchNumber: "P-260607-014", parameters: null, type: "STOCK" },
  subcontractor: { id: "sub1", name: "Yıldız Boyahane", code: "FB-03" },
  step: { id: "st1", stepSequence: 2, station: { name: "Boyahane (Fason)", code: "DYE" } },
  rolls: [
    {
      rollId: "r1",
      barcode: "TR-260607-R0123",
      itemCode: "KMS-001",
      itemName: "Pamuklu Astar",
      colorCode: null,
      colorName: null,
      dispatchedQty: 240,
      dispatchedWeight: 38,
      qualityGrade: "A",
      width: 150,
    },
    {
      rollId: "r2",
      barcode: "TR-260607-R0124",
      itemCode: "KMS-001",
      itemName: "Pamuklu Astar",
      colorCode: null,
      colorName: null,
      dispatchedQty: 260,
      dispatchedWeight: 41,
      qualityGrade: "A",
      width: 150,
    },
  ],
  totals: { rollCount: 2, totalQty: 500, totalWeight: 79 },
  requestedColor: { id: "col1", code: "BEJ", name: "Bej", hex: "#d8c9a8" },
  dyehouseNote: "Yıkama yapma, matlaştır",
  woDyehouseNote: null,
  dyehouseNoteLocked: false,
};

/** Kartela Çeki Listesi önizleme verisi. */
export const MOCK_KARTELA: KartelaDispatchDetail = {
  id: "kd1",
  dispatchNo: "KRT-2026-0058",
  dispatchedAt: ISO,
  totalQty: 12,
  plateNumber: "06 KRT 060",
  driverName: "Hasan Kaya",
  notes: null,
  cancelledAt: null,
  cancelReason: null,
  subcontractor: { id: "ks1", name: "Desen Kartela", code: "KF-01" },
  dispatchedBy: null,
  cancelledBy: null,
  items: [
    {
      id: "ki1",
      dispatchedQty: 6,
      dispatchedWeight: 1.2,
      roll: {
        id: "kr1",
        barcode: "TR-260607-R0200",
        currentQty: 6,
        initialQty: 6,
        width: 150,
        weightKg: 1.2,
        qualityGrade: "A",
        item: { code: "KMS-001", name: "Pamuklu Astar" },
        color: { code: "BEJ", name: "Bej" },
      },
    },
    {
      id: "ki2",
      dispatchedQty: 6,
      dispatchedWeight: 1.1,
      roll: {
        id: "kr2",
        barcode: "TR-260607-R0201",
        currentQty: 6,
        initialQty: 6,
        width: 140,
        weightKg: 1.1,
        qualityGrade: "B",
        item: { code: "KMS-014", name: "Süet Kumaş" },
        color: { code: "ANT", name: "Antrasit" },
      },
    },
  ],
  receipts: [],
};
