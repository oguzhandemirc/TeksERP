// =============================================================================
// Kuyular — Satır / Sütun / Ölçü / Süzgeç / Varyant ↔ blok `sorgu`su (saf; R2-VERI)
// =============================================================================
// Bırakma kuralları ANINDA Türkçe uyarı içindir; kesin hüküm sunucunun `dogrula`/`onizle` cevabıdır.
// Alan kimlikleri yalnız katalog ucundan gelir — burada izin/modül süzmesi YOK (sunucu süzdü).
// =============================================================================
import type { CatalogCube } from "../custom-api";
import type { DefinitionBlock, DefinitionQuery } from "../layout/layout-model";
import { countRules, fromQueryFilter, MAX_FILTER_RULES } from "./filter-model";
import { chartAfterChange, type ChartShape } from "./suggest-chart";

export type WellKind = "satir" | "sutun" | "olcu" | "suzgec" | "varyant";
export type CatalogMeasure = CatalogCube["olculer"][number];
export type CatalogDimension = CatalogCube["boyutlar"][number];

/** Ağaçtan sürüklenen alan: küp + tür + kimlik (ad/açıklama katalog nesnesinde). */
export type DataField = { cube: string; kind: "measure"; measure: CatalogMeasure } | { cube: string; kind: "dimension"; dimension: CatalogDimension };

export const fieldId = (f: DataField) => (f.kind === "measure" ? f.measure.kimlik : f.dimension.kimlik);
export const fieldName = (f: DataField) => (f.kind === "measure" ? f.measure.ad : f.dimension.ad);

export const WELL_LABELS: Record<WellKind, string> = { satir: "Satır", sutun: "Sütun", olcu: "Ölçü", suzgec: "Süzgeç", varyant: "Varyant" };

const WELLS_BY_KIND: Record<string, readonly WellKind[]> = {
  anaSayi: ["olcu", "suzgec"],
  grafik: ["satir", "sutun", "olcu", "suzgec"],
  tablo: ["satir", "sutun", "olcu", "suzgec"],
  varyant: ["varyant", "olcu", "suzgec"],
  donem: ["satir", "olcu", "suzgec"],
};

const MEASURE_LIMIT: Record<string, number> = { anaSayi: 1, grafik: 2, tablo: 8, varyant: 1, donem: 1 };

/** Bölüm türünün kuyuları; sorgusuz bölümde (not, anlatı, yan sayılar) kuyu yok. */
export function wellsFor(block: DefinitionBlock): readonly WellKind[] {
  return block.sorgu ? (WELLS_BY_KIND[block.tur] ?? []) : [];
}

export interface WellContents {
  satir: string[];
  sutun: string[];
  olcu: string[];
  varyant: string[];
}

export function wellContents(block: DefinitionBlock): WellContents {
  const q = block.sorgu;
  const dims = q?.boyutlar ?? [];
  if (block.tur === "varyant") return { satir: [], sutun: [], olcu: q?.olculer ?? [], varyant: dims.slice(0, 1) };
  return { satir: dims.slice(0, 1), sutun: dims.slice(1, 2), olcu: q?.olculer ?? [], varyant: [] };
}

export type DropVerdict = { ok: true } | { ok: false; message: string };

const refuse = (message: string): DropVerdict => ({ ok: false, message });

function helperConflict(cube: CatalogCube, measures: readonly string[], dimension: CatalogDimension, verb: string): string | null {
  for (const id of measures) {
    const m = cube.olculer.find((x) => x.kimlik === id);
    if (m?.boyutlar && !m.boyutlar.includes(dimension.kimlik)) return `“${m.ad}” ölçüsü “${dimension.ad}” ile ${verb}.`;
  }
  return null;
}

function checkMeasure(block: DefinitionBlock, cube: CatalogCube, m: CatalogMeasure): DropVerdict {
  const q = block.sorgu!;
  const limit = MEASURE_LIMIT[block.tur] ?? 1;
  if (q.olculer.includes(m.kimlik)) return refuse(`“${m.ad}” zaten Ölçü kuyusunda.`);
  if (limit > 1 && q.olculer.length >= limit) return refuse(`Bu bölüm en çok ${limit} ölçü alır.`);
  if (m.boyutlar) {
    const used = [...(q.boyutlar ?? []), ...fromQueryFilter(q.suzgec).rules.flatMap((r) => ("field" in r ? [r.field] : []))];
    const bad = used.find((d) => !m.boyutlar!.includes(d));
    if (bad) return refuse(`“${m.ad}” ölçüsü “${cube.boyutlar.find((d) => d.kimlik === bad)?.ad ?? bad}” ile kullanılamaz; önce o alanı çıkarın.`);
  }
  return { ok: true };
}

function checkDimension(block: DefinitionBlock, cube: CatalogCube, well: WellKind, d: CatalogDimension): DropVerdict {
  const q = block.sorgu!;
  const c = wellContents(block);
  if (well === "suzgec") {
    if (d.tur === "zaman") return refuse("Zaman süzgeç olamaz; tarih aralığını raporun dönemi belirler.");
    if (d.islecler.length === 0) return refuse(`“${d.ad}” süzgeç olarak kullanılamaz.`);
    if (countRules(fromQueryFilter(q.suzgec)) >= MAX_FILTER_RULES) return refuse(`Bir bölümde en çok ${MAX_FILTER_RULES} süzgeç olur.`);
    const blocked = helperConflict(cube, q.olculer, d, "süzülemez");
    return blocked ? refuse(blocked) : { ok: true };
  }
  if (well === "varyant" && d.tur === "zaman") return refuse("Kırılım kartları zamanla kurulmaz; bir kategori seçin.");
  if (well === "sutun" && c.satir.length === 0) return refuse("Önce Satır kuyusunu doldurun.");
  const other = well === "satir" ? c.sutun : well === "sutun" ? c.satir : [];
  if ([...c[well as "satir" | "sutun" | "varyant"], ...other].includes(d.kimlik)) return refuse(`“${d.ad}” zaten bu bölümde kırılım.`);
  const conflict = helperConflict(cube, q.olculer, d, "kırılamaz");
  return conflict ? refuse(conflict) : { ok: true };
}

/** Bırakma kuralı: kuyu var mı, aynı küp mü, ölçü yalnız Ölçü'ye, yardımcı ölçünün beyanlı boyutları… */
export function checkDrop(block: DefinitionBlock, cube: CatalogCube | undefined, well: WellKind, field: DataField): DropVerdict {
  if (!wellsFor(block).includes(well)) return refuse(`Bu bölümde ${WELL_LABELS[well]} kuyusu yok.`);
  if (!cube || field.cube !== block.sorgu!.kup) return refuse(`Bu bölüm “${cube?.ad ?? block.sorgu!.kup}” verisinden okuyor; başka konudan alan eklenemez.`);
  if (field.kind === "measure") return well === "olcu" ? checkMeasure(block, cube, field.measure) : refuse("Ölçüler yalnız Ölçü kuyusuna bırakılır.");
  if (well === "olcu") return refuse(`Ölçü kuyusuna yalnız ölçü bırakılır; “${field.dimension.ad}” bir boyut.`);
  return checkDimension(block, cube, well, field.dimension);
}

/** Kabul edilmiş bırakmanın yeni sorgusu (Süzgeç kuyusu kurucuyla açılır, burada değil). */
export function applyDrop(block: DefinitionBlock, well: Exclude<WellKind, "suzgec">, id: string): DefinitionQuery {
  const q = block.sorgu!;
  const c = wellContents(block);
  if (well === "olcu") return { ...q, olculer: (MEASURE_LIMIT[block.tur] ?? 1) === 1 ? [id] : [...q.olculer, id] };
  if (well === "varyant") return { ...q, boyutlar: [id] };
  if (well === "satir") return { ...q, boyutlar: [id, ...c.sutun] };
  return { ...q, boyutlar: [...c.satir, id] };
}

/** Kuyudan çıkarma; Satır boşalınca Sütun Satır'a kayar. Son ölçü çıkmaz (şema en az bir ölçü ister). */
export function removeFromWell(block: DefinitionBlock, well: Exclude<WellKind, "suzgec">, id: string): DefinitionQuery | null {
  const q = block.sorgu!;
  if (well === "olcu") return q.olculer.length > 1 ? { ...q, olculer: q.olculer.filter((x) => x !== id) } : null;
  return { ...q, boyutlar: (q.boyutlar ?? []).filter((x) => x !== id) };
}

export function shapeOf(q: DefinitionQuery, cube: CatalogCube | undefined): ChartShape {
  const kindOf = (id: string) => cube?.boyutlar.find((d) => d.kimlik === id)?.tur ?? "kategori";
  return { measureCount: q.olculer.length, dimensionKinds: (q.boyutlar ?? []).map(kindOf) };
}

/** Blok yaması: yeni sorgu + (grafikse) önerilen türe kayan grafik. */
export function patchFor(block: DefinitionBlock, next: DefinitionQuery, cube: CatalogCube | undefined): Partial<DefinitionBlock> {
  if (block.tur !== "grafik" || !block.sorgu) return { sorgu: next };
  const gorsel = chartAfterChange(block.gorsel as string | undefined, shapeOf(block.sorgu, cube), shapeOf(next, cube));
  return gorsel === undefined ? { sorgu: next } : { sorgu: next, gorsel };
}

export interface WellIssue {
  well: WellKind | null;
  /** Kuyudaki sıra (çip); null = kuyunun ya da bölümün geneli. */
  index: number | null;
  mesaj: string;
}

const ISSUE_PATH = /^bloklar\[(\d+)\]\.sorgu(?:\.(olculer|boyutlar|suzgec)(?:\.rules)?(?:\[(\d+)\])?)?/;

/** `dogrula` hatasının JSON yolu → ilgili kuyu/çip (yalnız verilen bölümün hataları). */
export function issuesForBlock(issues: ReadonlyArray<{ yol: string; mesaj: string }>, blockIndex: number, block: DefinitionBlock): WellIssue[] {
  return issues.flatMap((h): WellIssue[] => {
    if (!h.yol.startsWith(`bloklar[${blockIndex}]`)) return [];
    const m = ISSUE_PATH.exec(h.yol);
    const part = m?.[2];
    const index = m?.[3] !== undefined ? Number(m[3]) : null;
    if (part === "olculer") return [{ well: "olcu", index, mesaj: h.mesaj }];
    if (part === "suzgec") return [{ well: "suzgec", index, mesaj: h.mesaj }];
    if (part === "boyutlar") {
      const well: WellKind = block.tur === "varyant" ? "varyant" : index === 1 ? "sutun" : "satir";
      return [{ well, index: well === "sutun" ? 0 : index, mesaj: h.mesaj }];
    }
    return [{ well: null, index: null, mesaj: h.mesaj }];
  });
}
