// =============================================================================
// KUŞAK / HEDEF DEĞER İHTİYACI — açık sipariş kalemi × hedef değer → beklenen top (SY-F1, tasarım §7.5/6)
// =============================================================================
// "Bu hafta kaç top ZEBRA kuşağı gerekecek?" Kaynak `OrderLineTargetValue`; kalan metre = istenen − sevk
// (BRÜT, `shippedQty`), beklenen top = ⌈kalan ÷ top boyu⌉. Top boyu yazılmamış kalemin topu BİLİNMEZ —
// sıfır yazılmaz, ayrı sütunda sayılır. Sarf stoğu yok (K17). Metre dışı birimli kalem kapsam dışı (MEASURED_LINE).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDateTimeTr } from "../../constants/time";
import { OPEN_ORDER } from "../helpers/live-ref-where.helper";
import { MEASURED_LINE, openLineWhere } from "../helpers/order-line-scope.helper";
import { anaSayiKur } from "./sunum/sunum-kur";
import type { ParametreBeyani, RaporSunumu, TabloBlok } from "./sunum/sunum.types";

export const TARGET_VALUE_NEED_KEY = "sales/hedef-deger-ihtiyaci";
const TITLE = "Kuşak ve Hedef Değer İhtiyacı";
const QUESTION = "Açık siparişler için hangi kuşaktan ya da hedef değerden kaç top gerekecek?";

export interface TargetValueNeedOptions {
  musteriId?: string;
  urunId?: string;
}

export interface TargetValueNeedRow {
  ozellik: string;
  deger: string;
  degerKodu: string;
  kalemSayisi: number;
  kalanMetre: string;
  beklenenTop: number;
  topuBilinmeyenKalem: number;
}

export interface TargetValueNeedReport {
  satirlar: TargetValueNeedRow[];
  ozet: { beklenenTop: number; kalanMetre: string; topuBilinmeyenKalem: number };
  meta: {
    hesapZamani: string;
    secenekler: { musteriler: Array<{ id: string; ad: string }>; urunler: Array<{ id: string; ad: string }> };
  };
}

/** Bir kalemin beklenen top sayısı — top boyu yoksa `null` (bilinmiyor; 0 değil). */
export function expectedRolls(remaining: Prisma.Decimal, pieceLengthM: Prisma.Decimal | null): number | null {
  if (!pieceLengthM || pieceLengthM.lte(0)) return null;
  return remaining.div(pieceLengthM).ceil().toNumber();
}

export async function targetValueNeedReport(o: TargetValueNeedOptions = {}): Promise<TargetValueNeedReport> {
  const rows = await prisma.orderLine.findMany({
    where: {
      order: { ...OPEN_ORDER, ...(o.musteriId ? { customerId: o.musteriId } : {}) },
      ...openLineWhere(prisma.orderLine.fields),
      ...MEASURED_LINE,
      ...(o.urunId ? { itemId: o.urunId } : {}),
      targetValues: { some: {} },
    },
    select: {
      quantity: true,
      shippedQty: true,
      pieceLengthM: true,
      item: { select: { id: true, name: true } },
      order: { select: { customer: { select: { id: true, name: true } } } },
      targetValues: { select: { property: { select: { name: true } }, value: { select: { id: true, code: true, name: true } } } },
    },
  });
  const acc = new Map<string, { row: Omit<TargetValueNeedRow, "kalanMetre">; meters: Prisma.Decimal }>();
  const customers = new Map<string, string>();
  const items = new Map<string, string>();
  let total = new Prisma.Decimal(0);
  let totalRolls = 0;
  let unknown = 0;
  for (const l of rows) {
    customers.set(l.order.customer.id, l.order.customer.name);
    items.set(l.item.id, l.item.name);
    const remaining = l.quantity.minus(l.shippedQty);
    const rolls = expectedRolls(remaining, l.pieceLengthM);
    total = total.plus(remaining);
    if (rolls === null) unknown += 1;
    else totalRolls += rolls;
    for (const t of l.targetValues) {
      const a = acc.get(t.value.id) ?? {
        row: { ozellik: t.property.name, deger: t.value.name, degerKodu: t.value.code, kalemSayisi: 0, beklenenTop: 0, topuBilinmeyenKalem: 0 },
        meters: new Prisma.Decimal(0),
      };
      a.row.kalemSayisi += 1;
      a.meters = a.meters.plus(remaining);
      if (rolls === null) a.row.topuBilinmeyenKalem += 1;
      else a.row.beklenenTop += rolls;
      acc.set(t.value.id, a);
    }
  }
  const sortTr = (m: Map<string, string>) => [...m].map(([id, ad]) => ({ id, ad })).sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
  return {
    satirlar: [...acc.values()]
      .map((a) => ({ ...a.row, kalanMetre: a.meters.toFixed(3) }))
      .sort((a, b) => a.ozellik.localeCompare(b.ozellik, "tr") || b.beklenenTop - a.beklenenTop || a.deger.localeCompare(b.deger, "tr")),
    ozet: { beklenenTop: totalRolls, kalanMetre: total.toFixed(3), topuBilinmeyenKalem: unknown },
    meta: { hesapZamani: factoryDateTimeTr(new Date()), secenekler: { musteriler: sortTr(customers), urunler: sortTr(items) } },
  };
}

function table(r: TargetValueNeedReport): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "ozellik", baslik: "Özellik" },
      { anahtar: "deger", baslik: "Değer" },
      { anahtar: "kalemSayisi", baslik: "Sipariş kalemi", birim: "adet", hiza: "sag" },
      { anahtar: "kalanMetre", baslik: "Kalan", birim: "m", hiza: "sag" },
      { anahtar: "beklenenTop", baslik: "Beklenen top", birim: "top", hiza: "sag" },
      { anahtar: "topuBilinmeyenKalem", baslik: "Top boyu yazılmamış kalem", birim: "adet", hiza: "sag" },
    ],
    satirlar: r.satirlar.map((s) => ({
      ozellik: s.ozellik,
      deger: s.deger,
      kalemSayisi: s.kalemSayisi,
      kalanMetre: Number(s.kalanMetre),
      beklenenTop: s.beklenenTop,
      topuBilinmeyenKalem: s.topuBilinmeyenKalem,
    })),
  };
}

export function buildTargetValueNeedSunumu(r: TargetValueNeedReport, o: TargetValueNeedOptions): RaporSunumu {
  const now = new Date().toISOString();
  const params: ParametreBeyani[] = [
    { ad: "musteriId", etiket: "Müşteri", tur: "secim", deger: o.musteriId ?? null, secenekler: r.meta.secenekler.musteriler.map((m) => ({ deger: m.id, etiket: m.ad })) },
    { ad: "urunId", etiket: "Ürün", tur: "secim", deger: o.urunId ?? null, secenekler: r.meta.secenekler.urunler.map((m) => ({ deger: m.id, etiket: m.ad })) },
  ];
  const top = r.satirlar[0];
  return {
    anahtar: TARGET_VALUE_NEED_KEY,
    baslik: TITLE,
    soru: QUESTION,
    donem: { from: now, to: now, etiket: `Bugün itibarıyla (${r.meta.hesapZamani})` },
    anaSayi: anaSayiKur({ olcu: "hedefDeger.beklenenTop", ad: "Beklenen top", deger: r.ozet.beklenenTop, birim: "top", iyiYon: "notr" }),
    yanSayilar: [anaSayiKur({ olcu: "hedefDeger.kalanMetre", ad: "Kalan sipariş", deger: Number(r.ozet.kalanMetre), birim: "m", iyiYon: "notr" })],
    anlati: top ? [{ kural: "hedefDeger.enCok", onem: 1, metin: `En çok ${top.ozellik} › ${top.deger}: ${top.beklenenTop} top.`, kanit: { top: top.beklenenTop } }] : [],
    grafik: null,
    tablo: table(r),
    tanimlar: [
      { ad: "Kalan", aciklama: "Açık sipariş kaleminde istenen metreden sevk edilen metre çıkınca kalan; iptal edilen kalemler sayılmaz." },
      { ad: "Beklenen top", aciklama: "Kalan metrenin kalemdeki top boyuna bölünüp yukarı yuvarlanmışı." },
      { ad: "Top boyu yazılmamış kalem", aciklama: "Top boyu girilmemiş kalemin topu bilinmez; beklenen topa katılmaz, sıfır sayılmaz." },
    ],
    parametreler: params,
    uyarilar: r.ozet.topuBilinmeyenKalem > 0 ? [`${r.ozet.topuBilinmeyenKalem} sipariş kaleminin top boyu yazılmamış; beklenen topa katılmadı.`] : [],
  };
}
