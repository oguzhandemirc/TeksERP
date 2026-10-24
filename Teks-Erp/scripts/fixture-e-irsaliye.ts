// =============================================================================
// e-İrsaliye XML bekçisinin girdileri (`test_` öneki YOK → koşucu test saymaz).
// Kimlikler UYDURMADIR (sağlaması tutan kurgu VKN'ler, NVİ'nin test TCKN'si
// 10000000146); gerçek kişi/firma verisi yoktur.
// =============================================================================
import type { PartyInput } from "../src/services/e-irsaliye/despatch-advice.types";
import type { MapSnapshotArgs } from "../src/services/e-irsaliye/despatch-advice.source";
import { NUMBER_ROUNDING_HALF_UP } from "../src/services/document-render/fmt-num";
import type { ShipmentDispatchDoc } from "../src/services/document-render/shipment-dispatch.html";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";

export const SUPPLIER: PartyInput = {
  taxId: "4721003456",
  name: "Örnek Dokuma Sanayi ve Ticaret A.Ş.",
  taxOffice: "Uludağ",
  address: {
    streetName: "Organize Sanayi Bölgesi Mavi Cadde",
    buildingNumber: "12",
    citySubdivisionName: "Nilüfer",
    cityName: "Bursa",
    postalZone: "16140",
    countryName: "Türkiye",
  },
  mersisNo: "0472100345600015",
  tradeRegistryNo: "123456",
  telephone: "+90 224 000 00 00",
  email: "irsaliye@ornek-dokuma.test",
};

type Product = ShipmentDispatchDoc["products"][number];

export function dispatchDoc(over: {
  customerName: string;
  taxNumber: string | null;
  orderNos?: string;
  products: Product[];
  totalKg?: number;
  sackCount?: number;
  manualSackCount?: number | null;
}): ShipmentDispatchDoc {
  const totalRolls = over.products.reduce((a, p) => a + p.rollCount, 0);
  const totalMeters = over.products.reduce((a, p) => a + p.totalMeters, 0);
  return {
    header: {
      shipmentNo: "SVK-2026-0042",
      customerName: over.customerName,
      customerCode: "M001",
      customerTaxNumber: over.taxNumber,
      branchName: null,
      branchCode: null,
      procedureCode: null,
      destination: "DOMESTIC",
      status: "DISPATCHED",
      date: "2026-10-24",
      plateNumber: null,
      driverName: null,
      carrier: null,
      orderNos: over.orderNos ?? "",
    },
    products: over.products,
    sacks: [],
    cekiRows: [],
    totals: {
      totalRolls,
      totalMeters,
      totalKg: over.totalKg ?? 0,
      sackCount: over.sackCount ?? 0,
      manualSackCount: over.manualSackCount ?? null,
    },
  };
}

export function envelope(doc: ShipmentDispatchDoc, rounding: "HALF_UP" | "LEGACY" = "HALF_UP"): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: "2026-10-24T07:50:06.000Z",
    company: { name: "Örnek Dokuma", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: null,
    doc: doc as unknown as Record<string, unknown>,
    ...(rounding === "HALF_UP" ? { numberRounding: NUMBER_ROUNDING_HALF_UP } : {}),
  };
}

/** İstanbul'da 2026-10-24 11:15:30 (düzenleme) · 2026-10-24 01:30:00 (sevk — UTC'de önceki gün). */
export const NOW = new Date("2026-10-24T08:15:30.000Z");
export const DISPATCHED_AT = new Date("2026-10-23T22:30:00.000Z");

const ADDRESS = { streetName: "Atatürk Bulvarı No:5", citySubdivisionName: "Merkezefendi", cityName: "Denizli", postalZone: "20010", countryName: null };

export const GOLDEN_CASES: ReadonlyArray<{ file: string; args: MapSnapshotArgs }> = [
  {
    file: "vkn-alici.xml",
    args: {
      snapshot: envelope(
        dispatchDoc({
          customerName: "Deniz Konfeksiyon Ltd. Şti.",
          taxNumber: "5550001112",
          orderNos: "SP-2026-0101, SP-2026-0102",
          products: [
            { name: "LİNEN EKRU 150cm.", customerName: "BS-6650 EKRU", rollCount: 3, totalMeters: 312.35 },
            { name: "PANAMA SİYAH 160cm.", customerName: null, rollCount: 2, totalMeters: 198 },
          ],
          totalKg: 142.455,
          sackCount: 5,
          manualSackCount: 6,
        }),
      ),
      supplier: SUPPLIER,
      record: {
        documentNo: "EIR2026000000001",
        ettn: "3f1c2a9e-7b4d-4c1e-9a6f-0d2b8e5c7a11",
        licensePlate: "16 abc 123",
        driverFirstName: "Ali",
        driverFamilyName: "Örnek",
        driverNationalId: "10000000146",
      },
      recipient: { taxOffice: "Pamukkale", address: ADDRESS },
      nameMode: "bizdeki",
      shipmentDestination: "DOMESTIC",
      dispatchNote: "Rampa 2'den yüklendi",
      now: NOW,
      dispatchedAt: DISPATCHED_AT,
    },
  },
  {
    file: "tckn-alici.xml",
    args: {
      snapshot: envelope(
        dispatchDoc({
          customerName: "Ayşe Örnek Tekstil",
          taxNumber: "10000000146",
          products: [{ name: "KETEN BEYAZ", customerName: "K-100 BEYAZ", rollCount: 1, totalMeters: 87.5 }],
          sackCount: 1,
        }),
      ),
      supplier: SUPPLIER,
      record: {
        documentNo: "EIR2026000000002",
        ettn: "8a2b4c6d-1e3f-4a5b-8c7d-9e0f1a2b3c4d",
        licensePlate: "16XYZ99",
        driverFirstName: "Veli",
        driverFamilyName: "Deneme",
        driverNationalId: "10000000146",
        recipientFirstName: "Ayşe",
        recipientFamilyName: "Örnek",
      },
      recipient: { taxOffice: null, address: { citySubdivisionName: "Osmangazi", cityName: "Bursa" } },
      nameMode: "musterideki",
      shipmentDestination: "DOMESTIC",
      now: NOW,
      dispatchedAt: DISPATCHED_AT,
    },
  },
  {
    file: "tasiyicili.xml",
    args: {
      snapshot: envelope(
        dispatchDoc({
          customerName: "Ege Giyim A.Ş.",
          taxNumber: "5550001112",
          products: [{ name: "GABARDİN LACİVERT", customerName: "EG-77 NAVY", rollCount: 4, totalMeters: 400.004 }],
          totalKg: 210,
          sackCount: 2,
        }),
      ),
      supplier: SUPPLIER,
      record: {
        documentNo: "EIR2026000000003",
        ettn: "c0ffee00-1234-4abc-8def-0123456789ab",
        trailerPlate: "16 DR 4088",
        carrierName: "Hızlı Nakliyat Ltd. Şti.",
        carrierTaxId: "9876543217",
      },
      recipient: { taxOffice: "Ege", address: { streetName: "Liman Cad.", citySubdivisionName: "Konak", cityName: "İzmir", countryName: "Türkiye" } },
      nameMode: "ikisi",
      shipmentDestination: "DOMESTIC",
      now: NOW,
      dispatchedAt: DISPATCHED_AT,
    },
  },
  {
    file: "cok-satirli-ozel-karakter.xml",
    args: {
      snapshot: envelope(
        dispatchDoc({
          customerName: `Çağrı & Şükrü "Örme" <Tekstil>`,
          taxNumber: "5550001112",
          orderNos: "SP-1 & SP-2",
          products: [
            { name: "R&D KUMAŞ <TEST>", customerName: null, rollCount: 1, totalMeters: 10 },
            { name: "ĞÜŞİÖÇ ğüşıöç", customerName: "Müşteri's 'adı'", rollCount: 2, totalMeters: 20.5 },
            { name: "PAMUK > POLY", customerName: null, rollCount: 3, totalMeters: 30.25 },
            { name: "ÇİZGİLİ GÖMLEKLİK", customerName: null, rollCount: 1, totalMeters: 1.005 },
          ],
          totalKg: 55.5,
          sackCount: 4,
        }),
        "LEGACY",
      ),
      supplier: SUPPLIER,
      record: {
        documentNo: "EIR2026000000004",
        ettn: "11111111-2222-4333-8444-555555555555",
        licensePlate: "35TT001",
        driverFirstName: "Şükrü",
        driverFamilyName: "Çağlayan",
        driverNationalId: "10000000146",
      },
      recipient: { taxOffice: "Kordon & Alsancak", address: { streetName: "1453 Sk. <Arka>", citySubdivisionName: "Bornova", cityName: "İzmir" } },
      nameMode: "bizdeki",
      shipmentDestination: "DOMESTIC",
      dispatchNote: `Kırılacak eşya yok; "dikkat" & <özen>`,
      now: NOW,
      dispatchedAt: DISPATCHED_AT,
    },
  },
];
