// =============================================================================
// Temel rapor 14 — "Kimden ne alacağız?" (`finance/alacaklar`) — KESİT
// =============================================================================
// Ana sayı vadesi geçmiş alacak = Cari Yaşlandırma (`getAgingReport`, aynı `asOf`) para birimi
// bloğunun `totals.overdueTotal`ı. Para birimleri TOPLANMAZ: ana sayı TL bloğu (yoksa tek blok);
// diğer birimler tabloda kendi biriminde. Yan sayı önümüzdeki 30 günde vadesi gelecek ALINAN çek
// (Çek Vade Takvimi'nin varsayılan penceresi, `months[]` satırları). Ay sonu görüntüsü olmadığından
// kıyas "ölçülemedi" (0 DEĞİL).

import { factoryDateTr, factoryYmd } from "../../../constants/time";
import { factoryPreviousMonthEnd } from "./_day-range";
import { chequeService, type ChequeDueSummary } from "../../cheque.service";
import { anlatiUret } from "../anlati/anlati";
import { getAgingReport, type AgingCurrencyBlock } from "../finance-aging.report";
import type { AnaSayi, Birim, GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import { capTable, catalogHeader, definitionsOf, metricFigure, plainFigure, singleCurrencyUnit, type CoreReportResult } from "./_common";

export const NO_MONTH_END_RECEIVABLES = "Geçen ay sonunda bu para biriminde açık alacak bulunmadığından kıyas yapılamıyor.";
/** Geçen ay sonu değeri görüntüden değil defterden kurulur; ölçülen sapma kaynağı (R1-ZAMAN) beyan edilir. */
export const MONTH_END_REBUILT = "Kıyas, geçen ay sonundaki vadesi geçmiş alacağın defterden yeniden kurulmuş hâlidir; o tarihten sonra değişen cari vade günü ve geriye tarihli girilen belgeler o gün görülen değerden ayırabilir.";
const MAIN_CURRENCY = "TRY";

/** Ana sayının bloğu: TL varsa TL, yoksa tek blok; birden çok yabancı birim varsa seçilmez (toplanmaz). */
export function mainBlock(blocks: readonly AgingCurrencyBlock[]): AgingCurrencyBlock | null {
  return blocks.find((b) => b.currency === MAIN_CURRENCY) ?? (blocks.length === 1 ? blocks[0] : null);
}

/** Pencerede vadesi gelecek ALINAN çek — `months[]` pencereye düşen günleri sayar; para birimi başına. */
export function receivedChequesDue(due: ChequeDueSummary, currency: string): number {
  return due.months.filter((m) => m.kind === "RECEIVED" && m.currency === currency).reduce((a, m) => a + Number(m.amount), 0);
}

export async function buildReceivablesReport(asOf: Date): Promise<CoreReportResult> {
  const monthEnd = factoryPreviousMonthEnd(asOf);
  const [aging, dueRes, prevAging] = await Promise.all([getAgingReport({ asOf }), chequeService.dueSummary(), getAgingReport({ asOf: monthEnd })]);
  const due = dueRes.data!;
  const block = mainBlock(aging.blocks);
  const unit: Birim | null = block ? singleCurrencyUnit([block]) : null;
  // Geçen ay sonu aynı yaşlandırmanın kesite çekilmiş hâlidir (ölçüm: R1-ZAMAN PR); o birimde blok yoksa ölçülemedi, 0 değil.
  const prevBlock = block ? prevAging.blocks.find((b) => b.currency === block.currency) ?? null : null;

  const mainFigure: AnaSayi = block && unit
    ? metricFigure("alacak.vadesiGecmis", Number(block.totals.overdueTotal), { unit, previous: prevBlock ? Number(prevBlock.totals.overdueTotal) : null })
    : plainFigure("alacak.vadesiGecmis", "Vadesi geçmiş alacak", null, {
        unit: "TRY",
        direction: "asagi",
        unmeasured: aging.blocks.length === 0 ? "Açık alacak yok" : "Alacaklar birden çok para biriminde; tutarlar tabloda kendi biriminde",
      });
  const sideFigures: AnaSayi[] = block && unit
    ? [
        metricFigure("cek.yaklasanVade", Math.round(receivedChequesDue(due, block.currency) * 100) / 100, { unit, name: "30 gün içinde vadesi gelecek alınan çek" }),
        plainFigure("alacak.acikToplam", "Açık alacak (vadesi gelmemiş dahil)", Number(block.totals.openTotal), { unit }),
        plainFigure("alacak.gecikenCari", "Vadesi geçmiş borcu olan cari", block.rows.filter((r) => Number(r.overdueTotal) > 0).length, { unit: "adet", direction: "asagi" }),
      ]
    : [];

  const rows = aging.blocks.flatMap((b) => b.rows.map((r) => ({ b, r }))).filter(({ r }) => Number(r.openTotal) !== 0);
  const table: TabloBlok = {
    kolonlar: [
      { anahtar: "cari", baslik: "Cari", hiza: "sol" },
      { anahtar: "paraBirimi", baslik: "Para birimi", hiza: "orta" },
      { anahtar: "vadesiGecmis", baslik: "Vadesi geçmiş", hiza: "sag" },
      { anahtar: "acik", baslik: "Açık alacak", hiza: "sag" },
      { anahtar: "enEski", baslik: "En eski gecikme", birim: "gun", hiza: "sag" },
    ],
    satirlar: rows.map(({ b, r }) => ({
      cari: r.code ? `${r.code} · ${r.name}` : r.name,
      paraBirimi: b.currency,
      vadesiGecmis: Number(r.overdueTotal),
      acik: Number(r.openTotal),
      enEski: r.oldestDaysOverdue,
    })),
  };
  const capped = capTable(table, "Cariler");

  const chart: GrafikBlok | null = block && unit
    ? {
        tur: "cubuk",
        eksen: { x: { ad: "Vade", tur: "kategori" }, y: { ad: "Alacak", birim: unit } },
        kategoriler: aging.buckets.map((k) => k.label),
        seriler: [{ ad: block.currency, veri: aging.buckets.map((k) => Number(block.totals.net[k.key])) }],
      }
    : null;

  const anlati = anlatiUret({
    anaSayi: mainFigure,
    veri: { satirSayisi: rows.length },
    ...(block && unit
      ? { kirilim: { boyut: "cari", birim: unit, adTuru: "ozel" as const, ozneIlgi: "Vadesi geçmiş alacağın", satirlar: block.rows.map((r) => ({ ad: r.name, deger: Number(r.overdueTotal) })) } }
      : {}),
  });

  const otherCurrencies = aging.blocks.filter((b) => b !== block).map((b) => b.currency);
  const iso = asOf.toISOString();
  return {
    sunum: {
      ...catalogHeader("finance/alacaklar"),
      donem: { from: iso, to: iso, etiket: `${factoryDateTr(asOf)} itibarıyla` },
      ...(block ? { kiyasDonemi: { from: monthEnd.toISOString(), to: monthEnd.toISOString(), etiket: `${factoryDateTr(monthEnd)} ay sonu` } } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["alacak.vadesiGecmis", "cek.yaklasanVade"]),
      parametreler: [{ ad: "asOf", etiket: "Tarih", tur: "tarih", deger: iso }],
      uyarilar: [
        ...(block ? [prevBlock ? MONTH_END_REBUILT : NO_MONTH_END_RECEIVABLES] : []),
        ...(factoryYmd(asOf) !== due.today ? [`Çek vadeleri seçilen tarihten değil bugünden (${due.today}) itibaren sayıldı.`] : []),
        ...(otherCurrencies.length ? [`Diğer para birimleri (${otherCurrencies.join(", ")}) tabloda kendi biriminde; tutarlar toplanmaz.`] : []),
        ...capped.uyarilar,
      ],
    },
  };
}
