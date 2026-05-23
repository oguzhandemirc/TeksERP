import { LabelKind } from "@/services/labelTemplateService";

export interface MockTableRow {
  code: string;
  name: string;
  colorName: string;
  qty: number;
  weightKg: number;
}

export type MockValue = string | number | MockTableRow[] | null;

export type MockLabelData = Record<string, MockValue>;

const ROLL_MOCK: MockLabelData = {
  barcode: "TR-2026-05-23-R0481",
  qrCode: "TR-2026-05-23-R0481",
  itemName: "Pamuk Astar 60s",
  itemNameDefault: "Cotton Lining 60s",
  itemCode: "PA-60S",
  colorName: "Bej",
  colorNameDefault: "Beige",
  colorCode: "BJ-12",
  qualityGrade: "1. Kalite",
  widthCm: 152,
  lengthMeters: 47.5,
  weightKg: 14.8,
  customerName: "Demo Tekstil A.Ş.",
  orderNumber: "SIP-2026-00123",
  batchNumber: "PRT-A24",
  packagingDate: "2026-05-23",
  printedAt: "2026-05-23T14:32",
};

const SWATCH_MOCK: MockLabelData = {
  barcode: "TR-SW-2026-05-23-0098",
  qrCode: "TR-SW-2026-05-23-0098",
  cardNumber: "K-2026-098",
  itemName: "Velvet 220",
  itemNameDefault: "Kadife 220",
  itemCode: "VL-220",
  colorName: "Petrol Mavisi",
  colorNameDefault: "Petrol",
  colorCode: "PM-08",
  widthCm: 30,
  lengthCm: 20,
  weightKg: 0.18,
  customerName: "Demo Tekstil A.Ş.",
  batchNumber: "VL-2026-09",
  parentRollBarcode: "TR-2026-05-20-R0412",
  printedAt: "2026-05-23T11:08",
};

const SHIPMENT_MOCK: MockLabelData = {
  shipmentNumber: "İRS-2026-00045",
  shippedAt: "2026-05-23",
  customerName: "Demo Tekstil A.Ş.",
  customerCode: "MS-001",
  branchName: "Merter Şube",
  driverName: "Mehmet Yılmaz",
  plateNumber: "34 ABC 1234",
  carrier: "Yıldız Nakliyat",
  items: [
    { code: "PA-60S", name: "Pamuk Astar 60s", colorName: "Bej", qty: 12, weightKg: 178.4 },
    { code: "VL-220", name: "Velvet 220", colorName: "Petrol", qty: 8, weightKg: 92.5 },
    { code: "JK-90", name: "Jakar 90s", colorName: "Antrasit", qty: 5, weightKg: 47.2 },
  ] satisfies MockTableRow[],
  totals: "25 top · 318.1 kg",
};

export const MOCK_DATA: Record<LabelKind, MockLabelData> = {
  ROLL: ROLL_MOCK,
  SWATCH: SWATCH_MOCK,
  SHIPMENT_DOCKET: SHIPMENT_MOCK,
};
