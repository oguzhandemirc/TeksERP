// =============================================================================
// Muhasebe uzman araçlarının "Ne görüyoruz?" anlatısı (cash-book · vat-summary · fx-diff)
// =============================================================================
// Uçların mevcut yanıtına EK alan (`anlati`); hesap yapılmaz, rapor zaten hesaplanmış sayıları
// `anlatiUret`e verir. Para birimleri toplanmaz: tek birim değilse ana sayı "ölçülemedi" olur.

import { anlatiUret } from "../anlati/anlati";
import { anaSayiKur } from "../sunum/sunum-kur";
import type { AnlatiCumlesi, Birim } from "../sunum/sunum.types";
import type { CashBookReport } from "../cash-book.report";
import type { VatSummaryReport } from "../finance-vat.report";
import type { FxDiffReport } from "../finance-fx-diff.report";

const toUnit = (currency: string): Birim | null => (currency === "TRY" || currency === "USD" || currency === "EUR" ? currency : null);
const num = (s: string): number => Number(s);

export function buildCashBookNarrative(r: Pick<CashBookReport, "accounts" | "categories" | "totals">): AnlatiCumlesi[] {
  const currencies = [...new Set(r.accounts.map((a) => a.currency))];
  const unit = currencies.length === 1 ? toUnit(currencies[0]!) : null;
  const net = r.totals && unit ? num(r.totals.totalIn) - num(r.totals.totalOut) : null;
  const anaSayi = anaSayiKur({
    olcu: "kasa.netHareket",
    ad: "Kasa ve bankaya giren ile çıkan arasındaki fark",
    deger: net === null ? null : Math.round(net * 100) / 100,
    birim: unit ?? "TRY",
    olculemedi: r.accounts.length === 0 ? "Bu dönemde hareketi olan hesap yok" : "Hesaplar farklı para birimlerinde; her hesap kendi biriminde okunur",
    iyiYon: "notr",
  });
  const rows = unit ? r.categories.filter((c) => c.currency === unit) : [];
  return anlatiUret({
    anaSayi,
    veri: { satirSayisi: r.accounts.reduce((s, a) => s + a.movementCount, 0) },
    ...(rows.length > 1 && unit
      ? { kirilim: { boyut: "kategori", birim: unit, adTuru: "ozel" as const, ozneIlgi: "Kasadan çıkan paranın", satirlar: rows.map((c) => ({ ad: c.label, deger: num(c.totalOut) })) } }
      : {}),
  });
}

export function buildVatNarrative(r: Pick<VatSummaryReport, "sales" | "purchase">): AnlatiCumlesi[] {
  const docs = r.sales.docCount + r.purchase.docCount;
  const diff = num(r.sales.totalsTry.netVat) - num(r.purchase.totalsTry.netVat);
  const anaSayi = anaSayiKur({
    olcu: "kdv.satisEksiAlis",
    ad: "Satışta alınan KDV ile alışta ödenen KDV arasındaki fark",
    deger: docs === 0 ? null : Math.round(diff * 100) / 100,
    birim: "TRY",
    olculemedi: "Bu dönemde onaylanmış fatura yok",
    iyiYon: "notr",
  });
  const salesRows = r.sales.currencies.flatMap((c) => c.rows.filter((x) => !x.isReturn));
  return anlatiUret({
    anaSayi,
    veri: { satirSayisi: docs },
    ...(salesRows.length > 1
      ? { kirilim: { boyut: "oran", birim: "TRY" as const, adTuru: "ozel" as const, ozneIlgi: "Satış KDV'sinin", satirlar: salesRows.map((x) => ({ ad: `%${Number(x.vatRate)} oranlı satışlar`, deger: num(x.vatTry) })) } }
      : {}),
  });
}

export function buildFxDiffNarrative(r: Pick<FxDiffReport, "summary">): AnlatiCumlesi[] {
  const s = r.summary;
  const anaSayi = anaSayiKur({
    olcu: "kur.netFark",
    ad: "Kur değişiminden kalan net kazanç",
    deger: s.count === 0 ? null : num(s.netTry),
    birim: "TRY",
    olculemedi: "Bu dönemde dövizli faturası kapanan ödeme yok",
    iyiYon: "yukari",
  });
  return anlatiUret({ anaSayi, veri: { satirSayisi: s.count } });
}
