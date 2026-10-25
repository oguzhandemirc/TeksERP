// =============================================================================
// Özel rapor oluşturucusu — adım durumu ↔ tanım gövdesi (saf; doğrulama sunucuda)
// =============================================================================
// Oluşturucu gövdenin yalnız bir alt kümesini kurar (ana sayı + ayrıntı grafiği/tablosu); kod modunda
// yazılmış daha zengin gövde açılırsa `fromBody` null döner ve ekran "oluşturucuyla düzenlenemez" der.
// =============================================================================
import type { CatalogCube } from "./custom-api";

export const DATE_PRESET_OPTIONS = [
  { deger: "bugun", etiket: "Bugün" },
  { deger: "dun", etiket: "Dün" },
  { deger: "son7gun", etiket: "Son 7 gün" },
  { deger: "son30gun", etiket: "Son 30 gün" },
  { deger: "son90gun", etiket: "Son 90 gün" },
  { deger: "buAy", etiket: "Bu ay" },
  { deger: "gecenAy", etiket: "Geçen ay" },
  { deger: "buYil", etiket: "Bu yıl" },
] as const;

export const COMPARE_OPTIONS = [
  { deger: "none", etiket: "Kıyas yok" },
  { deger: "prev", etiket: "Önceki dönemle" },
  { deger: "prevYear", etiket: "Geçen yılın aynı dönemiyle" },
] as const;

export const VIEW_OPTIONS = [
  { deger: "cubuk", etiket: "Çubuk grafik + tablo" },
  { deger: "cizgi", etiket: "Çizgi grafik + tablo" },
  { deger: "pasta", etiket: "Pasta grafik + tablo" },
  { deger: "tablo", etiket: "Yalnız tablo" },
] as const;

export type DatePreset = (typeof DATE_PRESET_OPTIONS)[number]["deger"];
export type CompareMode = (typeof COMPARE_OPTIONS)[number]["deger"];
export type ViewKind = (typeof VIEW_OPTIONS)[number]["deger"];

export interface FilterChoice {
  boyut: string;
  degerler: Array<{ deger: string; etiket: string }>;
}

export interface BuilderState {
  title: string;
  cube: string | null;
  measures: string[];
  dimensions: string[];
  filters: FilterChoice[];
  period: DatePreset;
  compare: CompareMode;
  view: ViewKind;
}

export const EMPTY_BUILDER: BuilderState = { title: "", cube: null, measures: [], dimensions: [], filters: [], period: "son30gun", compare: "prev", view: "cubuk" };

export const BUILDER_STEPS = ["Küp", "Ölçüler", "Boyutlar", "Süzgeçler", "Dönem ve kıyas"] as const;

/** Seçili TÜM ölçülerin izin verdiği kategori boyutları (ölçünün `boyutlar`ı null = hepsi). */
export function allowedDimensions(cube: CatalogCube | undefined, measures: readonly string[]) {
  if (!cube) return [];
  const picked = cube.olculer.filter((m) => measures.includes(m.kimlik));
  return cube.boyutlar.filter((d) => picked.every((m) => m.boyutlar === null || m.boyutlar.includes(d.kimlik)));
}

/** Adım tamam mı — "İleri" düğmesi bunu sorar; boyut ve süzgeç adımı isteğe bağlıdır. */
export function stepReady(state: BuilderState, step: number): boolean {
  if (step === 0) return state.cube !== null;
  if (step === 1) return state.measures.length > 0;
  return true;
}

function query(state: BuilderState, measures: string[], dimensions: string[], withCompare: boolean) {
  const rules = state.filters
    .filter((f) => f.degerler.length > 0)
    .map((f) => ({ field: f.boyut, operator: "in" as const, value: f.degerler.map((v) => v.deger) }));
  return {
    kup: state.cube,
    olculer: measures,
    boyutlar: dimensions,
    ...(rules.length ? { suzgec: { combinator: "and" as const, rules } } : {}),
    zaman: { param: "donem", ...(withCompare && state.compare !== "none" ? { kiyas: "$kiyas" } : {}) },
  };
}

/** Durum → tanım gövdesi (`rapor-tanimi.schema.ts` biçimi; sunucu doğrular). */
export function toBody(state: BuilderState): Record<string, unknown> {
  const parameters: Array<Record<string, unknown>> = [{ ad: "donem", tur: "tarihAraligi", varsayilan: state.period }];
  if (state.compare !== "none") parameters.push({ ad: "kiyas", tur: "kiyas", varsayilan: state.compare });
  const blocks: Array<Record<string, unknown>> = [{ id: "ana", tur: "anaSayi", sorgu: query(state, state.measures.slice(0, 1), [], true) }];
  if (state.dimensions.length > 0) {
    if (state.view !== "tablo") blocks.push({ id: "grafik", tur: "grafik", gorsel: state.view, sorgu: query(state, state.measures.slice(0, 1), state.dimensions.slice(0, 1), false) });
    blocks.push({ id: "tablo", tur: "tablo", sorgu: query(state, state.measures, state.dimensions, false) });
  }
  return { surum: 1, baslik: state.title.trim() || "Adsız rapor", parametreler: parameters, bloklar: blocks };
}

interface RuleLike { field: string; operator: string; value: unknown }
interface QueryLike { kup: string; olculer: string[]; boyutlar?: string[]; suzgec?: { rules: RuleLike[] } }
interface BodyLike { baslik: string; parametreler?: Array<{ ad: string; tur: string; varsayilan?: string }>; bloklar: Array<{ tur: string; gorsel?: string; sorgu?: QueryLike }> }

/** Kaydedilmiş gövde → oluşturucu durumu; oluşturucunun kuramayacağı biçimse `null`. */
export function fromBody(raw: unknown, labelOf: (dim: string, value: string) => string = (_d, v) => v): BuilderState | null {
  const body = raw as BodyLike | null;
  if (!body || !Array.isArray(body.bloklar)) return null;
  const head = body.bloklar.find((b) => b.tur === "anaSayi")?.sorgu;
  const table = body.bloklar.find((b) => b.tur === "tablo")?.sorgu;
  const chart = body.bloklar.find((b) => b.tur === "grafik");
  if (!head || body.bloklar.some((b) => !["anaSayi", "grafik", "tablo"].includes(b.tur))) return null;
  const param = (ad: string) => body.parametreler?.find((p) => p.ad === ad)?.varsayilan;
  const rules = (head.suzgec?.rules ?? []).filter((r) => r.operator === "in" && Array.isArray(r.value));
  return {
    title: body.baslik,
    cube: head.kup,
    measures: table?.olculer ?? head.olculer,
    dimensions: table?.boyutlar ?? [],
    filters: rules.map((r) => ({ boyut: r.field, degerler: (r.value as string[]).map((v) => ({ deger: v, etiket: labelOf(r.field, v) })) })),
    period: (param("donem") as DatePreset | undefined) ?? "son30gun",
    compare: (param("kiyas") as CompareMode | undefined) ?? "none",
    view: (chart?.gorsel as ViewKind | undefined) ?? "tablo",
  };
}
