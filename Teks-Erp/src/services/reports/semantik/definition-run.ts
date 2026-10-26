// =============================================================================
// KAYITLI RAPOR KOŞUSU — tanım gövdesi + parametreler → blok blok semantik sorgu (R1-KAYIT)
// =============================================================================
// Bloklar SIRAYLA koşar (her biri kendi kısa okuma tx'i + koşu satırı, `calistirici.ts`). İzinsiz blok
// raporu düşürmez: "Bu bölüm için yetkiniz yok" olarak döner — paylaşım görünürlük verir, veri
// yetkisi VERMEZ. Parametre değeri yalnız beyanlı türüyle kabul edilir; tarih fabrika gününden çözülür.
// =============================================================================
import { z } from "zod";
import { AppError } from "../../../utils/app-error";
import { factoryDayStart, factoryDayStartOfKey, factoryYmd } from "../../../constants/time";
import { defaultDeps, runSemanticQuery, type RunOrigin, type SemanticResult } from "./calistirici";
import { isFilterGroup, type SemanticFilterGroup, type SemanticFilterLeaf, type SemanticQueryInput } from "./derleyici";
import type { AccessContext } from "./izin";
import { SEMANTIC_CUBES } from "./katalog";
import { runAnalysis, type AnalysisStats } from "./analiz";
import { analysisQueryShell, planAnalysisBlock } from "./analiz-blok";
import { isAnalysisIssue } from "./analiz-plan";
import { narrativeOf } from "./anlati-blok";
import type { AnalysisInput } from "../anlati/gozlem";
import type { AnlatiCumlesi } from "../sunum/sunum.types";
import type { RaporSunumu } from "../sunum/sunum.types";
import { COMPARE_MODES, DATE_PRESETS, type AnalysisBlock, type BlockQuery, type FilterRuleDef, type FilterTreeDef, isFilterRuleDef, type DefinitionBlock, type DefinitionParameter, type ReportDefinitionBody } from "./rapor-tanimi.schema";

export const NO_ACCESS_MESSAGE = "Bu bölüm için yetkiniz yok.";
const HOUR_MS = 3_600_000;

const dateRangeValue = z.union([
  z.enum(DATE_PRESETS),
  z.object({ baslangic: z.string().datetime(), bitis: z.string().datetime() }).strict(),
]);

/** Koşu parametresi: anahtar = tanımdaki `ad`; bilinmeyen anahtar 400 (sessiz yutma yok). */
export const runParamsSchema = z.record(z.string().max(32), z.unknown()).default({});

export type ResolvedParam =
  | { tur: "tarih"; from: Date; to: Date }
  | { tur: "kiyas"; mode: (typeof COMPARE_MODES)[number] }
  | { tur: "secim"; values: string[] }
  | { tur: "sayi"; value: number };

function paramError(name: string, message: string): AppError {
  return AppError.badRequest(`"${name}" parametresi: ${message}`, { code: "RAPOR_PARAMETRE_GECERSIZ", parametre: name });
}

function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Ön ayar adı → fabrika günü sınırlı aralık (bitiş = şimdi; geçmiş dönemde dönem sonu). */
export function resolveDatePreset(preset: (typeof DATE_PRESETS)[number], now: Date = new Date()): { from: Date; to: Date } {
  const today = factoryYmd(now);
  const [y, m] = today.split("-") as [string, string];
  switch (preset) {
    case "bugun":
      return { from: factoryDayStart(now), to: now };
    case "dun":
      return { from: factoryDayStartOfKey(addDays(today, -1)), to: factoryDayStartOfKey(today) };
    case "son7gun":
      return { from: factoryDayStartOfKey(addDays(today, -6)), to: now };
    case "son30gun":
      return { from: factoryDayStartOfKey(addDays(today, -29)), to: now };
    case "son90gun":
      return { from: factoryDayStartOfKey(addDays(today, -89)), to: now };
    case "buAy":
      return { from: factoryDayStartOfKey(`${y}-${m}-01`), to: now };
    case "gecenAy": {
      const prev = new Date(Date.UTC(Number(y), Number(m) - 2, 1)).toISOString().slice(0, 10);
      return { from: factoryDayStartOfKey(prev), to: factoryDayStartOfKey(`${y}-${m}-01`) };
    }
    case "buYil":
      return { from: factoryDayStartOfKey(`${y}-01-01`), to: now };
  }
}

function resolveOne(p: DefinitionParameter, raw: unknown, now: Date): ResolvedParam {
  switch (p.tur) {
    case "tarihAraligi": {
      const v = dateRangeValue.safeParse(raw ?? p.varsayilan);
      if (!v.success) throw paramError(p.ad, `geçerli bir dönem değil (${DATE_PRESETS.join(", ")} ya da başlangıç/bitiş).`);
      if (typeof v.data === "string") return { tur: "tarih", ...resolveDatePreset(v.data, now) };
      const from = new Date(v.data.baslangic);
      const to = new Date(v.data.bitis);
      if (from > to) throw paramError(p.ad, "başlangıç bitişten sonra olamaz.");
      return { tur: "tarih", from, to };
    }
    case "mutlakPencere": {
      const v = z.number().int().min(1).max(168).safeParse(raw ?? p.varsayilanSaat);
      if (!v.success) throw paramError(p.ad, "1–168 saat arasında olmalı.");
      return { tur: "tarih", from: new Date(now.getTime() - v.data * HOUR_MS), to: now };
    }
    case "kiyas": {
      const v = z.enum(COMPARE_MODES).safeParse(raw ?? p.varsayilan);
      if (!v.success) throw paramError(p.ad, `geçerli kıyas: ${COMPARE_MODES.join(", ")}.`);
      return { tur: "kiyas", mode: v.data };
    }
    case "boyutSecimi": {
      // "Tümü" = anahtar yok ya da boş liste → süzgeç kuralı düşer.
      const v = z.array(z.string().min(1).max(200)).max(p.coklu ? 500 : 1).safeParse(raw ?? []);
      if (!v.success) throw paramError(p.ad, p.coklu ? "değer listesi bekleniyor." : "tek değer seçilebilir.");
      return { tur: "secim", values: v.data };
    }
    case "sayi": {
      const v = z.number().finite().safeParse(raw ?? p.varsayilan);
      if (!v.success) throw paramError(p.ad, "sayı bekleniyor.");
      if ((p.en !== undefined && v.data < p.en) || (p.enFazla !== undefined && v.data > p.enFazla)) throw paramError(p.ad, "izinli aralığın dışında.");
      return { tur: "sayi", value: v.data };
    }
  }
}

/** Beyanlı parametreleri çözer; tanımda olmayan anahtar 400. */
export function resolveParams(body: ReportDefinitionBody, raw: Record<string, unknown>, now: Date = new Date()): Map<string, ResolvedParam> {
  const declared = new Map(body.parametreler.map((p) => [p.ad, p]));
  for (const key of Object.keys(raw)) {
    if (!declared.has(key)) throw AppError.badRequest(`Raporda "${key}" adında parametre yok.`, { code: "RAPOR_PARAMETRE_GECERSIZ", parametre: key });
  }
  const out = new Map<string, ResolvedParam>();
  for (const p of body.parametreler) out.set(p.ad, resolveOne(p, raw[p.ad], now));
  return out;
}

const refOf = (v: unknown): string | null => (typeof v === "string" && v.startsWith("$") ? v.slice(1) : null);

/** Parametresi "Tümü" kalan koşul her satırı tutar: `true` (koşul yazılmaz). */
function settleRule(r: FilterRuleDef, params: Map<string, ResolvedParam>): SemanticFilterLeaf | true {
  const ref = refOf(r.value);
  if (!ref) return { alan: r.field, islec: r.operator, deger: r.value };
  const p = params.get(ref);
  if (p?.tur !== "secim" || p.values.length === 0) return true;
  const multi = p.values.length > 1;
  const islec = multi && r.operator === "=" ? "in" : multi && r.operator === "!=" ? "notIn" : r.operator;
  return { alan: r.field, islec, deger: islec === "in" || islec === "notIn" ? p.values : p.values[0]! };
}

/**
 * Süzgeç ağacına parametre yerleştirir. Her satırı tutan koşul "ve" grubunda düşer, "veya"
 * grubunu bütünüyle doğru yapar (grup düşer) — koşulu "veya"dan çıkarmak süzgeci daraltırdı.
 */
function settleFilter(tree: FilterTreeDef | undefined, params: Map<string, ResolvedParam>): Pick<SemanticQueryInput, "suzgec" | "suzgecBaglaci"> {
  const join = (c: "and" | "or") => (c === "or" ? "veya" : "ve") as "ve" | "veya";
  const items: Array<SemanticFilterLeaf | SemanticFilterGroup> = [];
  for (const r of tree?.rules ?? []) {
    let v: SemanticFilterLeaf | SemanticFilterGroup | true;
    if (isFilterRuleDef(r)) v = settleRule(r, params);
    else {
      const inner: SemanticFilterLeaf[] = [];
      let all = false;
      for (const x of r.rules) {
        const s = settleRule(x, params);
        if (s !== true) inner.push(s);
        else if (r.combinator === "or") all = true;
      }
      v = all || inner.length === 0 ? true : { baglac: join(r.combinator), kurallar: inner };
    }
    if (v !== true) items.push(v);
    else if (tree!.combinator === "or") return { suzgec: [] };
  }
  return items.length ? { suzgec: items, suzgecBaglaci: join(tree!.combinator) } : { suzgec: [] };
}

/** Tanım sorgusu → semantik sorgu girdisi (parametreler yerleşmiş, `$ad` kalmaz). */
export function toSemanticInput(
  q: BlockQuery,
  params: Map<string, ResolvedParam>,
  body: ReportDefinitionBody,
  opts: { asTable: boolean; refresh: boolean },
): SemanticQueryInput {
  const { asTable, refresh } = opts;
  const filter = settleFilter(q.suzgec, params);
  const time = q.zaman ? params.get(q.zaman.param) : undefined;
  const compareRef = q.zaman?.kiyas ? params.get(q.zaman.kiyas.slice(1)) : undefined;
  const capRef = refOf(q.tavan);
  const capParam = capRef ? params.get(capRef) : undefined;
  const cap = typeof q.tavan === "number" ? q.tavan : capParam?.tur === "sayi" ? Math.min(50, Math.max(1, Math.round(capParam.value))) : undefined;
  const cube = SEMANTIC_CUBES.find((c) => c.id === q.kup);
  const helper = q.olculer.some((id) => cube?.measures.find((m) => m.id === id)?.kind === "helper");
  const timeDim = q.boyutlar.some((id) => cube?.dimensions.find((d) => d.id === id)?.kind === "time");
  const periods = asTable && body.donemKiyasi && !helper && !timeDim ? { birim: body.donemKiyasi.birim, adet: body.donemKiyasi.adet } : undefined;
  return {
    kup: q.kup,
    olculer: q.olculer,
    boyutlar: q.boyutlar,
    ...filter,
    ...(time?.tur === "tarih" ? { dateFrom: time.from.toISOString(), dateTo: time.to.toISOString() } : {}),
    ...(compareRef?.tur === "kiyas" && !periods ? { compare: compareRef.mode } : {}),
    ...(periods ? { donemler: periods } : {}),
    ...(cap !== undefined ? { tavan: cap } : {}),
    ...(refresh ? { yenile: true } : {}),
  };
}

export type BlockOutcome =
  | {
      id: string; tur: DefinitionBlock["tur"]; baslik: string | null; durum: "tamam"; sonuclar: SemanticResult[]; metin?: string; anlati?: AnlatiCumlesi[];
      /** R3-ISTAT: analiz bloğunun sunumu + kart sayıları. */
      analiz?: { sunum: RaporSunumu; istatistik: AnalysisStats | null };
    }
  | { id: string; tur: DefinitionBlock["tur"]; baslik: string | null; durum: "yetkisiz" | "desteklenmiyor"; mesaj: string };

function isNoAccess(e: unknown): boolean {
  return e instanceof AppError && e.statusCode === 403 && (e.details as { code?: string } | undefined)?.code === "SEMANTIK_IZIN_YOK";
}

function queriesOf(b: DefinitionBlock): BlockQuery[] {
  if (b.tur === "kpi") return b.sorgular;
  if (b.tur === "anaSayi" || b.tur === "grafik" || b.tur === "tablo" || b.tur === "varyant" || b.tur === "donem") return [b.sorgu];
  return [];
}

/**
 * Bloğun semantik sorgu girdileri — çalıştırıcı ve `test_rapor_duzen` AYNI yoldan okur. `duzen` buraya
 * hiç girmez: sıralama/genişlik/sayfa kesmesi sayıyı değiştiremez.
 */
export function blockSemanticInputs(b: DefinitionBlock, params: Map<string, ResolvedParam>, body: ReportDefinitionBody, refresh: boolean): SemanticQueryInput[] {
  return queriesOf(b).map((q) => {
    const input = toSemanticInput(q, params, body, { asTable: b.tur === "tablo", refresh });
    if (b.tur === "varyant") return { ...input, tavan: b.ilkN };
    if (b.tur !== "donem") return input;
    const periods: SemanticQueryInput = { ...input, donemler: { birim: b.birim, adet: b.adet } };
    delete periods.compare;
    return periods;
  });
}

/** Gövdeyi SIRAYLA koşar (tx + Promise.all yok); izin eksiği blok düzeyinde kalır. */
export async function runDefinitionBlocks(
  body: ReportDefinitionBody,
  params: Map<string, ResolvedParam>,
  ctx: AccessContext,
  opts: { origin: RunOrigin | null; refresh: boolean },
): Promise<BlockOutcome[]> {
  const { origin, refresh } = opts;
  const out: BlockOutcome[] = [];
  const analysisInputs = new Map<string, AnalysisInput>();
  for (const b of body.bloklar) {
    const head = { id: b.id, tur: b.tur, baslik: b.baslik ?? null };
    if (b.tur === "metin") {
      out.push({ ...head, durum: "tamam", sonuclar: [], metin: b.metin });
      continue;
    }
    if (b.tur === "anlati") {
      out.push({ ...head, durum: "tamam", sonuclar: [], anlati: [] }); // yer tutucu: diğer bloklardan SONRA dolar
      continue;
    }
    if (b.tur === "analiz") {
      out.push(await runAnalysisBlock(b, { head, params, body, ctx, opts: { origin, refresh }, analysisInputs }));
      continue;
    }
    const results: SemanticResult[] = [];
    let denied = false;
    for (const input of blockSemanticInputs(b, params, body, refresh)) {
      try {
        results.push(await runSemanticQuery(input, ctx, undefined, { ...defaultDeps, origin }));
      } catch (e) {
        if (!isNoAccess(e)) throw e;
        denied = true;
        break;
      }
    }
    out.push(denied ? { ...head, durum: "yetkisiz", mesaj: NO_ACCESS_MESSAGE } : { ...head, durum: "tamam", sonuclar: results });
  }
  return out.map((o, i) => { const b = body.bloklar[i]; return b.tur === "anlati" && o.durum === "tamam" ? { ...o, anlati: narrativeOf(b, out, analysisInputs) } : o; });
}

/** Analiz bloğu: parametreler sorgu bloklarıyla aynı çözülür; izin eksiği blokta kalır. */
interface AnalysisBlockRun {
  head: { id: string; tur: DefinitionBlock["tur"]; baslik: string | null };
  params: Map<string, ResolvedParam>;
  body: ReportDefinitionBody;
  ctx: AccessContext;
  opts: { origin: RunOrigin | null; refresh: boolean };
  analysisInputs: Map<string, AnalysisInput>;
}

async function runAnalysisBlock(b: AnalysisBlock, { head, params, body, ctx, opts, analysisInputs }: AnalysisBlockRun): Promise<BlockOutcome> {
  const plan = planAnalysisBlock(b);
  if (isAnalysisIssue(plan)) throw AppError.badRequest(plan.mesaj, { code: plan.kod, alan: plan.alan });
  const input = toSemanticInput(analysisQueryShell(b, plan), params, body, { asTable: false, refresh: opts.refresh });
  try {
    const r = await runAnalysis(
      {
        yontem: b.yontem, x: b.x, y: b.y, suzgec: input.suzgec.filter((f): f is SemanticFilterLeaf => !isFilterGroup(f)),
        ...(b.kup ? { kup: b.kup } : {}), ...(b.maruziyet ? { maruziyet: b.maruziyet } : {}), ...(b.kirilim ? { kirilim: b.kirilim } : {}),
        ...(input.dateFrom ? { dateFrom: input.dateFrom } : {}), ...(input.dateTo ? { dateTo: input.dateTo } : {}),
        ...(opts.refresh ? { yenile: true } : {}),
      },
      ctx,
      { deps: { ...defaultDeps, origin: opts.origin }, ...(b.baslik ? { baslik: b.baslik } : {}) },
    );
    analysisInputs.set(b.id, r.anlatiGirdisi);
    return { ...head, durum: "tamam", sonuclar: r.sonuclar, analiz: { sunum: r.sunum, istatistik: r.istatistik } };
  } catch (e) {
    if (!isNoAccess(e)) throw e;
    return { ...head, durum: "yetkisiz", mesaj: NO_ACCESS_MESSAGE };
  }
}
