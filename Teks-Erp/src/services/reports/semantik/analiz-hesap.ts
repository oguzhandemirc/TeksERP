// =============================================================================
// ANALİZ HESABI — semantik sonuçlardan test + sunum parçaları (R3-ISTAT; plan §3.8)
// =============================================================================
// Saf: sorgu koşmaz (`analiz.ts` koşar). Grup × sayım oranı, iki boyutlu tablo, iki ölçü. Öne çıkan
// grup çoklu kıyas düzeltmesiyle seçilir; örneklem uyarısı varsa anlatı kanıt cümlesini düşürür.
// =============================================================================
import { lowerTr } from "../../../utils/tr-case";
import { bulunma, iyelik3 } from "../anlati/ek";
import type { KorelasyonKanit, SampleWarningEvidence } from "../anlati/gozlem";
import { benjaminiHochberg } from "../anlati/istatistik/bh";
import { chiSquareTest, rateGoodnessOfFit } from "../anlati/istatistik/kikare";
import { pearson, spearman, trendLine } from "../anlati/istatistik/korelasyon";
import { rateRatioTest } from "../anlati/istatistik/oran-testi";
import { MIN_SAMPLE, type TestResult } from "../anlati/istatistik/tipler";
import type { AnaSayi, Birim, GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import type { SemanticResult } from "./calistirici";
import { measureDictionaryEntry } from "./katalog";
import { measureName, type AnalysisPlan, type AnalysisSpec } from "./analiz-plan";
import type { SemanticMeasure } from "./tipler";

export interface AnalysisGroup {
  anahtar: string | null;
  ad: string;
  sayi: number;
  maruziyet: number | null;
  oran: number | null;
  /** Grubun "diğerleri"yle kıyası: ham ve çoklu kıyas düzeltmeli olasılık (kart sayısı). */
  p: number | null;
  q: number | null;
}

export interface AnalysisStats extends TestResult {
  yontem: AnalysisSpec["yontem"];
  /** Cümlenin dayandığı olasılık: oran kıyasında öne çıkan grubun düzeltilmiş değeri. */
  kanitP: number | null;
  gruplar?: AnalysisGroup[];
  /** İki ölçü kıyasında eğilim çizgisinin iki ucu ([x, y]); kart çizer, hesaplamaz. */
  egilim?: [[number, number], [number, number]] | null;
}


const OTHERS_NOTE = "Grup sayısı tavanı aştı; en büyük gruplar dışındakiler hesaba katılmadı.";

const UNIT_OF: Record<string, Birim> = { metre: "m", yuzde: "yuzde", adet: "adet", gun: "gun", dakika: "dakika", para: "TRY" };
const unitOf = (m: SemanticMeasure): Birim => UNIT_OF[measureDictionaryEntry(m.id)?.birim ?? "adet"] ?? "adet";

/** Oran ölçeği: "1.000 m'de", "saatte"… — maruziyetin biriminden. */
function rateScale(exposure: SemanticMeasure): { k: number; soz: string } {
  switch (measureDictionaryEntry(exposure.id)?.birim) {
    case "metre":
      return { k: 1000, soz: "1.000 m'de" };
    case "dakika":
      return { k: 60, soz: "saatte" };
    case "gun":
      return { k: 1, soz: "günde" };
    default:
      return { k: 100, soz: "her 100 birimde" };
  }
}

/** "Gece vardiyasında" · "Çözgü hata grubunda"; ek kestirilemezse eksiz yedek ("Renk Lacivert için"). */
export function placeOf(label: string, dimName: string): string {
  const dim = lowerTr(dimName);
  const possessive = dim.includes(" ") ? dim : iyelik3({ tur: "ad", metin: dim, kesme: false });
  const loc = possessive ? bulunma({ tur: "ad", metin: `${possessive}n`, kesme: false, yumusamaz: true }) : null;
  return loc ? `${label} ${loc}` : `${dimName} ${label} için`;
}

interface Cell { key: string | null; label: string; other: boolean; value: number | null }

function cellsOf(r: SemanticResult, dimId: string, measureId: string): Cell[] {
  return r.satirlar.map((row) => {
    const c = row.anahtarlar[dimId];
    return { key: c?.deger ?? null, label: c?.etiket ?? c?.deger ?? "Belirsiz", other: !!c?.diger, value: row.degerler[measureId] ?? null };
  });
}

const keyOf = (k: string | null): string => k ?? "\u0000";
const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

function sampleEvidence(t: TestResult, nesne: string): SampleWarningEvidence | null {
  return t.uyarilar.length ? { n: t.n, enKucukBeklenen: t.enKucukBeklenen, nesne, gereken: MIN_SAMPLE } : null;
}

export interface Computed {
  stats: AnalysisStats | null;
  kanit: KorelasyonKanit | null;
  orneklem: SampleWarningEvidence | null;
  anaSayi: AnaSayi;
  yanSayilar: AnaSayi[];
  grafik: GrafikBlok | null;
  tablo: TabloBlok | null;
  soru: string;
  uyarilar: string[];
}

function unmeasured(olcu: string, ad: string, neden: string): AnaSayi {
  return { olcu, ad, deger: null, birim: "adet", olculemedi: neden };
}

interface RateGroup { key: string | null; label: string; c: number; e: number }

/** Sayım ve maruziyet satırlarını gruba eşler; sayımı olup maruziyeti olmayan grup hesaba katılmaz (uyarılır). */
function mergeRateGroups(plan: Extract<AnalysisPlan, { kind: "rate" }>, counts: SemanticResult, exposures: SemanticResult): { groups: RateGroup[]; warnings: string[] } {
  const { x, count, exposure } = plan;
  const expName = measureName(exposure.measure);
  const warnings: string[] = [];
  const byKey = new Map<string, { key: string | null; label: string; c: number; e: number | null }>();
  let othersSkipped = false;
  for (const e of cellsOf(exposures, x.id, exposure.measure.id)) {
    if (e.other) { othersSkipped = true; continue; }
    byKey.set(keyOf(e.key), { key: e.key, label: e.label, c: 0, e: e.value });
  }
  for (const c of cellsOf(counts, x.id, count.id)) {
    if (c.other) { othersSkipped = true; continue; }
    const g = byKey.get(keyOf(c.key)) ?? { key: c.key, label: c.label, c: 0, e: null };
    g.c = finite(c.value) ? c.value : 0;
    byKey.set(keyOf(c.key), g);
  }
  if (othersSkipped) warnings.push(OTHERS_NOTE);
  const groups: RateGroup[] = [];
  for (const g of byKey.values()) {
    if (finite(g.e) && g.e > 0) groups.push({ key: g.key, label: g.label, c: g.c, e: g.e });
    else if (g.c > 0) warnings.push(`${g.label}: ${lowerTr(expName)} kaydı yok; ${g.c} kayıt hesaba katılmadı.`);
  }
  return { groups, warnings };
}

export function computeRate(plan: Extract<AnalysisPlan, { kind: "rate" }>, counts: SemanticResult, exposures: SemanticResult): Computed {
  const { x, count, exposure } = plan;
  const countName = measureName(count);
  const expName = measureName(exposure.measure);
  const scale = rateScale(exposure.measure);
  const rateName = `${countName} (${scale.soz})`;
  const { groups, warnings } = mergeRateGroups(plan, counts, exposures);
  groups.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const soru = `${x.name} değişince ${lowerTr(countName)} oranı değişiyor mu?`;
  const N = groups.reduce((s, g) => s + g.c, 0);
  const E = groups.reduce((s, g) => s + g.e, 0);
  if (groups.length < 2 || E <= 0) {
    const neden = groups.length < 2 ? "kıyaslanacak en az iki grup gerekir" : `dönemde ${lowerTr(expName)} yok`;
    return { stats: null, kanit: null, orneklem: null, anaSayi: unmeasured(count.id, rateName, neden), yanSayilar: [], grafik: null, tablo: null, soru, uyarilar: warnings };
  }
  const rate = (c: number, e: number): number => (c / e) * scale.k;
  const gof = rateGoodnessOfFit(groups.map((g) => g.c), groups.map((g) => g.e));
  const each = groups.map((g) => rateRatioTest(g.c, g.e, N - g.c, E - g.e));
  const qs = benjaminiHochberg(each.map((t) => t.p));
  // Öne çıkan grup: düzeltilmiş olasılığı eşik altındakilerden en büyük farkı; yoksa en yüksek oran.
  const significant = groups.map((_, i) => i).filter((i) => qs[i]! < 0.05 && finite(each[i]!.etkiBuyuklugu));
  const rateOf = (i: number): number => rate(groups[i]!.c, groups[i]!.e);
  // Eşit farkta (iki grupta ikisi de "2 kat") yüksek oranlı grup söylenir: "gece 2 katı", "gündüz yarısı" değil.
  const pickBy = (ids: number[], score: (i: number) => number): number =>
    ids.reduce((best, i) => (score(i) > score(best) + 1e-9 || (Math.abs(score(i) - score(best)) <= 1e-9 && rateOf(i) > rateOf(best)) ? i : best), ids[0]!);
  const h = significant.length
    ? pickBy(significant, (i) => Math.abs(Math.log(each[i]!.etkiBuyuklugu!)))
    : pickBy(groups.map((_, i) => i), rateOf);
  const hg = groups[h]!;
  const others = E - hg.e > 0 ? rate(N - hg.c, E - hg.e) : null;
  const hr = rate(hg.c, hg.e);
  const kat = others && others > 0 ? hr / others : null;
  const gruplar: AnalysisGroup[] = groups.map((g, i) => ({
    anahtar: g.key, ad: g.label, sayi: g.c, maruziyet: g.e, oran: rate(g.c, g.e),
    p: finite(each[i]!.p) ? each[i]!.p : null, q: finite(qs[i]) ? qs[i]! : null,
  }));
  const kanitP = finite(qs[h]) ? qs[h]! : null;
  const stats: AnalysisStats = { ...gof, etkiBuyuklugu: kat, yontem: "kiKare", kanitP, gruplar };
  const kanit: KorelasyonKanit | null =
    kanitP === null || others === null
      ? null
      : { yontem: "kiKare", tur: "oran", n: N, p: kanitP, nesne: "kayıt", olcuAdi: lowerTr(countName), yer: placeOf(hg.label, x.name), birimSozu: scale.soz, oran: hr, digerOran: others, kat };
  return {
    stats, kanit, orneklem: sampleEvidence(gof, "kayıt"), soru, uyarilar: warnings,
    anaSayi: { olcu: count.id, ad: `${countName} (${scale.soz}, tümü)`, deger: rate(N, E), birim: "adet" },
    yanSayilar: [
      { olcu: count.id, ad: `En yüksek: ${hg.label}`, deger: hr, birim: "adet" },
      { olcu: "analiz.kayit", ad: "Ölçülen kayıt", deger: N, birim: "adet" },
    ],
    grafik: {
      tur: "cubuk",
      eksen: { x: { ad: x.name, tur: "kategori" }, y: { ad: rateName, birim: "adet" } },
      seriler: [{ ad: rateName, veri: gruplar.map((g) => g.oran) }],
      kategoriler: gruplar.map((g) => g.ad),
    },
    tablo: {
      kolonlar: [
        { anahtar: "grup", baslik: x.name, hiza: "sol" },
        { anahtar: "sayi", baslik: countName, birim: "adet", hiza: "sag" },
        { anahtar: "maruziyet", baslik: expName, birim: unitOf(exposure.measure), hiza: "sag" },
        { anahtar: "oran", baslik: scale.soz, birim: "adet", hiza: "sag" },
        { anahtar: "pay", baslik: "Pay", birim: "yuzde", hiza: "sag" },
      ],
      // Pay = grubun kayıt payı (kart özet tablosu; istemci oran hesaplamaz).
      satirlar: gruplar.map((g) => ({ grup: g.ad, sayi: g.sayi, maruziyet: g.maruziyet, oran: g.oran, pay: N > 0 ? (g.sayi / N) * 100 : null })),
      toplam: { grup: "Toplam", sayi: N, maruziyet: E, oran: rate(N, E), pay: N > 0 ? 100 : null },
    },
  };
}

export function computeTable(plan: Extract<AnalysisPlan, { kind: "table" }>, r: SemanticResult): Computed {
  const { x, y, count } = plan;
  const warnings: string[] = [];
  const rows = new Map<string, string>();
  const cols = new Map<string, string>();
  const cells = new Map<string, number>();
  for (const row of r.satirlar) {
    const a = row.anahtarlar[x.id];
    const b = row.anahtarlar[y.id];
    if (a?.diger || b?.diger) {
      if (!warnings.includes(OTHERS_NOTE)) warnings.push(OTHERS_NOTE);
      continue;
    }
    const rk = keyOf(a?.deger ?? null);
    const ck = keyOf(b?.deger ?? null);
    rows.set(rk, a?.etiket ?? a?.deger ?? "Belirsiz");
    cols.set(ck, b?.etiket ?? b?.deger ?? "Belirsiz");
    const v = row.degerler[count.id];
    cells.set(`${rk}|${ck}`, (cells.get(`${rk}|${ck}`) ?? 0) + (finite(v) ? v : 0));
  }
  const byLabel = (m: Map<string, string>) => [...m.entries()].sort((p, q) => (p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0));
  const rowList = byLabel(rows);
  const colList = byLabel(cols);
  const table = rowList.map(([rk]) => colList.map(([ck]) => cells.get(`${rk}|${ck}`) ?? 0));
  const soru = `${x.name} ile ${lowerTr(y.name)} arasında bağ var mı?`;
  const N = table.flat().reduce((s, v) => s + v, 0);
  if (rowList.length < 2 || colList.length < 2) {
    return { stats: null, kanit: null, orneklem: null, anaSayi: unmeasured("analiz.kayit", "Ölçülen kayıt", "kıyaslanacak en az iki satır ve iki sütun gerekir"), yanSayilar: [], grafik: null, tablo: null, soru, uyarilar: warnings };
  }
  const t = chiSquareTest(table);
  let best: [number, number] = [0, 0];
  t.artiklar.forEach((rowZ, i) => rowZ.forEach((z, j) => { if (z > t.artiklar[best[0]]![best[1]]!) best = [i, j]; }));
  const [bi, bj] = best;
  const rowSum = table[bi]!.reduce((s, v) => s + v, 0);
  const colSum = table.reduce((s, rr) => s + rr[bj]!, 0);
  const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const finiteP = finite(t.p);
  const kanit: KorelasyonKanit | null = finiteP
    ? { yontem: "kiKare", tur: "tablo", n: N, p: t.p, nesne: "kayıt", yer: placeOf(rowList[bi]![1], x.name), ikinciAd: lowerTr(colList[bj]![1]), pay: pct(table[bi]![bj]!, rowSum), genelPay: pct(colSum, N) }
    : null;
  const { beklenen: _b, artiklar: _a, ...test } = t;
  return {
    stats: { ...test, yontem: "kiKare", kanitP: finiteP ? t.p : null },
    kanit, orneklem: sampleEvidence(t, "kayıt"), soru, uyarilar: warnings,
    anaSayi: { olcu: "analiz.kayit", ad: "Ölçülen kayıt", deger: N, birim: "adet" },
    yanSayilar: [],
    grafik: {
      tur: "isiHaritasi",
      eksen: { x: { ad: x.name, tur: "kategori" }, y: { ad: `${y.name} payı`, birim: "yuzde" } },
      seriler: colList.map(([, label], j) => ({ ad: label, veri: table.map((rr) => pct(rr[j]!, rr.reduce((s, v) => s + v, 0))) })),
      kategoriler: rowList.map(([, label]) => label),
    },
    tablo: {
      kolonlar: [{ anahtar: "grup", baslik: x.name, hiza: "sol" }, ...colList.map(([, label], j) => ({ anahtar: `s${j}`, baslik: label, birim: "adet" as Birim, hiza: "sag" as const }))],
      satirlar: rowList.map(([, label], i) => Object.fromEntries([["grup", label], ...table[i]!.map((v, j) => [`s${j}`, v])])),
    },
  };
}

export function computeCorrelation(plan: Extract<AnalysisPlan, { kind: "corr" }>, r: SemanticResult, exposures: SemanticResult | null): Computed {
  const { group, xm, ym, exposure } = plan;
  const scale = exposure ? rateScale(exposure.measure) : null;
  const expByKey = new Map<string, number | null>();
  if (exposures && exposure) for (const c of cellsOf(exposures, group.id, exposure.measure.id)) expByKey.set(keyOf(c.key), c.value);
  // Sayım ölçüsü maruziyete bölünür (planlayıcı maruziyetsiz sayımı zaten reddetti).
  const adjust = (m: SemanticMeasure, v: number | null, key: string): number | null => {
    if (!finite(v)) return null;
    if (!scale || measureDictionaryEntry(m.id)?.birim !== "adet") return v;
    const e = expByKey.get(key);
    return finite(e) && e > 0 ? (v / e) * scale.k : null;
  };
  const nameOf = (m: SemanticMeasure): string => (scale && measureDictionaryEntry(m.id)?.birim === "adet" ? `${measureName(m)} (${scale.soz})` : measureName(m));
  const pts: { label: string; x: number; y: number }[] = [];
  let othersSkipped = false;
  for (const row of r.satirlar) {
    const k = row.anahtarlar[group.id];
    if (k?.diger) { othersSkipped = true; continue; }
    const key = keyOf(k?.deger ?? null);
    const xv = adjust(xm, row.degerler[xm.id] ?? null, key);
    const yv = adjust(ym, row.degerler[ym.id] ?? null, key);
    if (finite(xv) && finite(yv)) pts.push({ label: k?.etiket ?? k?.deger ?? "Belirsiz", x: xv, y: yv });
  }
  const xName = nameOf(xm);
  const yName = nameOf(ym);
  const nesne = lowerTr(group.name);
  const warnings = othersSkipped ? [OTHERS_NOTE] : [];
  const soru = `${xName} ile ${lowerTr(yName)} birlikte mi değişiyor?`;
  const t = (plan.method === "pearson" ? pearson : spearman)(pts.map((p) => p.x), pts.map((p) => p.y));
  const ok = finite(t.istatistik) && finite(t.p);
  const kanit: KorelasyonKanit | null = ok ? { yontem: plan.method, n: t.n, p: t.p, r: t.istatistik, nesne, xAdi: xName, yAdi: lowerTr(yName) } : null;
  return {
    stats: { ...t, yontem: plan.method, kanitP: ok ? t.p : null, egilim: trendLine(pts.map((p) => p.x), pts.map((p) => p.y)) },
    kanit,
    orneklem: sampleEvidence(t, nesne),
    soru, uyarilar: warnings,
    anaSayi: pts.length >= 3
      ? { olcu: "analiz.nokta", ad: `Ölçülen ${nesne}`, deger: pts.length, birim: "adet" }
      : unmeasured("analiz.nokta", `Ölçülen ${nesne}`, "en az üç nokta gerekir"),
    yanSayilar: [],
    grafik: {
      tur: "sacilim",
      eksen: { x: { ad: xName, tur: "sayi" }, y: { ad: yName, birim: exposure && measureDictionaryEntry(ym.id)?.birim === "adet" ? "adet" : unitOf(ym) } },
      seriler: [{ ad: yName, veri: pts.map((p) => p.y) }],
      kategoriler: pts.map((p) => String(Math.round(p.x * 1e4) / 1e4)),
    },
    tablo: {
      kolonlar: [
        { anahtar: "grup", baslik: group.name, hiza: "sol" },
        { anahtar: "x", baslik: xName, hiza: "sag" },
        { anahtar: "y", baslik: yName, hiza: "sag" },
      ],
      satirlar: pts.map((p) => ({ grup: p.label, x: p.x, y: p.y })),
    },
  };
}

