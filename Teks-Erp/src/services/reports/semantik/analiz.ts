// =============================================================================
// ANALİZ ÇALIŞTIRICISI — iki boyut/ölçü arasındaki ilişki, günlük dilde (R3-ISTAT; plan §3.8)
// =============================================================================
// Sayılar YALNIZ semantik çalıştırıcıdan (küp + izin + sıra + zaman tavanı + önbellek); yeni SQL yok.
// Toplama PG'de, test JS'te (`analiz-hesap.ts` → `anlati/istatistik`). Örneklem eşiği altında kanıt
// cümlesi KURULMAZ; her analiz cümlesi "İlişki, nedeni göstermez." ile biter. Kişi adı boyutu sunumu buluttan düşürür.
// =============================================================================
import { AppError } from "../../../utils/app-error";
import { anlatiUret } from "../anlati/anlati";
import type { AnalysisInput } from "../anlati/gozlem";
import { CAUSALITY_NOTE } from "../anlati/kurallar";
import { donemEtiketi } from "../sunum/sunum-kur";
import type { RaporSunumu } from "../sunum/sunum.types";
import { defaultDeps, runSemanticQuery, type RunDeps, type RunOrigin, type SemanticResult } from "./calistirici";
import type { SemanticQueryInput } from "./derleyici";
import type { AccessContext } from "./izin";
import { isAnalysisIssue, planAnalysis, type AnalysisSpec, type Exposure } from "./analiz-plan";
import { computeCorrelation, computeRate, computeTable, type AnalysisStats, type Computed } from "./analiz-hesap";
import type { SemanticCube, SemanticDimension, SemanticMeasure } from "./tipler";

export type { AnalysisGroup, AnalysisStats } from "./analiz-hesap";

export interface AnalysisResult {
  sunum: RaporSunumu;
  istatistik: AnalysisStats | null;
  sonuclar: SemanticResult[];
  /** Özel rapor anlatı bloğunun girdisi (R2-ANLATI); tele çıkmaz. */
  anlatiGirdisi: AnalysisInput;
}

const CAP = 50;

interface QueryArgs {
  cube: SemanticCube;
  measures: SemanticMeasure[];
  dims: SemanticDimension[];
  spec: AnalysisSpec;
  range: { dateFrom?: string; dateTo?: string };
}

function queryOf({ cube, measures, dims, spec, range }: QueryArgs): SemanticQueryInput {
  const dimIds = new Set(cube.dimensions.map((d) => d.id));
  return {
    kup: cube.id,
    olculer: measures.map((m) => m.id),
    boyutlar: dims.map((d) => d.id),
    // Maruziyet küpü yalnız kendi boyutundaki süzgeçleri alır (hata grubu üretimin özelliği değil).
    suzgec: spec.suzgec.filter((f) => dimIds.has(f.alan)),
    ...range,
    ...(dims.some((d) => d.kind === "time") ? {} : { tavan: CAP }),
    ...(spec.yenile ? { yenile: true } : {}),
  };
}

function rangeOf(r: SemanticResult): { dateFrom: string; dateTo: string } {
  return { dateFrom: r.aralik.dateFrom, dateTo: r.aralik.dateTo };
}

/** Analizi koşar: önce sayım/ölçü küpü, sonra (gerekirse) aynı aralıkla maruziyet küpü — SIRAYLA. */
export async function runAnalysis(
  spec: AnalysisSpec,
  ctx: AccessContext,
  opts: { deps?: RunDeps & { origin?: RunOrigin | null }; cubes?: readonly SemanticCube[]; baslik?: string } = {},
): Promise<AnalysisResult> {
  const deps = opts.deps ?? defaultDeps;
  const plan = planAnalysis(spec, opts.cubes ?? deps.cubes);
  if (isAnalysisIssue(plan)) throw AppError.badRequest(plan.mesaj, { code: plan.kod, alan: plan.alan });
  const run = (q: SemanticQueryInput) => runSemanticQuery(q, ctx, undefined, deps);
  const askedRange = { ...(spec.dateFrom ? { dateFrom: spec.dateFrom } : {}), ...(spec.dateTo ? { dateTo: spec.dateTo } : {}) };
  const runExposure = (e: Exposure, dim: SemanticDimension, range: { dateFrom: string; dateTo: string }) =>
    run(queryOf({ cube: e.cube, measures: [e.measure], dims: [e.cube.dimensions.find((d) => d.id === dim.id)!], spec, range }));
  let computed: Computed;
  const results: SemanticResult[] = [];
  if (plan.kind === "rate") {
    const counts = await run(queryOf({ cube: plan.cube, measures: [plan.count], dims: [plan.x], spec, range: askedRange }));
    const exp = await runExposure(plan.exposure, plan.x, rangeOf(counts));
    results.push(counts, exp);
    computed = computeRate(plan, counts, exp);
  } else if (plan.kind === "table") {
    const r = await run(queryOf({ cube: plan.cube, measures: [plan.count], dims: [plan.x, plan.y], spec, range: askedRange }));
    results.push(r);
    computed = computeTable(plan, r);
  } else {
    const r = await run(queryOf({ cube: plan.cube, measures: [plan.xm, plan.ym], dims: [plan.group], spec, range: askedRange }));
    const exp = plan.exposure ? await runExposure(plan.exposure, plan.group, rangeOf(r)) : null;
    results.push(r, ...(exp ? [exp] : []));
    computed = computeCorrelation(plan, r, exp);
  }
  const first = results[0]!;
  const range = { from: new Date(first.aralik.dateFrom), to: new Date(first.aralik.dateTo) };
  const narrativeInput: AnalysisInput = { korelasyon: computed.kanit, orneklem: computed.orneklem };
  const anlati = anlatiUret(
    { analiz: narrativeInput, anaSayi: computed.anaSayi },
    { enFazla: 3 },
  );
  const notes = [...new Set(results.flatMap((r) => [...r.uyarilar, ...r.notlar]))];
  const sunum: RaporSunumu = {
    anahtar: `analiz/${spec.yontem}`,
    baslik: opts.baslik ?? computed.soru,
    soru: computed.soru,
    donem: { from: first.aralik.dateFrom, to: first.aralik.dateTo, etiket: donemEtiketi(range) },
    anaSayi: computed.anaSayi,
    yanSayilar: computed.yanSayilar.slice(0, 3),
    anlati,
    grafik: computed.grafik,
    tablo: computed.tablo,
    tanimlar: [
      { ad: "İlişki ve neden", aciklama: `${CAUSALITY_NOTE} İki şey birlikte değişebilir ama biri ötekini doğurmayabilir; tezgah, iplik partisi gibi başka etkenlere ayrıca bakın.` },
      { ad: "Kanıt", aciklama: "\"Güçlü kanıt\": bu büyüklükte bir fark tesadüfen yüzde birden az ihtimalle çıkar; \"kanıt var\": yüzde beşten az. Kayıt sayısı 30'un altındaysa karar cümlesi kurulmaz." },
    ],
    parametreler: [],
    uyarilar: [...computed.uyarilar, ...notes],
    ...(results.some((r) => r.kisiAdi) ? { kisiAdi: true as const } : {}),
  };
  return { sunum, istatistik: computed.stats, sonuclar: results, anlatiGirdisi: narrativeInput };
}

