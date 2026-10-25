// TRAVELER_CARD sözleşmesinin senaryoları — panel önizlemesi ve bekçilerin örnek kartları.

import { TERIM } from "../../../constants/terim";
import { envelopeHead } from "../../document-render/envelope-head";
import { SCENARIO_CLOCK, longText, sampleSeriesCode } from "./senaryolar";
import type { Scenario } from "./tipler";
import type { TravelerCardSource } from "./traveler-card";

// ── Senaryolar ─────────────────────────────────────────────────────────────────────────

type Card = TravelerCardSource["card"];
type Step = Card["steps"][number];
type OrderLink = Card["orderLinks"][number];

const step = (n: number, station: string, type: string, [notes, sub]: [string | null, string | null] = [null, null]): Step => ({
  id: `step${n}`,
  stepSequence: n,
  isUrgent: false,
  notes,
  station: { name: station, type },
  plannedSubcontractor: sub ? { id: `sub${n}`, name: sub } : null,
});

const orderLink = (n: number, [no, customer, item]: [string, string, string], color: string | null, qty: number | null): OrderLink => ({
  orderLineId: `ol${n}`,
  orderLine: { quantity: qty, order: { orderNumber: no, customer: { name: customer } }, item: { name: item }, color: color ? { name: color } : null },
});

function sampleSource(): TravelerCardSource {
  const no = sampleSeriesCode("workOrder", 7);
  return {
    card: {
      workOrderNumber: no,
      type: "ORDER_PRODUCTION",
      width: 150,
      targetQuantity: 4850,
      targetWeight: 810,
      foldType: "Top",
      plannedStartDate: "2026-09-25T00:00:00.000Z",
      plannedEndDate: "2026-10-02T00:00:00.000Z",
      routeTemplate: { name: "Standart Boyama Rotası" },
      targetItem: { code: "KMS-001", name: "Pamuklu Astar" },
      targetColor: { name: "Bej", hex: "#d8c9a8" },
      targetProperties: [
        { propertyId: "p1", property: { name: "Su İticilik" } },
        { propertyId: "p2", property: { name: "Zımparalı" } },
      ],
      steps: [
        step(1, "Ham Kalite (KK1)", "INTERNAL"),
        step(2, "Boyahane", "EXTERNAL", ["Yıkama yapma, matlaştır", "Yıldız Boyahane"]),
        step(3, "Kurşun + KK2", "INTERNAL", ["  ", null]),
        step(4, "Tambur", "INTERNAL"),
      ],
      orderLinks: [
        orderLink(1, ["SIP-2026-0107", "Örnek Tekstil A.Ş.", "Pamuklu Astar"], "Bej", 680),
        orderLink(2, ["SIP-2026-0108", "Deneme Konfeksiyon", "Pamuklu Astar"], "Lacivert", 1320.5),
      ],
    },
    meta: {
      cardNumber: no,
      barcode: no,
      version: 2,
      printedAt: SCENARIO_CLOCK,
      companyName: "Örnek Tekstil San. ve Tic. A.Ş.",
      voidReason: null,
      batches: [
        { batchNumber: sampleSeriesCode("batchDaily", 1), rollCount: 4, quantity: 1240, dispatch: { dispatchNo: sampleSeriesCode("subcontractorDispatch", 1), subcontractorName: "Yıldız Boyahane", moreCount: 0 } },
        { batchNumber: sampleSeriesCode("batchDaily", 2), rollCount: 2, quantity: 610.4, dispatch: { dispatchNo: sampleSeriesCode("subcontractorDispatch", 3), subcontractorName: "Ak Apre", moreCount: 2 } },
        { batchNumber: sampleSeriesCode("batchDaily", 3), rollCount: 0, quantity: null, dispatch: null },
      ],
    },
    ...envelopeHead(),
  };
}

export function travelerCardScenarios(): Scenario<never, TravelerCardSource>[] {
  const single = sampleSource();
  single.card.steps = [single.card.steps[0]!];
  single.card.orderLinks = [single.card.orderLinks[0]!];
  single.card.targetProperties = [];
  single.meta.batches = [single.meta.batches![0]!];

  const many = sampleSource();
  many.card.steps = Array.from({ length: 14 }, (_, i) =>
    step(i + 1, `İstasyon ${i + 1}`, i % 3 === 1 ? "EXTERNAL" : "INTERNAL", [i % 4 === 0 ? `Adım ${i + 1} talimatı` : null, i % 3 === 1 ? `Fason ${i + 1}` : null]),
  );
  many.card.orderLinks = Array.from({ length: 12 }, (_, i) => orderLink(i + 1, [`SIP-2026-${String(200 + i).padStart(4, "0")}`, `Müşteri ${i + 1}`, "Pamuklu Astar"], i % 2 ? "Bej" : null, 100 * (i + 1) + 0.5));
  many.meta.batches = Array.from({ length: 9 }, (_, i) => ({
    batchNumber: sampleSeriesCode("batchDaily", 60 + i),
    rollCount: i + 1,
    quantity: 300 * (i + 1),
    dispatch: i % 2 ? { dispatchNo: sampleSeriesCode("subcontractorDispatch", 10 + i), subcontractorName: "Yıldız Boyahane", moreCount: i % 3 } : null,
  }));

  // Stok üretimi + eksik plan: siparişsiz ("Stoğa üretim" kutusu), ürünsüz, tarihsiz, partisiz.
  const empty = sampleSource();
  empty.card = {
    type: "STOCK_PRODUCTION",
    width: null,
    targetQuantity: null,
    targetWeight: null,
    foldType: null,
    plannedStartDate: null,
    plannedEndDate: "geçersiz",
    routeTemplate: null,
    targetItem: null,
    targetColor: null,
    targetProperties: [],
    steps: [{ id: "s0", stepSequence: 1, isUrgent: false, notes: null, station: null, plannedSubcontractor: null }],
    orderLinks: [],
  };
  empty.meta = { ...empty.meta, companyName: undefined, batches: [] };

  const long = sampleSource();
  long.card.targetItem = { code: "KMS-<001>", name: longText("Çok Uzun Adlı Kumaş & Astar", 120) };
  long.card.targetColor = { name: "Bej \"açık\"", hex: null };
  long.card.steps = [step(1, longText("İstasyon <A>", 80), "EXTERNAL", [longText("Talimat & not", 200), longText("Fason <firma>", 80)])];
  long.card.orderLinks = [{ orderLineId: "x", orderLine: { quantity: null, order: { orderNumber: "SIP<1>", customer: null }, item: null, color: null } }];
  long.card.targetProperties = [{ propertyId: "p", property: { name: longText("Özellik <x>", 60) } }];

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek kartı (rota, sipariş, parti)", snapshot: sampleSource() },
    { ad: "tek_kalem", aciklama: "Tek adım, tek sipariş, tek parti, özelliksiz", snapshot: single },
    {
      ad: "cok_sayfa",
      aciklama: "14 adım, 12 sipariş, 9 parti (kart taşar)",
      snapshot: many,
      ek: { baski: { surum: 3, durum: "ACTIVE", zaman: SCENARIO_CLOCK, basan: "admin", not: "Vardiya kopyası" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Stok üretimi: siparişsiz, ürünsüz, tarihsiz, partisiz; kurulum adı yok", snapshot: empty },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar", snapshot: long },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş kart (filigran üst katmandır)",
      snapshot: { ...sampleSource(), meta: { ...sampleSource().meta, voidReason: `${TERIM.terbiyeIsEmri.tekil} iptal edildi` } },
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: `${TERIM.terbiyeIsEmri.tekil} iptal edildi` } },
    },
  ];
}
