// S1 (Gülkesim, 2026-11-03): BELGE TİPİ TANITMA — şablon önerisi (saf). Kullanıcı fotoğrafta değer kutusuna dokunup alan atar;
// sistem değerin yanındaki BASILI ETİKETİ bulur ve anchor stratejisi üretir (aynı satırda solda → "right", üstte → "below");
// etiket yoksa göreli konum (roi); etiket varsa da değer kutusu konum yedeği olur (bozuk okunan etiket). Kimlik yazıları sınıflandırma anahtarıdır. Belgeler basılıdır (fabrika cevabı 38).
import { type DocumentTemplate, type FieldSpec, type FieldType, type NormRect, type OcrElement, type OcrLine, type OcrRect, type OcrResult, type RoiStrategy, type Strategy, type TableColumnSpec, type TemplateRules } from "./types";
import { DEFAULT_MIN_LABEL_SIMILARITY, buildAnchorContext, findLabelMatches } from "./anchor";
import { resolveRegions } from "./document";
import { buildRows, centerInNormRect, collectLines, unionRect } from "./geometry";
import { isNumericText, sectionStartLabel } from "./labels";
import { validateTemplate } from "./templates";
import { valueShapeOf } from "./value-limit";
import { KG_FAMILY_FIELDS, METER_FAMILY_FIELDS, learnAnchorSkip, meterKgClashes } from "./olcu-cakisma";

/** Tanıtmada atanabilen başlık alanları → motor alan anahtarı + tip (taslak eşlemesi bu anahtarları okur). Anahtar KALICIDIR
 *  (kayıtlı şablonlar bunu taşır) — yalnız etiket değişir. K30: iş emri formu alanları (`hedefMetraj`, `hedefKg`, `not`). */
export const ASSIGNABLE_FIELDS = {
  musteri: { label: "Müşteri", type: "text" },
  partiNo: { label: "Parti No", type: "alnum" },
  toplamMetre: { label: "Gelen metre", type: "decimal" },
  // 2026-11-09: belgedeki gelen kg (fason malın kilosu) — hedef kg DEĞİL; özet satırına ve İE "Gelen kg"ye gider.
  toplamKg: { label: "Gelen kg", type: "decimal" },
  evrakNo: { label: "Evrak No", type: "alnum" },
  tarih: { label: "Tarih", type: "date" },
  siparisNo: { label: "Sipariş No", type: "alnum" },
  topAdet: { label: "Top adedi", type: "integer" },
  // 2026-11-09: kumaş adı/renk belgenin BEYANI (özet satırı itemText/colorText); İE hedefine yalnız formda öneri olur.
  desen: { label: "Gelen kumaş", type: "text" },
  renk: { label: "Gelen renk", type: "text" },
  en: { label: "En (cm)", type: "decimal" },
  hedefMetraj: { label: "Hedef metraj", type: "decimal" },
  hedefKg: { label: "Hedef kg", type: "decimal" },
  not: { label: "Not", type: "text" },
  // Çok blok (2026-11-06): bölümün işlemi (boyahanenin; bilgi) ve gönderenin İE no'su — parti kartı + İE künyesi (K4).
  islem: { label: "İşlem (bilgi)", type: "text" },
  gonderenIsEmriNo: { label: "Müşteri İE No", type: "alnum" },
} as const satisfies Record<string, { label: string; type: FieldType }>;
export type AssignableField = keyof typeof ASSIGNABLE_FIELDS;
/** Zod enum'u için anahtar listesi (uç ↔ motor tek kaynak). */
export const ASSIGNABLE_FIELD_KEYS = Object.keys(ASSIGNABLE_FIELDS) as [AssignableField, ...AssignableField[]];

/** Top tablosu kolonları (başlık yazısına dokunulur). */
export const TABLE_COLUMN_KEYS = { topNo: { label: "Top No", type: "alnum" }, kg: { label: "Kilo", type: "decimal" }, m: { label: "Metre", type: "decimal" }, en: { label: "En", type: "decimal" } } as const;
export type TableColumnKey = keyof typeof TABLE_COLUMN_KEYS;

/** Tanıtılan şablonun kimlik eşiği (şablona yazılır; motor `templateMinScore` ile okur — tek kaynak o). */
export const USER_TEMPLATE_MIN_SCORE = 0.6;

/** Tanıtmada seçilebilecek kimlik yazısı tavanı. Puan oransal (`classify.ts` hits/keywords.length) olduğundan
 *  tavan yalnız kötüye kullanım seddidir; tablet aynası `mobil/.../tanit` içinde aynı değeri taşır. */
export const MAX_TEMPLATE_IDENTIFIERS = 30;

export interface TemplateSuggestInput {
  code: string;
  name: string;
  ocr: OcrResult;
  /** Kutu → alan: `rect` kullanıcının dokunduğu DEĞER kutusu (OCR çerçevesi); `section` = alan bölüm başına okunur. */
  assignments: Array<{ field: AssignableField; rect: OcrRect; section?: boolean }>;
  /** Kimlik yazıları (başlık, firma adı, sütun başlıkları) — sınıflandırma anahtar kelimeleri. */
  identifiers: string[];
  table?: { columns: Array<{ key: TableColumnKey; header: string }>; totalsLabel?: string | null };
  /** Tekrarlayan bölümün başlangıç etiketi (ör. "Sipariş No"); yoksa bölümsüz. */
  sectionStartLabel?: string | null;
  /** Belge tipi kuralları (③ Kurallar); yoksa alan yazılmaz = fabrika ayarı. */
  rules?: TemplateRules;
}

export interface TemplateSuggestion {
  template: DocumentTemplate;
  /** Alan başına üretilen strateji özeti (ekranda "Parti No ← 'Ham PartiNo' sağında"). */
  explain: Array<{ field: string; strategy: "anchor" | "roi"; label: string | null; direction: string | null }>;
  errors: string[];
}

/** Metre/kg ailesi: etiket okuması dokunulan kutuya ulaşmazsa konum stratejisine düşen alanlar (`olcu-cakisma.ts`). */
const MEASURE_FIELDS: ReadonlySet<string> = new Set<string>([...METER_FAMILY_FIELDS, ...KG_FAMILY_FIELDS]);

/** Adet etiketi ("T.Adet", "Top Adedi"): sağındaki sayı metre değil top sayısıdır. */
const COUNT_LABEL = /adet/iu;

/**
 * Çok blok tanıtma kapısı (2026-11-06, Gülkesim demo şablonu: "Gelen metre" T.Adet'in sağındaki 16'ya bağlanmıştı): "Gelen metre"nin
 * etiketi adet etiketi ya da tablonun toplam etiketi olamaz. "Tekrar eden bölümde tablo gerekli" tablette (`teachProblems`) —
 * "Şablonu güncelle" eski tabloyu taşıyabildiği için kararı yalnız tablet bilir.
 */
function teachErrors(input: TemplateSuggestInput, explain: TemplateSuggestion["explain"], t: DocumentTemplate): string[] {
  const out: string[] = meterKgClashErrors(t);
  const meterLabel = explain.find((e) => e.field === "toplamMetre")?.label ?? null;
  const totals = input.table?.totalsLabel?.trim() ?? null;
  const tapped = input.assignments.find((a) => a.field === "toplamMetre");
  const integer = !!tapped && /^\d+$/.test(wordsIn(input.ocr, tapped.rect).trim());
  // Tablolu belgede toplam satırı tablo toplamından okunur; tablosuzda yalnız tam sayı (adet) reddedilir, metre değeri serbest.
  const countRow = !!meterLabel && (COUNT_LABEL.test(meterLabel) || (!!totals && cleanLabel(meterLabel) === cleanLabel(totals)));
  // Bölüm alanı her partinin kendi toplam satırından okunur (beyan = o blok); sayfa başlığındaki tek değer ise bir bloğunkidir.
  const perSection = !!tapped?.section && !!input.sectionStartLabel?.trim();
  if (countRow && (integer || ((input.table?.columns.length ?? 0) > 0 && !perSection))) {
    out.push(`"${meterLabel}" adet/toplam satırıdır — sağındaki sayı top adedi; gelen metre için tablonun Metre sütununu işaretleyin ("Gelen metre" atamasını kaldırın).`);
  }
  return out;
}

const fieldLabel = (k: string) => ASSIGNABLE_FIELDS[k as AssignableField]?.label ?? k;

/** Metre ailesi ↔ kg ailesi aynı hücre (`meterKgClashes`) — tanıtma kapısı; güncelleme birleşimi de bunu sorar. */
export function meterKgClashErrors(t: DocumentTemplate): string[] {
  return meterKgClashes(t).map((c) => `Aynı kutu hem "${fieldLabel(c.meter)}" hem "${fieldLabel(c.kg)}" olamaz — kg için belgedeki kg değerine dokunun.`);
}

/** Kutunun içindeki OCR kelimeleri (merkezi kutuda). */
function wordsIn(ocr: OcrResult, rect: OcrRect): string {
  return collectLines(ocr).flatMap((l) => l.elements ?? []).filter((e) => inside(center(e.rect), rect)).map((e) => e.text).join(" ");
}

const center = (r: OcrRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const vOverlap = (a: OcrRect, b: OcrRect) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
const hOverlap = (a: OcrRect, b: OcrRect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
const inside = (p: { x: number; y: number }, r: OcrRect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const cleanLabel = (t: string) => t.replace(/[:.\s]+$/u, "").replace(/\s+/g, " ").trim();
const isLabelText = (t: string) => t.length >= 2 && t.length <= 40 && !isNumericText(t) && /\p{L}/u.test(t);

/** Etiketin sonundaki saf sayılar etiket değil başka bir değerdir ("T.Adet 5" → "T.Adet"; adet her blokta değişir). */
function labelElements(els: OcrElement[]): OcrElement[] {
  let n = els.length;
  while (n > 0 && /^\d+(?:[.,]\d+)*$/.test(els[n - 1]!.text.trim())) n--;
  return els.slice(0, n);
}

/** Değer kutusunun etiketi: aynı satırda önündeki kelimeler → soldaki satır (aynı hiza) → üstteki satır (yatay çakışan). */
export function findLabelFor(ocr: OcrResult, rect: OcrRect): { label: string; direction: "right" | "below"; rect: OcrRect } | null {
  const lines = collectLines(ocr);
  const c = center(rect);
  const own = lines.find((l) => inside(c, l.rect));
  if (own) {
    const els: OcrElement[] = own.elements ?? [];
    // Değer kelimeleri = kutuyla yatayda yarıdan çok çakışanlar; etiket onların ÖNÜNDEKİ kelimeler (satırın tamamı değerse yok).
    const vals = els.filter((e) => hOverlap(e.rect, rect) > e.rect.width / 2);
    const firstX = vals.length ? Math.min(...vals.map((e) => e.rect.x)) : c.x;
    const beforeEls = labelElements(els.filter((e) => e.rect.x + e.rect.width <= firstX));
    const t = cleanLabel(beforeEls.map((e) => e.text).join(" "));
    if (isLabelText(t)) return { label: t, direction: "right", rect: unionRect(beforeEls.map((e) => e.rect)) };
  }
  const others = lines.filter((l) => l !== own && !inside(c, l.rect));
  const left = others
    .filter((l) => l.rect.x + l.rect.width <= rect.x + rect.width * 0.25 && vOverlap(l.rect, rect) > Math.min(l.rect.height, rect.height) * 0.4 && isLabelText(cleanLabel(l.text)))
    .sort((a, b) => b.rect.x + b.rect.width - (a.rect.x + a.rect.width))[0];
  if (left) {
    const els = labelElements(left.elements ?? []);
    const t = cleanLabel(els.map((e) => e.text).join(" "));
    if (els.length && els.length < (left.elements ?? []).length && isLabelText(t)) return { label: t, direction: "right", rect: unionRect(els.map((e) => e.rect)) };
    return { label: cleanLabel(left.text), direction: "right", rect: left.rect };
  }
  const above = others
    .filter((l: OcrLine) => l.rect.y + l.rect.height <= rect.y + rect.height * 0.25 && hOverlap(l.rect, rect) > 0 && rect.y - (l.rect.y + l.rect.height) < rect.height * 3 && isLabelText(cleanLabel(l.text)))
    .sort((a, b) => b.rect.y - a.rect.y)[0];
  if (above) return { label: cleanLabel(above.text), direction: "below", rect: above.rect };
  return null;
}

/** Dokunulan değer kelimeleri: kutuyla yatayda yarıdan çok çakışan ve dikey merkezi kutu içinde kalan OCR kelimeleri (okuma sırası). */
export function tappedWords(ocr: OcrResult, rect: OcrRect): string[] {
  return collectLines(ocr)
    .flatMap((l) => l.elements ?? [])
    .filter((e) => hOverlap(e.rect, rect) > e.rect.width / 2 && inside({ x: rect.x + rect.width / 2, y: center(e.rect).y }, rect))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .map((e) => e.text);
}

/** Serbest metin (müşteri, desen, not) belgeden belgeye kelime sayısı değiştirir; değer sınırı yalnız kalıplı tiplere öğrenilir. */
function valueLimitOf(ocr: OcrResult, rect: OcrRect, type: FieldType): { maxWords?: number; valueShape?: string } {
  if (type === "text") return {};
  const words = tappedWords(ocr, rect);
  if (words.length === 0) return {};
  const shape = valueShapeOf(words);
  return { maxWords: words.length, ...(shape ? { valueShape: shape } : {}) };
}

/** Pencere payları (normalize): geniş pay foto kaymasını tolere eder; rakip etiket girerse daralır. */
const WINDOW_PADS = [0.15, 0.08, 0.04] as const;
const r4 = (v: number, up: boolean) => (up ? Math.ceil(v * 1e4) : Math.floor(v * 1e4)) / 1e4;

/**
 * Etiket metni sayfada birden çok kez geçiyorsa ("Müşteri KG" · "Müşteri MT" · "Müşteri:") okuyucu eşitlikte en üsttekini
 * seçer; tanıtılan etiketi içeren ama rakip eşleşmelerin merkezlerini dışarıda bırakan pencere döner. Tek eşleşmede null
 * (kırpılmamış/kaymış fotoğrafta konum bağımlılığı istenmez). Ölçü okuyucuyla aynı: `findLabelMatches` + aynı eşik.
 */
export function labelWindow(ocr: OcrResult, label: string, labelRect: OcrRect): NormRect | null {
  const matches = findLabelMatches(buildAnchorContext(ocr, buildRows(ocr), []), [label], DEFAULT_MIN_LABEL_SIMILARITY);
  if (matches.length < 2) return null;
  const own = matches.find((m) => hOverlap(m.rect, labelRect) > 0 && vOverlap(m.rect, labelRect) > 0);
  if (!own) return null;
  const rivals = matches.filter((m) => m !== own);
  const W = ocr.imageWidth;
  const H = ocr.imageHeight;
  for (const pad of WINDOW_PADS) {
    const x = r4(Math.max(0, own.rect.x / W - pad), false);
    const y = r4(Math.max(0, own.rect.y / H - pad), false);
    const x1 = r4(Math.min(1, (own.rect.x + own.rect.width) / W + pad), true);
    const y1 = r4(Math.min(1, (own.rect.y + own.rect.height) / H + pad), true);
    const win: NormRect = { x, y, w: r4(Math.min(1, x1) - x, true), h: r4(Math.min(1, y1) - y, true) };
    if (centerInNormRect(own.rect, win, ocr) && !rivals.some((m) => centerInNormRect(m.rect, win, ocr))) return win;
  }
  return null;
}

/** Etiketsiz değer: kutunun çevresi (yarım kutu pay) normalize göreli konum. */
function roiOf(ocr: OcrResult, r: OcrRect): RoiStrategy {
  const px = r.width * 0.5;
  const py = r.height * 0.5;
  const x = Math.max(0, (r.x - px) / ocr.imageWidth);
  const y = Math.max(0, (r.y - py) / ocr.imageHeight);
  return { kind: "roi", roi: { x, y, w: Math.min(1 - x, (r.width + 2 * px) / ocr.imageWidth), h: Math.min(1 - y, (r.height + 2 * py) / ocr.imageHeight) } };
}

/** Öneri: alanlar + (varsa) top tablosu + bölüm + kimlik; doğrulayıcıdan geçmeyen öneri `errors`la döner (kaydedilmez). */
export function suggestTemplate(input: TemplateSuggestInput): TemplateSuggestion {
  const explain: TemplateSuggestion["explain"] = [];
  const fields: FieldSpec[] = [];
  const labelRects = new Map<string, OcrRect>();
  const valueRects = new Map<string, OcrRect>();
  for (const a of input.assignments) {
    if (fields.some((f) => f.key === a.field)) continue;
    const meta = ASSIGNABLE_FIELDS[a.field];
    let found = findLabelFor(input.ocr, a.rect);
    let strategy: Strategy = found ? { kind: "anchor", labels: [found.label], direction: found.direction, ...valueLimitOf(input.ocr, a.rect, meta.type) } : roiOf(input.ocr, a.rect);
    // Etiketin sağında başka değer önce geliyorsa ("TOPLAM 241,00 MT 734,00 KG") dokunulana kadar atlanır.
    const skip = found && strategy.kind === "anchor" ? learnAnchorSkip(input.ocr, strategy, found.rect, a.rect) : 0;
    if (skip && strategy.kind === "anchor") strategy.skipWords = skip;
    // Ölçü alanı etiketten dokunulan kutuya ulaşamıyorsa çapa başka hücreyi okur (metre ↔ kg aynı değer) → konumdan okunur.
    if (skip === null && MEASURE_FIELDS.has(a.field)) {
      found = null;
      strategy = roiOf(input.ocr, a.rect);
    }
    // Bölüm alanı her bölümde ayrı okunur (bant dilimi) → pencere/konum yedeği onu ilk bölüme çiviler; yalnız başlık alanına.
    if (found && !a.section) {
      labelRects.set(a.field, found.rect);
      valueRects.set(a.field, a.rect);
    }
    fields.push({ key: a.field, label: meta.label, type: meta.type, strategies: [strategy], ...(meta.type === "text" ? { maxLength: 80, postProcess: ["collapseSpaces", "trimPunct"] } : {}), ...(meta.type === "alnum" ? { postProcess: ["upper", "stripSpaces"] } : {}) });
    explain.push({ field: a.field, strategy: found ? "anchor" : "roi", label: found?.label ?? null, direction: found?.direction ?? null });
  }
  const t: DocumentTemplate = {
    id: input.code, name: input.name, version: 1,
    identifiers: { keywords: [...new Set(input.identifiers.map((s) => s.trim()).filter(Boolean))], minScore: USER_TEMPLATE_MIN_SCORE },
    fields,
  };
  const cols = input.table?.columns ?? [];
  if (cols.length > 0) {
    const columns: TableColumnSpec[] = cols.map((c) => ({ key: c.key, label: TABLE_COLUMN_KEYS[c.key].label, type: TABLE_COLUMN_KEYS[c.key].type, headers: [c.header.trim()], ...(c.key === "m" ? { required: true } : {}) }));
    t.tables = [{ key: "toplar", columns, minHeaderMatches: Math.min(2, columns.length), ...(input.table?.totalsLabel ? { totals: { labels: [input.table.totalsLabel.trim()] } } : {}) }];
  }
  const sectionFields = input.assignments.filter((a) => a.section).map((a) => a.field);
  if (input.sectionStartLabel?.trim() && sectionFields.length > 0) {
    t.sections = {
      // Bölüm başı ETİKETİYLE kaydedilir ("Ham PartiNo: P2618733" → "Ham PartiNo"): değer her partide değişir.
      startLabels: [sectionStartLabel(input.sectionStartLabel)], fields: [...new Set(sectionFields)],
      ...(sectionFields.includes("partiNo") ? { batchField: "partiNo" } : {}),
      ...(sectionFields.includes("siparisNo") ? { orderField: "siparisNo" } : {}),
      ...(sectionFields.includes("topAdet") ? { countField: "topAdet" } : {}),
      ...(t.tables ? { table: "toplar" } : {}),
    };
  }
  const has = (k: string) => fields.some((f) => f.key === k);
  const batch = (["partiNo", "evrakNo", "siparisNo"] as const).filter(has).map((k) => ({ field: k, kind: k === "partiNo" ? "BATCH" as const : k === "evrakNo" ? "DOC" as const : "ORDER" as const }));
  if (batch.length) t.batchNoCandidates = batch;
  if (input.rules && Object.keys(input.rules).length > 0) t.rules = { ...input.rules };
  if (t.tables?.[0]?.totals) t.meterSources = { output: ["$tableTotal"], ...(has("toplamMetre") ? { total: ["toplamMetre"] } : {}) };
  else if (has("toplamMetre")) t.meterSources = { total: ["toplamMetre"] };
  addLabelWindows(t, input.ocr, labelRects);
  addPositionFallbacks(t, input.ocr, valueRects);
  const v = validateTemplate(t);
  return { template: t, explain, errors: [...teachErrors(input, explain, t), ...v.errors] };
}

/** Pencere çıkarımın göreceği BÖLGE çerçevesinde kurulur (iki belgeli fotoğrafta bölge koordinatı sayfanınki değil). */
function addLabelWindows(t: DocumentTemplate, ocr: OcrResult, labelRects: Map<string, OcrRect>): void {
  if (labelRects.size === 0) return;
  const regions = resolveRegions(ocr, [t], null);
  for (const f of t.fields) {
    const s = f.strategies[0];
    const rect = labelRects.get(f.key);
    if (!rect || s?.kind !== "anchor") continue;
    const cy = rect.y + rect.height / 2;
    const region = regions.find((r) => cy >= r.rect.y && cy < r.rect.y + r.rect.height) ?? regions[0];
    if (!region) continue;
    const win = labelWindow(region.ocr, s.labels[0]!, { ...rect, y: rect.y - region.rect.y });
    if (win) s.window = win;
  }
}

/**
 * Etiketli alana konum yedeği: aynı belge yeniden okutulduğunda basılı etiket bozuk okunabilir ("Müşteri:" → "Mytei:");
 * değer kutusu yerinde durur. `[anchor, roi(fallback)]` — anchor değer bulursa roi hiç koşmaz (`extract.ts`). Kutu, pencere
 * gibi çıkarımın BÖLGE çerçevesinde kurulur.
 */
function addPositionFallbacks(t: DocumentTemplate, ocr: OcrResult, valueRects: Map<string, OcrRect>): void {
  if (valueRects.size === 0) return;
  const regions = resolveRegions(ocr, [t], null);
  for (const f of t.fields) {
    const rect = valueRects.get(f.key);
    if (!rect || f.strategies[0]?.kind !== "anchor") continue;
    const cy = rect.y + rect.height / 2;
    const region = regions.find((r) => cy >= r.rect.y && cy < r.rect.y + r.rect.height) ?? regions[0];
    const frame = region ? region.ocr : ocr;
    const local = region ? { ...rect, y: rect.y - region.rect.y } : rect;
    f.strategies.push({ ...roiOf(frame, local), fallback: true });
  }
}
