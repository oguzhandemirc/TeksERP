// =============================================================================
// ANALİZ PLANI — analiz isteğini küp/ölçü/boyut kimliklerine çözer (R3-ISTAT; plan §3.8)
// =============================================================================
// Saf (DB'siz): kayıtlı rapor doğrulaması ve çalıştırıcı AYNI planlayıcıyı kullanır. Kural:
// sayım ölçüsü (birimi "adet") maruziyetle oranlanmadan iki grubu ya da iki seriyi karşılaştırmaz —
// "gece daha çok hata" çoğu kez "gece daha çok üretim" demektir.
// =============================================================================
import { z } from "zod";
import { FILTER_OPERATORS, type SemanticCube, type SemanticDimension, type SemanticMeasure } from "./tipler";
import { measureDictionaryEntry } from "./katalog";

export const ANALYSIS_METHODS = ["pearson", "spearman", "kiKare"] as const;
export type AnalysisMethod = (typeof ANALYSIS_METHODS)[number];

const id = z.string().min(1).max(96);
const filterValue = z.string().min(1).max(200);

/** Tel sözleşmesi (Türkçe anahtarlar): `POST /api/rapor-semantik/analiz` ve tanımın `analiz` bloğu. */
export const analysisSpecSchema = z
  .object({
    yontem: z.enum(ANALYSIS_METHODS),
    kup: id.optional(),
    x: id,
    y: id,
    maruziyet: id.optional(),
    kirilim: id.optional(),
    suzgec: z
      .array(z.object({ alan: z.string().min(1).max(64), islec: z.enum(FILTER_OPERATORS), deger: z.union([filterValue, z.array(filterValue).max(500)]) }).strict())
      .max(10)
      .default([]),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    yenile: z.boolean().optional(),
  })
  .strict();
export type AnalysisSpec = z.infer<typeof analysisSpecSchema>;

export const EXPOSURE_REQUIRED_CODE = "ANALIZ_MARUZIYET_GEREKLI";
export const INVALID_ANALYSIS_CODE = "ANALIZ_GECERSIZ";

export interface AnalysisIssue {
  /** Sorunlu alan (`x`, `y`, `maruziyet`, `kirilim`, `kup`). */
  alan: string;
  mesaj: string;
  kod: typeof EXPOSURE_REQUIRED_CODE | typeof INVALID_ANALYSIS_CODE;
}

export interface Exposure {
  cube: SemanticCube;
  measure: SemanticMeasure;
}

export type AnalysisPlan =
  | { kind: "rate"; cube: SemanticCube; x: SemanticDimension; count: SemanticMeasure; exposure: Exposure }
  | { kind: "table"; cube: SemanticCube; x: SemanticDimension; y: SemanticDimension; count: SemanticMeasure }
  | { kind: "corr"; method: "pearson" | "spearman"; cube: SemanticCube; group: SemanticDimension; xm: SemanticMeasure; ym: SemanticMeasure; exposure: Exposure | null };

export const isCountMeasure = (m: SemanticMeasure): boolean => measureDictionaryEntry(m.id)?.birim === "adet";
export const measureName = (m: SemanticMeasure): string => measureDictionaryEntry(m.id)?.ad ?? m.id;

const dimOf = (c: SemanticCube, dimId: string) => c.dimensions.find((d) => d.id === dimId);
const measureOf = (c: SemanticCube, mId: string) => c.measures.find((m) => m.id === mId);
/** Helper ölçü yalnız beyan ettiği boyutlarla kesilir; SQL ölçü her boyutla. */
const cuttable = (m: SemanticMeasure, dimId: string): boolean => m.kind !== "helper" || !!m.helper?.dimensions.includes(dimId);

function bad(alan: string, mesaj: string): AnalysisIssue {
  return { alan, mesaj, kod: INVALID_ANALYSIS_CODE };
}

function exposureRequired(m: SemanticMeasure): AnalysisIssue {
  return {
    alan: "maruziyet",
    mesaj: `"${measureName(m)}" bir sayımdır; üretim miktarına bölünmeden karşılaştırılamaz. Maruziyet seçin (ör. biten kumaş metresi).`,
    kod: EXPOSURE_REQUIRED_CODE,
  };
}

/** Maruziyet ölçüsü: önce ana küp, sonra aynı kırılım boyutunu taşıyan ilk küp. */
function resolveExposure(cubes: readonly SemanticCube[], main: SemanticCube, mId: string, dimId: string): Exposure | AnalysisIssue {
  const ordered = [main, ...cubes.filter((c) => c.id !== main.id)];
  const cube = ordered.find((c) => measureOf(c, mId) && dimOf(c, dimId));
  if (!cube) return bad("maruziyet", `"${mId}" ölçüsü "${dimId}" kırılımıyla hiçbir küpte yok.`);
  const measure = measureOf(cube, mId)!;
  if (measure.kind === "ratio") return bad("maruziyet", `Maruziyet bir miktar olmalı (metre, dakika); "${measureName(measure)}" bir oran.`);
  if (!cuttable(measure, dimId)) return bad("maruziyet", `"${measureName(measure)}" "${dimId}" kırılımıyla hesaplanamıyor.`);
  return { cube, measure };
}

const isIssue = (v: unknown): v is AnalysisIssue => typeof v === "object" && v !== null && "kod" in v;

function pickCube(cubes: readonly SemanticCube[], spec: AnalysisSpec, fits: (c: SemanticCube) => boolean): SemanticCube | AnalysisIssue {
  if (spec.kup) {
    const c = cubes.find((x) => x.id === spec.kup);
    if (!c) return bad("kup", `Bilinmeyen küp "${spec.kup}".`);
    return fits(c) ? c : bad("kup", `"${c.name}" küpünde "${spec.x}" ve "${spec.y}" birlikte yok.`);
  }
  return cubes.find(fits) ?? bad("y", `"${spec.x}" ile "${spec.y}" hiçbir küpte birlikte yok.`);
}

function planChiSquare(spec: AnalysisSpec, cubes: readonly SemanticCube[]): AnalysisPlan | AnalysisIssue {
  const cube = pickCube(cubes, spec, (c) => !!dimOf(c, spec.x) && (!!measureOf(c, spec.y) || !!dimOf(c, spec.y)));
  if (isIssue(cube)) return cube;
  const x = dimOf(cube, spec.x)!;
  const yDim = dimOf(cube, spec.y);
  if (yDim) {
    if (spec.maruziyet) return bad("maruziyet", "İki boyutlu tabloda maruziyet kullanılmaz: her satır kendi içinde paylaştırılır.");
    if (yDim.id === x.id) return bad("y", "Aynı boyut kendisiyle karşılaştırılamaz.");
    const count = cube.measures.find((m) => m.kind === "sum" && isCountMeasure(m));
    if (!count) return bad("y", `"${cube.name}" küpünde sayılabilen kayıt ölçüsü yok.`);
    return { kind: "table", cube, x, y: yDim, count };
  }
  const count = measureOf(cube, spec.y)!;
  if (!isCountMeasure(count)) return bad("y", `Grup kıyası sayılan bir ölçüyle yapılır (hata, duruş sayısı); "${measureName(count)}" sayım değil.`);
  if (!cuttable(count, x.id)) return bad("x", `"${measureName(count)}" "${x.name}" kırılımıyla hesaplanamıyor.`);
  if (!spec.maruziyet) return exposureRequired(count);
  const exposure = resolveExposure(cubes, cube, spec.maruziyet, x.id);
  if (isIssue(exposure)) return exposure;
  return { kind: "rate", cube, x, count, exposure };
}

function planCorrelation(spec: AnalysisSpec, cubes: readonly SemanticCube[], method: "pearson" | "spearman"): AnalysisPlan | AnalysisIssue {
  if (spec.x === spec.y) return bad("y", "Aynı ölçü kendisiyle karşılaştırılamaz.");
  const cube = pickCube(cubes, spec, (c) => !!measureOf(c, spec.x) && !!measureOf(c, spec.y));
  if (isIssue(cube)) return cube;
  const groupId = spec.kirilim ?? "gun";
  const group = dimOf(cube, groupId);
  if (!group) return bad("kirilim", `"${cube.name}" küpünde "${groupId}" kırılımı yok.`);
  const xm = measureOf(cube, spec.x)!;
  const ym = measureOf(cube, spec.y)!;
  for (const m of [xm, ym]) if (!cuttable(m, group.id)) return bad("kirilim", `"${measureName(m)}" "${group.name}" kırılımıyla hesaplanamıyor.`);
  const counted = [xm, ym].find(isCountMeasure);
  if (counted && !spec.maruziyet) return exposureRequired(counted);
  let exposure: Exposure | null = null;
  if (spec.maruziyet) {
    const e = resolveExposure(cubes, cube, spec.maruziyet, group.id);
    if (isIssue(e)) return e;
    exposure = e;
  }
  return { kind: "corr", method, cube, group, xm, ym, exposure };
}

/** Planı ya da İLK sorunu döndürür (kimlikler katalogda; serbest metin SQL'e ulaşmaz). */
export function planAnalysis(spec: AnalysisSpec, cubes: readonly SemanticCube[]): AnalysisPlan | AnalysisIssue {
  return spec.yontem === "kiKare" ? planChiSquare(spec, cubes) : planCorrelation(spec, cubes, spec.yontem);
}

export { isIssue as isAnalysisIssue };
