// Belge tipi kartı ve düzenle diyaloğunun saf parçaları: şablon JSON'undan kural özeti + alan satırları, düzenle taslağından
// PATCH `/tanim` gövdesi (yalnız DEĞİŞEN parça; birleşim sunucuda — istemci şablon JSON'u kurmaz).
import { TERIM } from "@/lib/terim";
import { compareFieldKeys, fieldTargetOf } from "./fieldTargets";
import { templateKeywords } from "./teachDraft";
import type { MultiPartyRule, TemplateEditBody, TemplateJson, UserTemplateDetail } from "./types";

const obj = (v: unknown): TemplateJson | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as TemplateJson) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Şablonun çok parti kuralı; bilinmeyen değer kural sayılmaz (backend `multiPartyRuleOf` aynası). */
export function multiPartyRuleOf(t: TemplateJson | null | undefined): MultiPartyRule | null {
  const v = obj(t?.rules)?.multiParty;
  return v === "SINGLE" || v === "PER_PARTY" ? v : null;
}

export function multiPartyLabel(mode: MultiPartyRule): string {
  return mode === "PER_PARTY" ? `Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk}` : `Tek ${TERIM.terbiyeIsEmri.tekilKucuk}`;
}

/** "Fabrika ayarı (şu an: Tek iş emri)" — fabrika ayarı okunamadıysa parantez yazılmaz. */
export function factoryChoiceLabel(factory: MultiPartyRule | undefined): string {
  return factory ? `Fabrika ayarı (şu an: ${multiPartyLabel(factory)})` : "Fabrika ayarı";
}

/** Kart özeti: "Çok parti: Fabrika ayarı" · "Tekrar eden bölüm: PARTİ NO" · "Toplam satırı: T.Adet". */
export function templateRuleLines(t: TemplateJson | null | undefined): string[] {
  const rule = multiPartyRuleOf(t);
  const lines = [`Çok parti: ${rule ? multiPartyLabel(rule) : "Fabrika ayarı"}`];
  const start = arr(obj(t?.sections)?.startLabels).find((x): x is string => typeof x === "string" && x.trim() !== "");
  if (start) lines.push(`Tekrar eden bölüm: ${start}`);
  const totals = arr(t?.tables)
    .map((x) => arr(obj(obj(x)?.totals)?.labels).find((l): l is string => typeof l === "string" && l.trim() !== ""))
    .find(Boolean);
  if (totals) lines.push(`Toplam satırı: ${totals}`);
  return lines;
}

export interface TemplateFieldRow {
  key: string;
  /** Belgedeki basılı etiket (şablonda kayıtlı). */
  label: string;
  /** İş emri karşılığı; katalog dışı anahtarda anahtarın kendisi. */
  woLabel: string;
}

/** Şablondaki alanlar ekran sırasıyla (grup → katalog sırası). */
export function templateFieldRows(t: TemplateJson | null | undefined): TemplateFieldRow[] {
  return arr(t?.fields)
    .map(obj)
    .filter((f): f is TemplateJson => !!f && typeof f.key === "string")
    .map((f) => {
      const key = f.key as string;
      return { key, label: typeof f.label === "string" && f.label.trim() ? f.label : key, woLabel: fieldTargetOf(key)?.woLabel ?? key };
    })
    .sort((a, b) => compareFieldKeys(a.key, b.key));
}

export interface TemplateEditDraft {
  name: string;
  keywords: string[];
  drop: string[];
  multiParty: MultiPartyRule | null;
}

export const draftOf = (d: UserTemplateDetail): TemplateEditDraft => ({ name: d.name, keywords: templateKeywords(d.template), drop: [], multiParty: multiPartyRuleOf(d.template) });

/** Yalnız değişen parçalar + `expectedVersion`; hiçbir şey değişmediyse null (Kaydet kapalı). */
export function buildEditBody(d: UserTemplateDetail, draft: TemplateEditDraft): TemplateEditBody | null {
  const body: TemplateEditBody = { expectedVersion: d.version };
  const name = draft.name.trim();
  if (name !== d.name) body.name = name;
  const prev = templateKeywords(d.template);
  if (draft.keywords.join("\u0000") !== prev.join("\u0000")) body.identifiers = [...draft.keywords];
  if (draft.drop.length) body.dropFields = [...draft.drop];
  if (draft.multiParty !== multiPartyRuleOf(d.template)) body.rules = { multiParty: draft.multiParty };
  return Object.keys(body).length > 1 ? body : null;
}

/** Kaydet engeli (Türkçe, tek satır); yoksa null. */
export function editProblem(draft: TemplateEditDraft, fieldCount: number): string | null {
  if (draft.name.trim().length < 2) return "Belge tipinin adı en az 2 karakter olmalı.";
  if (draft.keywords.length === 0) return "En az bir kimlik yazısı kalmalı.";
  if (fieldCount > 0 && draft.drop.length >= fieldCount) return "Bütün alanlar kaldırılamaz; en az bir alan kalmalı.";
  return null;
}
