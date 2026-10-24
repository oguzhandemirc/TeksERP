// =============================================================================
// SHIPMENT_DISPATCH sözleşmesi — zorunlu senaryolar (`sample-data.ts` kopyasından)
// =============================================================================

import { asObject, asRows } from "./ortak";
import { longText, sampleDoc, sampleEnvelope, sampleSeriesCode } from "./senaryolar";
import type { DispatchLiveOptions } from "./shipment-dispatch.fields";
import type { Scenario } from "./tipler";

type Row = Record<string, unknown>;

/** 45 çuval × 3 top — çeki listesi birden çok sayfaya taşar. */
function multiPageDoc(): Row {
  const multi = sampleDoc("SHIPMENT_DISPATCH");
  const multiSacks: Row[] = [];
  const multiCeki: Row[] = [];
  for (let i = 1; i <= 45; i++) {
    const code = sampleSeriesCode("sack", i);
    const group = Math.ceil(i / 10);
    const lotCode = sampleSeriesCode("packingLotCode", group);
    multiSacks.push({
      code, seq: i, totalMeters: 300 + i, totalKg: 40 + i / 4, packageCount: 3,
      packageNo: i, packingGroupName: `P-${group}`, packingGroupCode: lotCode,
    });
    for (let j = 0; j < 3; j++) {
      multiCeki.push({
        sackCode: code, seq: i, packageNo: i, packingGroupName: `P-${group}`, packingGroupCode: lotCode,
        barcode: `R${i * 10 + j}`, desen: "Linen", varyant: "Ekru", customerDesen: "BS-6650", customerVaryant: j ? "EKRU" : null,
        width: 150 + j, meters: j === 0 ? 100 + i : 100, kg: j === 0 ? 40 + i / 4 : 0, batchNumber: `P0925${String(i).padStart(3, "0")}`,
      });
    }
  }
  multi.products = [
    { name: "Linen 330cm.", customerName: "BS-6650 EKRU 330cm.", customerItemOnly: "BS-6650 330cm.", customerColorOnly: "EKRU", rollCount: 90, totalMeters: 9500.5 },
    { name: "Saten Siyah 150cm.", customerName: null, customerItemOnly: null, customerColorOnly: null, rollCount: 45, totalMeters: 4535 },
  ];
  multi.sacks = multiSacks;
  multi.cekiRows = multiCeki;
  multi.sackSeqPrefix = "SP";
  multi.totals = { totalRolls: 135, totalMeters: 14035.5, totalKg: 2058.75, sackCount: 45, manualSackCount: 44 };
  return multi;
}

export function scenarios(): Scenario<DispatchLiveOptions>[] {
  const base = () => sampleDoc("SHIPMENT_DISPATCH");
  const sample = base();
  const hdr = asObject(sample.header);

  const single = base();
  single.products = asRows<Row>(single.products).slice(0, 1);
  single.sacks = asRows<Row>(single.sacks).slice(0, 1);
  single.cekiRows = asRows<Row>(single.cekiRows).slice(0, 1);
  single.totals = { totalRolls: 3, totalMeters: 480, totalKg: 42.5, sackCount: 1 };

  const multi = multiPageDoc();

  // Opsiyonel alanların hepsi boş/eksik — eski donmuş belgenin şekli.
  const empty: Record<string, unknown> = {
    header: {
      shipmentNo: "SVK-2026-0043", customerName: "Boş Alanlı Müşteri", customerCode: null, customerTaxNumber: null,
      branchName: null, branchCode: null, procedureCode: null, destination: "DOMESTIC", status: "DISPATCHED",
      date: null, plateNumber: null, driverName: null, carrier: null, orderNos: "",
    },
    products: [{ name: "Pamuklu Astar · Bej", rollCount: 1, totalMeters: 100 }],
    sacks: [{ code: "Ç-01", seq: 1, totalMeters: 100, totalKg: 0, packageCount: 1 }],
    cekiRows: [{ sackCode: "Ç-01", barcode: null, desen: "Pamuklu Astar", varyant: "Bej", meters: 100, kg: 0 }],
    totals: { totalRolls: 1, totalMeters: 100, totalKg: 0, sackCount: 1 },
  };

  const long = base();
  long.header = {
    ...hdr,
    customerName: longText("Çok Uzun Unvanlı Müşteri Tekstil Konfeksiyon İthalat İhracat"),
    branchName: longText("Organize Sanayi Şubesi", 120),
    destination: "EXPORT",
    procedureCode: "GTIP-5512.19",
    orderNos: Array.from({ length: 30 }, (_, i) => `SIP-2026-${String(i + 100).padStart(4, "0")}`).join(", "),
  };
  long.products = asRows<Row>(long.products).map((p) => ({ ...p, name: longText(String(p.name), 160) }));
  long.cekiRows = asRows<Row>(long.cekiRows).map((c) => ({ ...c, desen: longText(String(c.desen), 120) }));

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek irsaliyesi", snapshot: sampleEnvelope(sample) },
    { ad: "tek_kalem", aciklama: "Tek ürün, tek çuval, tek top", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "45 çuval / 135 top; ad rejimi, sıra, sevk partisi, yorum ve iz açık",
      snapshot: sampleEnvelope(multi),
      ek: {
        canli: {
          itemNameMode: "ikisi", cekiNameMode: "ikisi", productColorSplit: true, packingLot: true,
          sackSeq: { prefix: "SP", showTotal: true },
          rowNotes: { [sampleSeriesCode("sack", 1)]: "Kontrol et", [sampleSeriesCode("sack", 7)]: "Rampa 2" },
          rowTags: { [sampleSeriesCode("sack", 2)]: "Eksik" },
        },
        baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" },
      },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanların tümü boş/eksik", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar, yurtdışı", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Hatalı plaka" } },
    },
  ];
}
