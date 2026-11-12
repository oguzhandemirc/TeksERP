// ŞABLON DÜZENLEME BİRLEŞİMİ (saf; sunucunun tek kaynağı). İki yol: "Şablonu güncelle" (fotoğrafla yeniden işaretle →
// `mergeTemplateForUpdate`) ve fotoğrafsız düzenle (PATCH `/sablonlar/ozel/:code/tanim` → `editTemplateDefinition`).
// Alan kaldırma (`drop`) her iki yolda AYNI budamadan geçer: alan + bölüm/blok/başlık beyanı + metre kaynağı + parti no adayı.
import { TABLE_TOTAL_SOURCE, type DocumentTemplate, type MeterSourcesSpec, type MultiPartyRule } from "./types";

/** "Şablonu güncelle"de eski şablondan taşınabilecek yapılar (yeni öneride yoksa); ekranda kutu olarak sorulur. */
export const UPDATE_KEEP_PARTS = ["tables", "sections"] as const;
export type UpdateKeepPart = (typeof UPDATE_KEEP_PARTS)[number];

/** Kalan alanlara göre metre kaynakları ve parti no adaylarını süzer (kaldırılan alanı gösteren referans kalmaz). */
function pruneRefs(out: DocumentTemplate, sources: { meterSources: Array<MeterSourcesSpec | undefined>; batch: Array<DocumentTemplate["batchNoCandidates"]> }): void {
  const hasField = (k: string) => out.fields.some((f) => f.key === k);
  const hasTotals = !!out.tables?.some((t) => t.totals);
  const ms: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(Object.assign({}, ...sources.meterSources.map((m) => m ?? {})) as Record<string, string[] | undefined>)) {
    const kept = (v ?? []).filter((s) => (s === TABLE_TOTAL_SOURCE ? hasTotals : hasField(s)));
    if (kept.length) ms[k] = kept;
  }
  if (Object.keys(ms).length) out.meterSources = ms as MeterSourcesSpec;
  else delete out.meterSources;
  const bc = sources.batch.flatMap((b) => b ?? []).filter((c) => hasField(c.field));
  const cands = bc.filter((c, i) => bc.findIndex((x) => x.field === c.field) === i);
  if (cands.length) out.batchNoCandidates = cands;
  else delete out.batchNoCandidates;
}

/** Alan kaldırma: alan, bölüm alanı/rolü, blok alanı, başlık beyanı/tek satır eşlemesi budanır; boşalan yapı kalkar. */
function dropFieldsFrom(t: DocumentTemplate, drop: readonly string[]): DocumentTemplate {
  if (drop.length === 0) return t;
  const gone = new Set(drop);
  const keep = (k: string) => !gone.has(k);
  const out: DocumentTemplate = { ...t, fields: t.fields.filter((f) => keep(f.key)) };
  if (out.sections) {
    const s = { ...out.sections, fields: out.sections.fields.filter(keep) };
    for (const role of ["batchField", "orderField", "countField"] as const) if (s[role] && !keep(s[role]!)) delete s[role];
    if (s.fields.length) out.sections = s;
    else delete out.sections;
  }
  if (out.blockFields) {
    const b = out.blockFields.filter(keep);
    if (b.length) out.blockFields = b;
    else delete out.blockFields;
  }
  if (out.headerTotals) {
    const h = Object.fromEntries(Object.entries(out.headerTotals).filter(([, v]) => typeof v === "string" && keep(v)));
    if (Object.keys(h).length) out.headerTotals = h;
    else delete out.headerTotals;
  }
  if (out.headerLine) {
    const h = out.headerLine;
    const m = h.m.filter(keep);
    // Tek satır eşlemesi top adedi + metre ister; biri kalkarsa eşleme tümden düşer (doğrulayıcı yarımını reddederdi).
    if (!keep(h.count) || m.length === 0) delete out.headerLine;
    else out.headerLine = { ...h, m, ...(h.kg ? { kg: h.kg.filter(keep) } : {}), ...(h.en ? { en: h.en.filter(keep) } : {}), ...(h.inputM ? { inputM: h.inputM.filter(keep) } : {}), ...(h.inputKg ? { inputKg: h.inputKg.filter(keep) } : {}) };
  }
  pruneRefs(out, { meterSources: [out.meterSources], batch: [out.batchNoCandidates] });
  return out;
}

/**
 * Güncelleme birleşimi (TEK kaynak; önizleme de kayıt da bunu kullanır): yeniden atanan alan ezilir, atanmamış eski alan korunur
 * (`drop`taki hariç — eski istemci drop göndermez, bugünkü davranış); tablo/bölüm yeni öneride varsa onunki, yoksa yalnız `keep`te
 * ise eskisi. Kurallar `next.rules ?? old.rules` — kural göndermeyen (eski) istemcinin yeniden tanıtması kuralı SİLMEZ.
 */
export function mergeTemplateForUpdate(old: DocumentTemplate, next: DocumentTemplate, keep: readonly UpdateKeepPart[], drop: readonly string[] = []): DocumentTemplate {
  const fields = [...next.fields, ...(old.fields ?? []).filter((f) => !next.fields.some((n) => n.key === f.key))];
  const out: DocumentTemplate = { ...old, ...next, fields, identifiers: { ...old.identifiers, ...next.identifiers } };
  delete out.tables;
  delete out.sections;
  delete out.meterSources;
  delete out.rules;
  const rules = next.rules ?? old.rules;
  if (rules) out.rules = rules;
  const tables = next.tables ?? (keep.includes("tables") ? old.tables : undefined);
  if (tables) out.tables = tables;
  const sections = next.sections ?? (keep.includes("sections") ? old.sections : undefined);
  if (sections) {
    out.sections = { ...sections };
    if (!tables) delete out.sections.table;
  }
  pruneRefs(out, { meterSources: [old.meterSources, next.meterSources], batch: [next.batchNoCandidates, old.batchNoCandidates] });
  return dropFieldsFrom(out, drop);
}

/** Fotoğrafsız düzenleme gövdesi (PATCH `/tanim`): verilmeyen parça değişmez; `rules.multiParty: null` kuralı kaldırır (fabrika ayarı). */
export interface TemplateDefinitionPatch {
  name?: string;
  identifiers?: string[];
  dropFields?: string[];
  rules?: { multiParty?: MultiPartyRule | null };
  /** "Barkoddan al" işaretli alanların TAM listesi (verilmezse dokunulmaz; [] hepsini kaldırır). */
  barcodeFields?: string[];
}

export interface TemplateDefinitionChanges {
  name?: { from: string; to: string };
  identifiers?: { added: string[]; removed: string[] };
  droppedFields?: string[];
  rules?: { multiParty: { from: MultiPartyRule | null; to: MultiPartyRule | null } };
  barcodeFields?: { from: string[]; to: string[] };
}

/**
 * Saf düzenleme: ad, kimlik yazıları (liste değiştirilir; eşik/regex korunur), alan kaldırma (`dropFieldsFrom`), kural.
 * Kod ve sürüm burada DEĞİŞMEZ (mühür sunucuda). `errors` doluysa şablon kaydedilmez; `changes` boşsa yazılacak bir şey yok.
 */
export function editTemplateDefinition(old: DocumentTemplate, patch: TemplateDefinitionPatch): { template: DocumentTemplate; changes: TemplateDefinitionChanges; errors: string[] } {
  const errors: string[] = [];
  const changes: TemplateDefinitionChanges = {};
  let t: DocumentTemplate = { ...old, identifiers: { ...old.identifiers } };
  const name = patch.name?.trim();
  if (name !== undefined && name !== old.name) {
    if (!name) errors.push("Belge tipinin adı boş olamaz.");
    else { changes.name = { from: old.name, to: name }; t.name = name; }
  }
  if (patch.identifiers !== undefined) {
    const next = [...new Set(patch.identifiers.map((s) => s.trim()).filter(Boolean))];
    if (next.length === 0) errors.push("En az bir kimlik yazısı kalmalı.");
    const prev = old.identifiers.keywords;
    const added = next.filter((k) => !prev.includes(k));
    const removed = prev.filter((k) => !next.includes(k));
    if (next.length && (added.length || removed.length || next.join("\u0000") !== prev.join("\u0000"))) {
      changes.identifiers = { added, removed };
      t.identifiers = { ...t.identifiers, keywords: next };
    }
  }
  const drop = [...new Set(patch.dropFields ?? [])];
  const unknown = drop.filter((k) => !old.fields.some((f) => f.key === k));
  if (unknown.length) errors.push(`Belge tipinde olmayan alan kaldırılamaz: ${unknown.join(", ")}.`);
  else if (drop.length) { t = dropFieldsFrom(t, drop); changes.droppedFields = drop; }
  if (patch.rules && "multiParty" in patch.rules) {
    const from = old.rules?.multiParty ?? null;
    const to = patch.rules.multiParty ?? null;
    if (from !== to) {
      changes.rules = { multiParty: { from, to } };
      const rest = { ...(t.rules ?? {}) };
      delete rest.multiParty;
      if (to) rest.multiParty = to;
      if (Object.keys(rest).length) t.rules = rest;
      else delete t.rules;
    }
  }
  if (patch.barcodeFields !== undefined) {
    const want = [...new Set(patch.barcodeFields)];
    const missing = want.filter((k) => !t.fields.some((f) => f.key === k));
    if (missing.length) errors.push(`Belge tipinde olmayan alan barkoddan alınamaz: ${missing.join(", ")}.`);
    else {
      const from = t.fields.filter((f) => f.fromBarcode).map((f) => f.key);
      const to = t.fields.filter((f) => want.includes(f.key)).map((f) => f.key);
      if (from.join("\u0000") !== to.join("\u0000")) {
        changes.barcodeFields = { from, to };
        t = { ...t, fields: t.fields.map((f) => {
          const { fromBarcode: _old, ...rest } = f;
          return want.includes(f.key) ? { ...rest, fromBarcode: true } : rest;
        }) };
      }
    }
  }
  return { template: t, changes, errors };
}
