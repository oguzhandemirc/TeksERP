// =============================================================================
// DOKUMA MALİYET VERİMLİLİĞİ — v2 sunum zarfı (SY-D3; TASARIM-2026-10-31 §5.5 madde 3)
// =============================================================================
// Satır = dokuma işi; sayı tek kaynaktan (`weaving-actual-cost.helper`), burası yalnız biçimler. Sunum dövizi
// (`maliyet.sunumDovizi`) TRY değilse TL/m günün kuruna bölünür; kur yoksa hücre "eksik" yazılır — 0 YAZILMAZ.
// Koşumsuz iş (amir koşum açmamış) gerçek maliyet ölçemez; metresi ayrı "koşumsuz metre" kovasında durur.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { suggestFxRate } from "../helpers/maliyet-bridge.helper";
import { weavingActualCostTx, weavingOrdersActiveIn, type WeavingActualCost, type WeavingActualMissing } from "../helpers/weaving-actual-cost.helper";
import { readCostPresentationCurrency, readCostProfitMachineTime, type CostPresentationCurrency } from "../system-setting.service";
import type { ResolvedDayRange } from "./temel/_day-range";
import { dayRangeParameters } from "./temel/_day-range";
import { anaSayiKur } from "./sunum/sunum-kur";
import type { RaporSunumu, TabloBlok, TabloHucresi } from "./sunum/sunum.types";

type Dec = Prisma.Decimal;
export const WEAVING_EFFICIENCY_KEY = "maliyet/dokuma-verimlilik";
export const EKSIK = "eksik";
const TITLE = "Dokuma maliyeti standarttan saptı mı?";
const SORU = "Dokuma işlerinin gerçek metre maliyeti standart maliyete göre ne kadar saptı, tezgâh ne kadar verimli çalıştı?";

const MISSING_TEXT: Record<WeavingActualMissing, string> = {
  FASON: "fason dokuma (fatura okuması sonraki dilim)",
  KOSUM_YOK: "koşum açılmamış",
  MAKINE_TARIFESI: "tezgâh saat ücreti yok",
  MAKINE_NORMU: "tezgâh metre normu yok",
  KOSUM_METRESI: "koşum metresi yok",
  TOP_YOK: "top yok",
  STANDART_YOK: "standart maliyet yok",
};

export interface WeavingEfficiencyReport {
  currency: CostPresentationCurrency;
  fxRate: string | null;
  rows: WeavingActualCost[];
  runlessMeters: string;
}

/** Aralıkta etkin dokuma işleri → gerçek/standart (tek kaynak) + sunum dövizi ve günün kuru. */
export async function weavingEfficiencyReport(range: { from: Date; to: Date }): Promise<WeavingEfficiencyReport> {
  const ids = await weavingOrdersActiveIn(prisma, range);
  const rows = await weavingActualCostTx(prisma, ids, await readCostProfitMachineTime());
  const currency = await readCostPresentationCurrency();
  const rate = currency === "TRY" ? null : await suggestFxRate(currency, new Date());
  const runless = rows.filter((r) => r.missing.includes("KOSUM_YOK")).reduce((a, r) => a + Number(r.totalMeters), 0);
  return { currency, fxRate: rate && rate.gt(0) ? rate.toString() : null, rows, runlessMeters: runless.toFixed(3) };
}

const num = (d: Dec | null, places = 4): number | null => (d === null ? null : Number(d.toDecimalPlaces(places).toString()));

/** TL/m → sunum dövizi/m; döviz TRY değil ve kur yoksa "eksik" (Gülkesim K16: 0 değil). */
function money(d: Dec | null, r: WeavingEfficiencyReport): TabloHucresi {
  if (d === null) return null;
  if (r.currency === "TRY") return num(d);
  return r.fxRate === null ? EKSIK : num(d.div(r.fxRate));
}

function rowStatus(w: WeavingActualCost, r: WeavingEfficiencyReport): string {
  const notes = w.missing.filter((m) => m !== "TOP_YOK" || w.runCount > 0).map((m) => MISSING_TEXT[m]);
  if (r.currency !== "TRY" && r.fxRate === null) notes.unshift(`${r.currency} kuru yok`);
  if (notes.length > 0) return `${EKSIK}: ${notes.join(", ")}`;
  return w.ongoing ? "devam ediyor" : "tamam";
}

export function weavingEfficiencyTable(r: WeavingEfficiencyReport): TabloBlok {
  const unit = r.currency;
  return {
    kolonlar: [
      { anahtar: "is", baslik: "Dokuma işi" },
      { anahtar: "urun", baslik: "Ürün" },
      { anahtar: "tezgah", baslik: "Tezgâh" },
      { anahtar: "standartM", baslik: "Standart dokuma /m", birim: unit, hiza: "sag" },
      { anahtar: "gercekM", baslik: "Gerçek dokuma /m", birim: unit, hiza: "sag" },
      { anahtar: "fark", baslik: "Fark /m", birim: unit, hiza: "sag" },
      { anahtar: "farkYuzde", baslik: "Fark", birim: "yuzde", hiza: "sag" },
      { anahtar: "teorikMSaat", baslik: "Teorik m/saat", birim: "m", hiza: "sag" },
      { anahtar: "gercekMSaat", baslik: "Gerçek m/saat", birim: "m", hiza: "sag" },
      { anahtar: "durusPayi", baslik: "Duruş payı", birim: "yuzde", hiza: "sag" },
      { anahtar: "kosumluM", baslik: "Koşumlu top", birim: "m", hiza: "sag" },
      { anahtar: "kosumsuzM", baslik: "Koşumsuz top", birim: "m", hiza: "sag" },
      { anahtar: "durum", baslik: "Durum" },
    ],
    satirlar: r.rows.map((w) => {
      const diff = w.actualPerMTry && w.standardPerMTry ? w.actualPerMTry.minus(w.standardPerMTry) : null;
      const diffPct = diff && w.standardPerMTry && w.standardPerMTry.gt(0) ? diff.div(w.standardPerMTry).mul(100) : null;
      return {
        is: w.weavingOrderNumber,
        urun: w.itemLabel,
        tezgah: w.machines.map((m) => m.code).join(", ") || "—",
        standartM: money(w.standardPerMTry, r),
        gercekM: money(w.actualPerMTry, r),
        fark: money(diff, r),
        farkYuzde: num(diffPct, 1),
        teorikMSaat: num(w.theoreticalMPerHour, 1),
        gercekMSaat: num(w.realizedMPerHour, 1),
        durusPayi: w.stopShare === null ? null : num(w.stopShare.mul(100), 1),
        kosumluM: num(w.metersViaRun, 1),
        kosumsuzM: num(w.metersViaOrder, 1),
        durum: rowStatus(w, r),
      };
    }),
  };
}

export function buildWeavingEfficiencySunumu(r: WeavingEfficiencyReport, window: ResolvedDayRange): RaporSunumu {
  // Devam eden işte maliyet şu ana akar ama tezgâhtaki kumaş henüz top değil → ana sayıya yalnız bitmiş işler girer.
  const measured = r.rows.filter((w) => !w.ongoing && w.actualCostTry !== null && w.standardPerMTry !== null && w.totalMeters.gt(0));
  const ongoingCount = r.rows.filter((w) => w.ongoing).length;
  const actual = measured.reduce((a, w) => a + Number(w.actualCostTry), 0);
  const standard = measured.reduce((a, w) => a + Number(w.standardPerMTry!.mul(w.totalMeters)), 0);
  const deviation = standard > 0 ? Math.round(((actual - standard) / standard) * 1000) / 10 : null;
  const timeSource = r.rows[0]?.timeSource ?? null;
  const warnings: string[] = [];
  if (r.currency !== "TRY" && r.fxRate === null) warnings.push(`${r.currency} kuru bulunamadı: tutarlar "eksik" yazıldı (sıfır değil).`);
  if (Number(r.runlessMeters) > 0) warnings.push(`Koşum açılmadan dokunan ${r.runlessMeters} m kumaşın gerçek maliyeti ölçülemedi (koşumsuz metre).`);
  if (ongoingCount > 0) warnings.push(`Devam eden ${ongoingCount} iş tabloda gösterildi, sapma ana sayısına girmedi (tezgâhtaki kumaş henüz top değil).`);
  if (timeSource === "NORM") warnings.push("Tezgâh süresi metre normundan hesaplandı (Kârlılık makine süresi ayarı: NORM).");
  return {
    anahtar: WEAVING_EFFICIENCY_KEY,
    baslik: TITLE,
    soru: SORU,
    donem: { from: window.range.from.toISOString(), to: window.range.to.toISOString(), etiket: `${window.days.from} – ${window.days.to}` },
    anaSayi: anaSayiKur({ olcu: "dokuma.maliyetSapmasi", ad: "Gerçek maliyetin standarttan sapması", deger: deviation, birim: "yuzde", iyiYon: "asagi", olculemedi: "Ölçülebilen dokuma işi yok" }),
    yanSayilar: [
      anaSayiKur({ olcu: "dokuma.olculenMetre", ad: "Maliyeti ölçülen kumaş", deger: measured.reduce((a, w) => a + Number(w.totalMeters), 0), birim: "m", iyiYon: "notr" }),
      anaSayiKur({ olcu: "dokuma.kosumsuzMetre", ad: "Koşumsuz kumaş", deger: Number(r.runlessMeters), birim: "m", iyiYon: "asagi" }),
    ],
    anlati: [],
    grafik: null,
    tablo: weavingEfficiencyTable(r),
    tanimlar: [
      { ad: "Standart dokuma", aciklama: "Ürünün etkin standart maliyet sürümündeki dokuma satırları: tezgâh, işçilik, enerji ya da atkı ücreti." },
      { ad: "Gerçek dokuma", aciklama: "İşin koşumlarındaki tezgâh saati çarpı tezgâhın o tarihteki saat ücreti, işin iptal edilmemiş toplarının metresine bölünür (boyahaneye ya da tambura geçmiş ham top da sayılır). Atkı ipliği tartılmaz; iplik bu rapora girmez." },
      { ad: "Satır kapsamı", aciklama: "Dönem yalnız işi seçer; satırdaki saat, maliyet ve metre işin tüm ömrüdür. Sapma ana sayısına yalnız bitmiş işler girer." },
      { ad: "Kur", aciklama: "TL dışı sunumda standart ve gerçek tutarlar günün kuruyla çevrilir; standart maliyet ekranındaki donmuş sürüm kurundan farklı olabilir, fark yüzdesi etkilenmez." },
      { ad: "Koşumsuz top", aciklama: "Kalite girişinde işe bağlanan ama tezgâhı bilinmeyen top. İşin hiç koşumu yoksa gerçek maliyet ölçülemez." },
      { ad: "Duruş payı", aciklama: "Kapanmış koşumlarda duruş süresinin koşum süresine oranı." },
      { ad: EKSIK, aciklama: "Kur, saat ücreti, koşum ya da standart maliyet bulunamadığı için değer hesaplanamadı; sıfır demek değildir." },
    ],
    parametreler: dayRangeParameters(window.days, window.mode).filter((p) => p.ad !== "kiyas"),
    uyarilar: warnings,
  };
}
