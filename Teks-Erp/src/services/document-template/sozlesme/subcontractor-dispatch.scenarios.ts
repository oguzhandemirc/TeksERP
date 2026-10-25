// =============================================================================
// SUBCONTRACTOR_DISPATCH sözleşmesi — senaryolar (`sample-data.ts` kopyasından)
// =============================================================================
// Zorunlu altıya ek: `taslak` (fason çeki taslağı — aynı şablon, TASLAK üst katmanı),
// `talimat_eksik` (uyarı satırı) ve `en_999` (D8 sınır vakası).
// =============================================================================

import { longText, sampleDoc, sampleEnvelope } from "./senaryolar";
import type { Scenario } from "./tipler";

type Row = Record<string, unknown>;

const roll = (i: number, qty: number, ek: Row = {}): Row => ({
  sequence: i, barcode: `TR-260607-R${String(100 + i).padStart(4, "0")}`, itemCode: "KMS-001", itemName: "Pamuklu Astar",
  colorCode: null, colorName: null, dispatchedQty: qty, dispatchedWeight: 38, qualityGrade: "A", width: 150, ...ek,
});

export function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("SUBCONTRACTOR_DISPATCH");
  const wo = (d: Row) => d.workOrder as Row;

  const single = base();
  single.rolls = [roll(1, 240)];
  single.totals = { rollCount: 1, totalQty: 240, totalWeight: 38 };
  single.commands = { color: "Lacivert", works: [] };

  // 120 top: varsayılan 5 × 10 ızgarada üç sayfa; kesirli/binlik metre, değerli ve boş adlı işlem.
  const multi = base();
  multi.rolls = Array.from({ length: 120 }, (_, i) =>
    roll(i + 1, i === 0 ? 1234.56 : i % 7 === 0 ? 100.25 : i % 11 === 0 ? 0 : 100 + i / 2, {
      itemName: i % 40 === 0 ? "Süet Kumaş" : " Pamuklu Astar ",
      colorName: i % 30 === 0 ? "Antrasit" : null,
    }),
  );
  multi.totals = { rollCount: 120, totalQty: 13580.06, totalWeight: 4560 };
  multi.commands = { color: "Bej", works: [{ name: "Şardon", value: "2 tur" }, { name: "Apre", value: null }, { name: "  ", value: "x" }, { name: "Çekmezlik" }] };

  // Eski donmuş çekinin şekli: talimat kutusu, parti, en, renk, talimat, araç yok; metre 0.
  const empty: Row = {
    dispatchNo: "FSN-2026-0232", dispatchedAt: null, driverName: null, plateNumber: null, notes: null,
    workOrder: { id: "wo2", workOrderNumber: "IE-ESKI-0001", type: "STOCK_PRODUCTION" },
    subcontractor: { id: "sub2", name: "Boş Alanlı Fasoncu", code: null },
    step: { stepSequence: 1, station: { name: "Zımpara (Fason)", code: "ZMP" } },
    rolls: [roll(1, 0, { barcode: null, dispatchedWeight: null, width: null })],
    totals: { rollCount: 1, totalQty: 0, totalWeight: 0 },
  };

  // Uzun metin + eski "İSTENEN ÖZELLİKLER" dalı (talimat kutusu yok, hedef özellikler var).
  const long = base();
  delete long.commands;
  long.subcontractor = { id: "sub3", name: longText("Çok Uzun Unvanlı Boyahane Apre Terbiye Sanayi"), code: "FB-<03>" };
  long.instruction = longText("Yıkama yapma, matlaştır; kenarları kontrol et");
  long.notes = longText("Acele — bugün dönüş bekleniyor");
  long.targetProperties = ["Yanmazlık Apresi", longText("Su İtici", 60), "  "];
  long.requestedColor = longText("Koyu Lacivert", 40);
  long.rolls = [roll(1, 240, { itemName: longText("Süet Kumaş", 100), colorName: "Gri" }), roll(2, 260.5, { colorName: "Gri" })];
  long.batchNumber = "P<1207261>&";

  const missing = base();
  missing.commands = { color: "  ", works: [{ name: " " }] };
  missing.instruction = "   ";
  missing.targetProperties = [];

  const width999 = base();
  wo(width999).width = 999.4;

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek fason çekisi", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top, yalnız boyanacak renk", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "120 top — ızgara üç sayfa; karışık kumaş/renk, değerli işlemler",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Eski donmuş çeki: opsiyonel alanların tümü boş/eksik", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; eski istenen özellikler kutusu", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış fasoncu" } },
    },
    {
      ad: "taslak",
      aciklama: "Fason çeki TASLAĞI (sevk öncesi canlı önizleme) — TASLAK üst katmanla basılır",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { taslak: true } },
    },
    { ad: "talimat_eksik", aciklama: "Talimat kutusu var ama boş — uyarı satırı basılır", snapshot: sampleEnvelope(missing) },
    { ad: "en_999", aciklama: "En sınırı: iş emri eni 999,4 cm (binlik ayracı yok)", snapshot: sampleEnvelope(width999) },
  ];
}
