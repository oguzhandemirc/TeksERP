// =============================================================================
// RAPOR TANIMI ŞEMASI — kayıtlı/özel raporun TEK gövde sözleşmesi (R1-KAYIT; plan §3.2)
// =============================================================================
// Oluşturucu, kod modu ve kayıtlı rapor aynı gövdeyi taşır; istemci şemayı KOPYALAMAZ — doğrulama
// yalnız burada (`POST /api/rapor-tanimlari/dogrula` Türkçe hata + JSON yolu döner). Tel anahtarları
// Türkçe (kullanıcıya görünen JSON), iç adlar İngilizce. Kimlikler katalogda aranır: serbest metin
// SQL'e hiç ulaşmaz, derleyici (`derleyici.ts`) yeniden doğrular.
// =============================================================================
import { z } from "zod";
import { editRatio } from "../../../utils/string-similarity";
import { SEMANTIC_CUBES } from "./katalog";
import type { SemanticCube } from "./tipler";
import { andFilterSchema, checkFilterTree, filterTreeSchema } from "./suzgec-agaci";

export { MAX_FILTER_RULES, isFilterRuleDef, type FilterInnerGroupDef, type FilterRuleDef, type FilterTreeDef } from "./suzgec-agaci";
import { analysisQueryShell, planAnalysisBlock } from "./analiz-blok";
import { ANALYSIS_METHODS, isAnalysisIssue } from "./analiz-plan";

export const DEFINITION_SCHEMA_VERSION = 1;
export const MAX_BLOCKS = 20;
export const MAX_KPI = 3;
export const MAX_VARIANT_VALUES = 6;
export const MAX_COMPARE_PERIODS = 12;

/** Tarih aralığı ön ayarları — fabrika günüyle çözülür (`rapor-tanimi.service.ts`). */
export const DATE_PRESETS = ["bugun", "dun", "son7gun", "son30gun", "son90gun", "buAy", "gecenAy", "buYil"] as const;
export const COMPARE_MODES = ["none", "prev", "prevYear"] as const;
export const CHART_KINDS = ["cizgi", "cubuk", "yiginCubuk", "pasta", "isiHaritasi", "sacilim", "kutu", "kucukCoklu"] as const;
export const NARRATIVE_RULES = ["anaSayiKiyas", "enBuyukPay", "korelasyon", "orneklemUyarisi"] as const;
export { ANALYSIS_METHODS };

const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/, "Ad harfle başlar; yalnız harf ve rakam (en çok 32).");
const blockId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,15}$/, "Blok kimliği harfle başlar; yalnız harf ve rakam (en çok 16).");
const reference = z.string().regex(/^\$[a-zA-Z][a-zA-Z0-9]{0,31}$/, "Parametre başvurusu `$ad` biçimindedir.");
const label = z.string().trim().min(1).max(80).optional();
const identifier = z.string().min(1).max(96);

const parameterSchema = z.discriminatedUnion("tur", [
  z.object({ ad: name, tur: z.literal("tarihAraligi"), etiket: label, varsayilan: z.enum(DATE_PRESETS).default("son30gun") }).strict(),
  z.object({ ad: name, tur: z.literal("mutlakPencere"), etiket: label, varsayilanSaat: z.number().int().min(1).max(168).default(24) }).strict(),
  z.object({ ad: name, tur: z.literal("kiyas"), etiket: label, varsayilan: z.enum(COMPARE_MODES).default("prev") }).strict(),
  z.object({ ad: name, tur: z.literal("boyutSecimi"), etiket: label, boyut: identifier, coklu: z.boolean().default(true) }).strict(),
  z
    .object({ ad: name, tur: z.literal("sayi"), etiket: label, varsayilan: z.number().finite(), en: z.number().finite().optional(), enFazla: z.number().finite().optional() })
    .strict(),
]);


export const blockQuerySchema = z
  .object({
    kup: identifier,
    olculer: z.array(identifier).min(1).max(8),
    boyutlar: z.array(identifier).max(3).default([]),
    suzgec: filterTreeSchema.optional(),
    zaman: z.object({ param: name, kiyas: reference.optional() }).strict().optional(),
    tavan: z.union([z.number().int().min(1).max(50), reference]).optional(),
  })
  .strict();

const title = z.string().trim().min(1).max(120).optional();

const blockSchema = z.discriminatedUnion("tur", [
  z.object({ id: blockId, tur: z.literal("anaSayi"), baslik: title, sorgu: blockQuerySchema }).strict(),
  z.object({ id: blockId, tur: z.literal("kpi"), baslik: title, sorgular: z.array(blockQuerySchema).min(1).max(MAX_KPI) }).strict(),
  // R2-DUZEN: varyant = tek ölçünün tek boyuttaki ilk N değeri (küçük çoklular); donem = sorgunun dönem sütunları.
  z.object({ id: blockId, tur: z.literal("varyant"), baslik: title, sorgu: blockQuerySchema, ilkN: z.number().int().min(2).max(MAX_VARIANT_VALUES).default(MAX_VARIANT_VALUES) }).strict(),
  z
    .object({ id: blockId, tur: z.literal("donem"), baslik: title, sorgu: blockQuerySchema, birim: z.enum(["gun", "hafta", "ay"]), adet: z.number().int().min(2).max(MAX_COMPARE_PERIODS) })
    .strict(),
  z.object({ id: blockId, tur: z.literal("grafik"), baslik: title, gorsel: z.enum(CHART_KINDS), sorgu: blockQuerySchema }).strict(),
  z
    .object({ id: blockId, tur: z.literal("tablo"), baslik: title, sorgu: blockQuerySchema, pivot: z.object({ satir: identifier, sutun: identifier }).strict().optional() })
    .strict(),
  z.object({ id: blockId, tur: z.literal("anlati"), baslik: title, kurallar: z.array(z.enum(NARRATIVE_RULES)).min(1).max(4), enFazla: z.number().int().min(1).max(5).default(3) }).strict(),
  z
    .object({
      id: blockId,
      tur: z.literal("analiz"),
      baslik: title,
      yontem: z.enum(ANALYSIS_METHODS),
      // R3-ISTAT: küp verilmezse x/y'yi taşıyan ilk küp; `kirilim` iki ölçü kıyasının birimi (varsayılan gün).
      kup: identifier.optional(),
      x: identifier,
      y: identifier,
      maruziyet: identifier.optional(),
      kirilim: identifier.optional(),
      suzgec: andFilterSchema.optional(),
      zaman: z.object({ param: name }).strict().optional(),
    })
    .strict(),
  z.object({ id: blockId, tur: z.literal("metin"), baslik: title, metin: z.string().trim().min(1).max(2000) }).strict(),
]);

export const reportDefinitionBodySchema = z
  .object({
    surum: z.literal(DEFINITION_SCHEMA_VERSION),
    baslik: z.string().trim().min(1).max(150),
    parametreler: z.array(parameterSchema).max(10).default([]),
    varyant: z
      .object({ boyut: identifier, ilkN: z.number().int().min(1).max(MAX_VARIANT_VALUES).default(MAX_VARIANT_VALUES), gorunum: z.enum(["kucukCoklu", "secici"]).default("kucukCoklu") })
      .strict()
      .optional(),
    donemKiyasi: z.object({ birim: z.enum(["gun", "hafta", "ay"]), adet: z.number().int().min(2).max(MAX_COMPARE_PERIODS) }).strict().optional(),
    bloklar: z.array(blockSchema).min(1).max(MAX_BLOCKS),
    duzen: z
      .array(
        z
          .object({
            i: blockId,
            x: z.number().int().min(0).max(11),
            y: z.number().int().min(0).max(400),
            w: z.number().int().min(1).max(12),
            h: z.number().int().min(1).max(40),
            // Yalnız baskı: PDF'te blok yeni sayfadan başlar. Düzen SUNUMDUR — koşu girdisine hiç ulaşmaz.
            sayfaKesmesi: z.boolean().optional(),
          })
          .strict(),
      )
      .max(MAX_BLOCKS)
      .default([]),
  })
  .strict();

export type ReportDefinitionBody = z.infer<typeof reportDefinitionBodySchema>;
export type DefinitionBlock = ReportDefinitionBody["bloklar"][number];
export type DefinitionParameter = ReportDefinitionBody["parametreler"][number];
export type BlockQuery = z.infer<typeof blockQuerySchema>;
export type AnalysisBlock = Extract<DefinitionBlock, { tur: "analiz" }>;
export type NarrativeBlock = Extract<DefinitionBlock, { tur: "anlati" }>;

export interface DefinitionIssue {
  /** JSON yolu — `bloklar[1].sorgu.olculer[0]`. */
  yol: string;
  mesaj: string;
  /** "Şunu mu demek istediniz?" — katalogdaki en yakın kimlik. */
  oneri?: string;
}

export type DefinitionCheck =
  | { gecerli: true; govde: ReportDefinitionBody; gerekenIzinler: string[]; hatalar: [] }
  | { gecerli: false; hatalar: DefinitionIssue[] };

export function pathOf(segments: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const s of segments) out += typeof s === "number" ? `[${s}]` : out ? `.${String(s)}` : String(s);
  return out || "(kök)";
}

/** Zod sorununu Türkçe cümleye çevirir — kullanıcı JSON'u kod modunda kendi yazar. */
function zodMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "unrecognized_keys":
      return `Tanınmayan alan: ${issue.keys.map((k) => `"${k}"`).join(", ")}.`;
    case "invalid_type":
      // Kod modunda kullanıcı bu cümleyi okur: tür adı da Türkçe (zod'un İngilizce "string/number"ı değil).
      return issue.input === undefined ? "Zorunlu alan eksik." : `Beklenen tür: ${({ string: "metin", number: "sayı", int: "tam sayı", boolean: "doğru/yanlış", array: "liste", object: "nesne", null: "boş" } as Record<string, string>)[issue.expected] ?? issue.expected}.`;
    case "invalid_value":
      return `Geçersiz değer; izinli olanlar: ${issue.values.map((v) => JSON.stringify(v)).join(", ")}.`;
    case "too_big":
      return `En fazla ${String(issue.maximum)} olabilir.`;
    case "too_small":
      return `En az ${String(issue.minimum)} olmalı.`;
    case "invalid_union":
      return "Geçersiz yapı; `tur` alanı tanınmıyor ya da eksik.";
    case "invalid_format":
      return issue.message;
    default:
      return issue.message || "Geçersiz değer.";
  }
}

/** Yakın kimlik önerisi (yazım hatası) — eşik altı benzerlikte öneri yok. */
export function suggest(input: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let score = 0.5;
  const needle = input.toLowerCase();
  for (const c of candidates) {
    const s = editRatio(needle, c.toLowerCase());
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return best;
}

interface Walk {
  cubes: readonly SemanticCube[];
  params: Map<string, DefinitionParameter>;
  used: Set<string>;
  issues: DefinitionIssue[];
  permissions: Set<string>;
}

function refName(ref: string): string {
  return ref.slice(1);
}

function bindRef(w: Walk, ref: string, path: string, expected: DefinitionParameter["tur"][]): void {
  const p = w.params.get(refName(ref));
  if (!p) {
    const near = suggest(refName(ref), w.params.keys());
    w.issues.push({ yol: path, mesaj: `Tanımsız parametre başvurusu "${ref}".`, ...(near ? { oneri: `$${near}` } : {}) });
    return;
  }
  w.used.add(p.ad);
  if (!expected.includes(p.tur)) w.issues.push({ yol: path, mesaj: `"${ref}" parametresi burada kullanılamaz (türü ${p.tur}; beklenen ${expected.join(" ya da ")}).` });
}

function checkQuery(w: Walk, q: BlockQuery, path: string): SemanticCube | null {
  const cube = w.cubes.find((c) => c.id === q.kup);
  if (!cube) {
    w.issues.push({ yol: `${path}.kup`, mesaj: `Bilinmeyen küp "${q.kup}".`, oneri: suggest(q.kup, w.cubes.map((c) => c.id)) });
    return null;
  }
  w.permissions.add(cube.permission);
  q.olculer.forEach((id, i) => {
    const m = cube.measures.find((x) => x.id === id);
    if (!m) w.issues.push({ yol: `${path}.olculer[${i}]`, mesaj: `"${cube.name}" küpünde "${id}" ölçüsü yok.`, oneri: suggest(id, cube.measures.map((x) => x.id)) });
    else w.permissions.add(m.permission);
  });
  q.boyutlar.forEach((id, i) => {
    const d = cube.dimensions.find((x) => x.id === id);
    if (!d) w.issues.push({ yol: `${path}.boyutlar[${i}]`, mesaj: `"${cube.name}" küpünde "${id}" boyutu yok.`, oneri: suggest(id, cube.dimensions.map((x) => x.id)) });
    else if (d.permission) w.permissions.add(d.permission);
  });
  if (q.suzgec) {
    checkFilterTree(q.suzgec, cube, `${path}.suzgec`, {
      issue: (i) => w.issues.push(i),
      suggest,
      ref: (value, rp, field) => {
        bindRef(w, value, rp, ["boyutSecimi"]);
        const p = w.params.get(refName(value));
        if (p?.tur === "boyutSecimi" && p.boyut !== field) w.issues.push({ yol: rp, mesaj: `"${value}" "${p.boyut}" boyutunu seçer; bu süzgeç "${field}" alanında.` });
      },
    });
  }
  if (q.zaman) {
    const p = w.params.get(q.zaman.param);
    if (!p) w.issues.push({ yol: `${path}.zaman.param`, mesaj: `Tanımsız parametre "${q.zaman.param}".`, oneri: suggest(q.zaman.param, w.params.keys()) });
    else {
      w.used.add(p.ad);
      if (p.tur !== "tarihAraligi" && p.tur !== "mutlakPencere") w.issues.push({ yol: `${path}.zaman.param`, mesaj: `"${p.ad}" bir tarih parametresi değil.` });
    }
    if (q.zaman.kiyas) bindRef(w, q.zaman.kiyas, `${path}.zaman.kiyas`, ["kiyas"]);
  }
  if (typeof q.tavan === "string") bindRef(w, q.tavan, `${path}.tavan`, ["sayi"]);
  return cube;
}

function checkBlock(w: Walk, b: DefinitionBlock, path: string): void {
  if (b.tur === "anaSayi") {
    checkQuery(w, b.sorgu, `${path}.sorgu`);
    if (b.sorgu.olculer.length !== 1) w.issues.push({ yol: `${path}.sorgu.olculer`, mesaj: "Ana sayı tek ölçü gösterir." });
    if (b.sorgu.boyutlar.length) w.issues.push({ yol: `${path}.sorgu.boyutlar`, mesaj: "Ana sayı kırılımsızdır; boyutu tablo ya da grafiğe taşıyın." });
  } else if (b.tur === "kpi") {
    b.sorgular.forEach((q, i) => checkQuery(w, q, `${path}.sorgular[${i}]`));
  } else if (b.tur === "grafik") {
    checkQuery(w, b.sorgu, `${path}.sorgu`);
  } else if (b.tur === "analiz") {
    const plan = planAnalysisBlock(b, w.cubes);
    if (isAnalysisIssue(plan)) {
      w.issues.push({ yol: `${path}.${plan.alan}`, mesaj: plan.mesaj });
      return;
    }
    checkQuery(w, analysisQueryShell(b, plan), path);
    if (plan.kind !== "table" && "exposure" in plan && plan.exposure) {
      w.permissions.add(plan.exposure.cube.permission);
      w.permissions.add(plan.exposure.measure.permission);
    }
  } else if (b.tur === "tablo") {
    checkQuery(w, b.sorgu, `${path}.sorgu`);
    if (b.pivot) {
      for (const k of ["satir", "sutun"] as const) {
        if (!b.sorgu.boyutlar.includes(b.pivot[k])) w.issues.push({ yol: `${path}.pivot.${k}`, mesaj: `"${b.pivot[k]}" sorgunun boyutlarında yok.` });
      }
    }
  } else if (b.tur === "varyant" || b.tur === "donem") {
    checkSplitBlock(w, b, path);
  }
}

/** Kırılım (varyant) ve dönem kıyası bölümleri: zaman kırılımı ve yardımcı ölçü dönem sütunu üretmez. */
function checkSplitBlock(w: Walk, b: Extract<DefinitionBlock, { tur: "varyant" | "donem" }>, path: string): void {
  const cube = checkQuery(w, b.sorgu, `${path}.sorgu`);
  const timeDim = b.sorgu.boyutlar.some((id) => cube?.dimensions.find((d) => d.id === id)?.kind === "time");
  if (b.tur === "varyant") {
    if (b.sorgu.olculer.length !== 1) w.issues.push({ yol: `${path}.sorgu.olculer`, mesaj: "Kırılım bölümü tek ölçü gösterir." });
    if (b.sorgu.boyutlar.length !== 1) w.issues.push({ yol: `${path}.sorgu.boyutlar`, mesaj: "Kırılım bölümü tek boyutla kurulur." });
    else if (timeDim) w.issues.push({ yol: `${path}.sorgu.boyutlar`, mesaj: "Zamana göre kırılım için dönem kıyası bölümünü kullanın." });
    return;
  }
  if (timeDim) w.issues.push({ yol: `${path}.sorgu.boyutlar`, mesaj: "Dönem kıyası zaman boyutuyla birlikte kurulamaz." });
  if (b.sorgu.olculer.some((id) => cube?.measures.find((m) => m.id === id)?.kind === "helper")) {
    w.issues.push({ yol: `${path}.sorgu.olculer`, mesaj: "Bu ölçü dönem sütunlarına bölünemiyor." });
  }
}

function hasDimension(cubes: readonly SemanticCube[], id: string): boolean {
  return cubes.some((c) => c.dimensions.some((d) => d.id === id));
}

/** Yapı (zod) + anlam (katalog, başvuru, düzen) doğrulaması; kayıtta ve her çalıştırmada koşar. */
export function checkReportDefinition(raw: unknown, cubes: readonly SemanticCube[] = SEMANTIC_CUBES): DefinitionCheck {
  // reportInput: "yanlış tür" ile "eksik alan" ayrılsın (girdi yalnız tür ayrımında okunur, mesaja yazılmaz).
  const parsed = reportDefinitionBodySchema.safeParse(raw, { reportInput: true });
  if (!parsed.success) {
    return { gecerli: false, hatalar: parsed.error.issues.map((i) => ({ yol: pathOf(i.path), mesaj: zodMessage(i) })) };
  }
  const body = parsed.data;
  const w: Walk = { cubes, params: new Map(), used: new Set(), issues: [], permissions: new Set() };
  body.parametreler.forEach((p, i) => {
    if (w.params.has(p.ad)) w.issues.push({ yol: `parametreler[${i}].ad`, mesaj: `"${p.ad}" parametresi iki kez tanımlı.` });
    w.params.set(p.ad, p);
    if (p.tur === "boyutSecimi" && !hasDimension(cubes, p.boyut)) {
      const all = cubes.flatMap((c) => c.dimensions.map((d) => d.id));
      w.issues.push({ yol: `parametreler[${i}].boyut`, mesaj: `Bilinmeyen boyut "${p.boyut}".`, oneri: suggest(p.boyut, all) });
    }
  });
  const ids = new Set<string>();
  body.bloklar.forEach((b, i) => {
    if (ids.has(b.id)) w.issues.push({ yol: `bloklar[${i}].id`, mesaj: `"${b.id}" blok kimliği iki kez kullanılmış.` });
    ids.add(b.id);
    checkBlock(w, b, `bloklar[${i}]`);
  });
  if (body.varyant && !hasDimension(cubes, body.varyant.boyut)) {
    w.issues.push({ yol: "varyant.boyut", mesaj: `Bilinmeyen boyut "${body.varyant.boyut}".`, oneri: suggest(body.varyant.boyut, cubes.flatMap((c) => c.dimensions.map((d) => d.id))) });
  }
  body.duzen.forEach((d, i) => {
    if (!ids.has(d.i)) w.issues.push({ yol: `duzen[${i}].i`, mesaj: `Düzende olmayan blok "${d.i}".`, oneri: suggest(d.i, ids) });
    if (d.x + d.w > 12) w.issues.push({ yol: `duzen[${i}].w`, mesaj: "Blok 12 sütunluk ızgaranın dışına taşıyor." });
  });
  body.parametreler.forEach((p, i) => {
    if (!w.used.has(p.ad)) w.issues.push({ yol: `parametreler[${i}]`, mesaj: `"${p.ad}" parametresine hiçbir blok başvurmuyor.` });
  });
  if (w.issues.length) return { gecerli: false, hatalar: w.issues };
  return { gecerli: true, govde: body, gerekenIzinler: [...w.permissions].sort(), hatalar: [] };
}
