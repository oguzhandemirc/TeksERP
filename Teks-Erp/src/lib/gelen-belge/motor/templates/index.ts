// Kaynak: ocr-test prototipi src/ocr-engine/index.ts (kullanıcının kendi kodu), vendor 2026-10-28 (D3a).
// Dış bağımlılık yok; yalnız göreli import. Değişiklikler: çift tırnak, proje lint/boyut kuralları, Türkçe yorumlar korundu.
/**
 * Şablon yükleyici ve şablon doğrulayıcı. JSON dosyaları statik import ile yüklenir.
 */
import type { DocumentTemplate } from "../types";
import genel from "./genel.json";
import cekiListesiA from "./ceki-listesi-a.json";
import cikisCekiListesi from "./cikis-ceki-listesi.json";
import urunSevkFisi from "./urun-sevk-fisi.json";
import kesimTakipFormu from "./kesim-takip-formu.json";
import kumasIrsaliyesi from "./kumas-irsaliyesi.json";

const FIELD_TYPES = new Set(["text", "alnum", "integer", "decimal", "date", "enum", "code"]);
const STRATEGY_KINDS = new Set(["anchor", "regex", "roi"]);
const DIRECTIONS = new Set(["right", "below", "sameLine", "rightOrBelow"]);
const POST_PROCESS = new Set(["upper", "stripSpaces", "digitsOnly", "trimPunct", "collapseSpaces"]);

/** Başlangıç şablonları: 5 gönderen taslağı + GENEL yedek (SONDA; classifyWithFallback puanlamaya sokmaz). Şablon VERİDİR, D8 DB'ye taşır. */
export function loadTemplates(): DocumentTemplate[] {
  return [cekiListesiA, cikisCekiListesi, urunSevkFisi, kesimTakipFormu, kumasIrsaliyesi, genel].map((t) => t as unknown as DocumentTemplate);
}

const TABLE_COLUMN_TYPES = new Set(["integer", "decimal", "alnum", "text"]);

function validateTables(t: Record<string, unknown>, errors: string[]): void {
  if (t.tables === undefined) return;
  if (!Array.isArray(t.tables)) { errors.push("tables dizi olmalı"); return; }
  t.tables.forEach((tb, ti) => {
    const p = `tables[${ti}]`;
    if (!isObj(tb)) { errors.push(`${p} nesne olmalı`); return; }
    if (typeof tb.key !== "string" || !tb.key) errors.push(`${p}.key eksik`);
    if (!Array.isArray(tb.columns) || tb.columns.length === 0) { errors.push(`${p}.columns boş olmayan dizi olmalı`); return; }
    const seen = new Set<string>();
    tb.columns.forEach((c, ci) => {
      const cp = `${p}.columns[${ci}]`;
      if (!isObj(c)) { errors.push(`${cp} nesne olmalı`); return; }
      if (typeof c.key !== "string" || !c.key) errors.push(`${cp}.key eksik`);
      else if (seen.has(c.key)) errors.push(`${cp}.key tekrar ediyor: ${c.key}`);
      else seen.add(c.key);
      if (typeof c.type !== "string" || !TABLE_COLUMN_TYPES.has(c.type)) errors.push(`${cp}.type bilinmiyor`);
      if (!Array.isArray(c.headers) || c.headers.length === 0) errors.push(`${cp}.headers boş olmayan dizi olmalı`);
      if (c.pattern !== undefined && !regexOk(c.pattern)) errors.push(`${cp}.pattern geçersiz`);
    });
    if (tb.totals !== undefined) {
      if (!isObj(tb.totals) || !Array.isArray(tb.totals.labels) || tb.totals.labels.length === 0) errors.push(`${p}.totals.labels boş olmayan dizi olmalı`);
    }
  });
}

function validateGrid(t: Record<string, unknown>, errors: string[]): void {
  if (t.grid === undefined) return;
  const g = t.grid;
  if (!isObj(g)) { errors.push("grid nesne olmalı"); return; }
  if (!Array.isArray(g.seqHeaders) || g.seqHeaders.length === 0) errors.push("grid.seqHeaders boş olmayan dizi olmalı");
  if (!Array.isArray(g.valueColumns) || g.valueColumns.length === 0) errors.push("grid.valueColumns boş olmayan dizi olmalı");
  else g.valueColumns.forEach((c, i) => {
    if (!isObj(c) || typeof c.key !== "string" || !Array.isArray(c.headers) || c.headers.length === 0) errors.push(`grid.valueColumns[${i}] key + headers gerekli`);
  });
}

const strList = (v: unknown): boolean => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim());

/** `blockFields` ve `headerLine` yalnız şablonda TANIMLI alan anahtarlarını gösterebilir. */
function validateBlockAndHeaderLine(t: Record<string, unknown>, errors: string[]): void {
  const keys = new Set(Array.isArray(t.fields) ? t.fields.filter(isObj).map((f) => f.key) : []);
  const known = (list: unknown, p: string) => {
    if (!strList(list)) { errors.push(`${p} boş olmayan string dizisi olmalı`); return; }
    for (const k of list as string[]) if (!keys.has(k)) errors.push(`${p}: bilinmeyen alan ${k}`);
  };
  if (t.blockFields !== undefined) {
    known(t.blockFields, "blockFields");
    if (t.tables === undefined) errors.push("blockFields tablo ister");
  }
  const h = t.headerLine;
  if (h === undefined) return;
  if (!isObj(h)) { errors.push("headerLine nesne olmalı"); return; }
  if (t.tables !== undefined || t.grid !== undefined) errors.push("headerLine yalnız tablosuz/ızgarasız şablonda");
  known([h.count], "headerLine.count");
  known(h.m, "headerLine.m");
  if (h.kg !== undefined) known(h.kg, "headerLine.kg");
  if (h.en !== undefined) known(h.en, "headerLine.en");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNormRect(v: unknown): boolean {
  return isObj(v) && ["x", "y", "w", "h"].every((k) => typeof v[k] === "number");
}
function regexOk(p: unknown): boolean {
  if (typeof p !== "string") return false;
  try {
    new RegExp(p);
    return true;
  } catch {
    return false;
  }
}

/** Şablon yapısını doğrular; hata mesajlarını döner. */
export function validateTemplate(t: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(t)) return { ok: false, errors: ["şablon bir nesne olmalı"] };
  if (typeof t.id !== "string" || !t.id) errors.push("id eksik");
  if (typeof t.name !== "string" || !t.name) errors.push("name eksik");
  if (typeof t.version !== "number") errors.push("version sayı olmalı");
  const ids = t.identifiers;
  if (!isObj(ids)) errors.push("identifiers eksik");
  else {
    if (!Array.isArray(ids.keywords) || ids.keywords.length === 0 || !ids.keywords.every((k) => typeof k === "string" && k.trim()))
      errors.push("identifiers.keywords boş olmayan string dizisi olmalı");
    if (ids.minScore !== undefined && (typeof ids.minScore !== "number" || ids.minScore < 0 || ids.minScore > 1)) errors.push("identifiers.minScore 0..1 olmalı");
    if (ids.regex !== undefined) {
      if (!Array.isArray(ids.regex)) errors.push("identifiers.regex dizi olmalı");
      else ids.regex.forEach((r, i) => { if (!regexOk(r)) errors.push(`identifiers.regex[${i}] geçersiz`); });
    }
  }
  validateTables(t, errors);
  validateGrid(t, errors);
  validateBlockAndHeaderLine(t, errors);
  if (!Array.isArray(t.fields) || t.fields.length === 0) {
    errors.push('fields boş olmayan dizi olmalı');
    return { ok: errors.length === 0, errors };
  }
  const seen = new Set<string>();
  t.fields.forEach((f, fi) => {
    const p = `fields[${fi}]`;
    if (!isObj(f)) { errors.push(`${p} nesne olmalı`); return; }
    const key = f.key;
    if (typeof key !== 'string' || !key) errors.push(`${p}.key eksik`);
    else if (seen.has(key)) errors.push(`${p}.key tekrar ediyor: ${key}`);
    else seen.add(key);
    if (typeof f.label !== 'string' || !f.label) errors.push(`${p}.label eksik`);
    if (typeof f.type !== 'string' || !FIELD_TYPES.has(f.type)) errors.push(`${p}.type bilinmiyor: ${String(f.type)}`);
    if (f.type === 'enum' && (!Array.isArray(f.enumValues) || f.enumValues.length === 0)) errors.push(`${p}: enum için enumValues gerekli`);
    if (f.pattern !== undefined && !regexOk(f.pattern)) errors.push(`${p}.pattern geçersiz`);
    if (f.min !== undefined && typeof f.min !== 'number') errors.push(`${p}.min sayı olmalı`);
    if (f.max !== undefined && typeof f.max !== 'number') errors.push(`${p}.max sayı olmalı`);
    if (typeof f.min === 'number' && typeof f.max === 'number' && f.min > f.max) errors.push(`${p}: min > max`);
    if (f.minConfidence !== undefined && (typeof f.minConfidence !== 'number' || f.minConfidence < 0 || f.minConfidence > 1)) errors.push(`${p}.minConfidence 0..1 olmalı`);
    if (f.dateFormats !== undefined && (!Array.isArray(f.dateFormats) || !f.dateFormats.every((d) => typeof d === 'string'))) errors.push(`${p}.dateFormats string dizisi olmalı`);
    if (f.postProcess !== undefined && (!Array.isArray(f.postProcess) || !f.postProcess.every((x) => typeof x === 'string' && POST_PROCESS.has(x)))) errors.push(`${p}.postProcess bilinmeyen adım içeriyor`);
    if (!Array.isArray(f.strategies) || f.strategies.length === 0) { errors.push(`${p}.strategies boş olmayan dizi olmalı`); return; }
    f.strategies.forEach((s, si) => {
      const sp = `${p}.strategies[${si}]`;
      if (!isObj(s)) { errors.push(`${sp} nesne olmalı`); return; }
      if (typeof s.kind !== 'string' || !STRATEGY_KINDS.has(s.kind)) { errors.push(`${sp}.kind bilinmiyor: ${String(s.kind)}`); return; }
      if (s.kind === 'anchor') {
        if (!Array.isArray(s.labels) || s.labels.length === 0 || !s.labels.every((l) => typeof l === 'string' && l.trim())) errors.push(`${sp}.labels boş olmayan string dizisi olmalı`);
        if (s.direction !== undefined && (typeof s.direction !== 'string' || !DIRECTIONS.has(s.direction))) errors.push(`${sp}.direction bilinmiyor`);
        if (s.window !== undefined && !isNormRect(s.window)) errors.push(`${sp}.window NormRect olmalı`);
        if (s.maxDistance !== undefined && typeof s.maxDistance !== 'number') errors.push(`${sp}.maxDistance sayı olmalı`);
        if (s.takeLines !== undefined && typeof s.takeLines !== 'number') errors.push(`${sp}.takeLines sayı olmalı`);
        if (s.minLabelSimilarity !== undefined && (typeof s.minLabelSimilarity !== 'number' || s.minLabelSimilarity < 0 || s.minLabelSimilarity > 1)) errors.push(`${sp}.minLabelSimilarity 0..1 olmalı`);
      } else if (s.kind === 'regex') {
        if (!regexOk(s.pattern)) errors.push(`${sp}.pattern geçersiz`);
        if (s.roi !== undefined && !isNormRect(s.roi)) errors.push(`${sp}.roi NormRect olmalı`);
        if (s.group !== undefined && typeof s.group !== 'number') errors.push(`${sp}.group sayı olmalı`);
      } else if (s.kind === 'roi') {
        if (!isNormRect(s.roi)) errors.push(`${sp}.roi NormRect olmalı`);
      }
    });
  });
  return { ok: errors.length === 0, errors };
}
