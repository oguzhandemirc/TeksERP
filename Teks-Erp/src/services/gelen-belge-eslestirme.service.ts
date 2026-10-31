// =============================================================================
// Gelen belge EŞLEME (D3b): belgedeki ham metin → cari / ürün / renk ÖNERİSİ
// =============================================================================
// Mükerrer motoruyla TEK kaynak: katlama `foldNameForCompare`/`foldColorNameForCompare`, benzerlik
// `firmNameSimilarity`/`productNameSimilarity` (`utils/string-similarity.ts`). Önce `DeliveryNoteAlias`
// (gönderene özel satır genel satırı ezer). Eşikler: ≥ 0,90 ÖNERİ · 0,80–0,90 LİSTE · altı boş.
// Şablon (E2): aktif şablonun gönderen carisi gönderen önerisinde EN ÖNCE; varsayılan sahibi yalnız sahip metni öneriye varmazsa.
// Burası YAZMAZ: alias yalnız D4 onayında (`gelen-belge:approve`) doğar; "sahip = gönderen" varsayımı YOK.
// =============================================================================
import type { DeliveryNoteAliasScope } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { FUZZY_NOISE_WORDS } from "../constants/duplicate-rules";
import { firmNameSimilarity, productNameSimilarity } from "../utils/string-similarity";
import { foldColorNameForCompare, foldNameForCompare } from "./helpers/name-normalize.helper";
import { loadKursunGramajOptions } from "./helpers/kursun-bypass-gramaj.helper";
import { KURSUN_PROPERTY_CODE } from "./helpers/quality-station.helper";
import { loadProcessChoiceGroups, type ProcessChoiceGroup } from "./helpers/process-choice-catalog.helper";
import { matchChoiceOption, matchGramajOption, type GramajOption } from "../lib/gelen-belge/gramaj-oneri";
import { resolveEffectiveDefaultItem, type EffectiveDefaultItem } from "./gelen-belge-varsayilan.service";

export const MATCH_SUGGEST_THRESHOLD = 0.9;
export const MATCH_LIST_THRESHOLD = 0.8;
const LIST_MAX = 5;

export interface MatchCandidate {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly score: number;
}

export interface MatchSuggestion {
  readonly rawText: string | null;
  /** Alias isabeti ya da ≥ 0,90 tek aday; yoksa null. */
  readonly suggested: MatchCandidate | null;
  readonly source: "TEMPLATE" | "ALIAS" | "SIMILARITY" | "NONE";
  /** 0,80–0,90 (ve önerinin altındaki ≥0,80) adaylar, puana göre azalan. */
  readonly list: readonly MatchCandidate[];
}

const EMPTY: MatchSuggestion = { rawText: null, suggested: null, source: "NONE", list: [] };

/** Sözlükte saklanan anahtarın tavanı (`DeliveryNoteAlias.rawKey` VarChar(160)). */
export const ALIAS_KEY_MAX = 160;

/** Kapsama göre katlama (renk ayraç/sıra bağımsız) — benzerlik sıralaması için, tavansız. */
function foldForScope(scope: DeliveryNoteAliasScope, raw: string): string {
  return scope === "COLOR" ? foldColorNameForCompare(raw) : foldNameForCompare(raw);
}

/**
 * Sözlük anahtarı — TEK kaynak: onay öğrenmesi (`learnAliases`) ve öneri okuması (`aliasTarget`) bunu çağırır.
 * İki taraf ayrı katlarsa öğrenilen anahtar okunamaz (E4: renk "LACİVERT 1234" düz katlamayla öğrenilip renk katlamasıyla aranıyordu).
 */
export function aliasKey(scope: DeliveryNoteAliasScope, raw: string): string {
  return foldForScope(scope, raw).slice(0, ALIAS_KEY_MAX);
}

export type Named = { id: string; code: string | null; name: string };

function rank(raw: string, rows: Named[], scope: DeliveryNoteAliasScope): MatchCandidate[] {
  const key = foldForScope(scope, raw);
  if (!key || key.length < 2) return [];
  const out: MatchCandidate[] = [];
  for (const r of rows) {
    const k = foldForScope(scope, r.name);
    if (!k) continue;
    const score = k === key ? 1 : scope === "SENDER" ? firmNameSimilarity(key, k, FUZZY_NOISE_WORDS) : productNameSimilarity(key, k);
    if (score >= MATCH_LIST_THRESHOLD) out.push({ id: r.id, code: r.code, name: r.name, score: Math.round(score * 10000) / 10000 });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr")).slice(0, LIST_MAX);
}

async function aliasTarget(scope: DeliveryNoteAliasScope, senderCustomerId: string | null, raw: string): Promise<string | null> {
  const rawKey = aliasKey(scope, raw);
  if (!rawKey) return null;
  const rows = await prisma.deliveryNoteAlias.findMany({
    where: { scope, rawKey, OR: [{ senderCustomerId: null }, ...(senderCustomerId ? [{ senderCustomerId }] : [])] },
    select: { targetId: true, senderCustomerId: true },
  });
  // Gönderene özel satır genel satırı ezer; gönderen bilinmiyorsa yalnız genel satır.
  const specific = senderCustomerId ? rows.find((r) => r.senderCustomerId === senderCustomerId) : undefined;
  return specific?.targetId ?? rows.find((r) => r.senderCustomerId === null)?.targetId ?? null;
}

function build(raw: string, candidates: MatchCandidate[], alias: MatchCandidate | null): MatchSuggestion {
  if (alias) return { rawText: raw, suggested: alias, source: "ALIAS", list: candidates.filter((c) => c.id !== alias.id) };
  const top = candidates[0];
  // Öneri yalnız TEK aday ≥ 0,90 ise; iki aday da eşiği aşıyorsa karar operatörün (liste).
  const second = candidates[1];
  if (top && top.score >= MATCH_SUGGEST_THRESHOLD && !(second && second.score >= MATCH_SUGGEST_THRESHOLD)) {
    return { rawText: raw, suggested: top, source: "SIMILARITY", list: candidates.slice(1) };
  }
  return { rawText: raw, suggested: null, source: "NONE", list: candidates };
}

const loadCustomers = (): Promise<Named[]> => prisma.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });
// Kartın KULLANILABİLİRLİĞİNE burada bakılmaz (tek kaynak `assertItemUsable`, D4 onayında); öneri listesi tüm kartlardır.
const loadItems = (): Promise<Named[]> => prisma.item.findMany({ select: { id: true, code: true, name: true } });
const loadColors = (): Promise<Named[]> => prisma.color.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });

/** Cari (gönderen ya da sahip) önerisi — aktif cariler arasında. */
// `preloaded`: toplu çağıran (suggestForNote) kataloğu istek başına BİR kez yükler; tekil çağrıda kendisi yükler.
export async function suggestCustomer(raw: string | null | undefined, senderCustomerId: string | null = null, preloaded?: Named[]): Promise<MatchSuggestion> {
  const text = raw?.trim();
  if (!text) return EMPTY;
  const rows = preloaded ?? (await loadCustomers());
  const target = await aliasTarget("SENDER", senderCustomerId, text);
  const alias = target ? (rows.find((r) => r.id === target) ?? null) : null;
  return build(text, rank(text, rows, "SENDER"), alias ? { ...alias, score: 1 } : null);
}

/** Ürün önerisi — gönderene özel alias önce. */
export async function suggestItem(raw: string | null | undefined, senderCustomerId: string | null = null, preloaded?: Named[]): Promise<MatchSuggestion> {
  const text = raw?.trim();
  if (!text) return EMPTY;
  const rows = preloaded ?? (await loadItems());
  const target = await aliasTarget("ITEM", senderCustomerId, text);
  const alias = target ? (rows.find((r) => r.id === target) ?? null) : null;
  return build(text, rank(text, rows, "ITEM"), alias ? { ...alias, score: 1 } : null);
}

/** Renk önerisi — aktif renkler; katlama ayraç/sıra bağımsız. */
export async function suggestColor(raw: string | null | undefined, senderCustomerId: string | null = null, preloaded?: Named[]): Promise<MatchSuggestion> {
  const text = raw?.trim();
  if (!text) return EMPTY;
  const rows = preloaded ?? (await loadColors());
  const target = await aliasTarget("COLOR", senderCustomerId, text);
  const alias = target ? (rows.find((r) => r.id === target) ?? null) : null;
  return build(text, rank(text, rows, "COLOR"), alias ? { ...alias, score: 1 } : null);
}

/**
 * Şablon önerisi (E2): taslağın şablonu AKTİF ve alanı doluysa o cari EN YÜKSEK öncelikle önerilir (kaynak TEMPLATE);
 * pasif şablon ya da pasif cari öneri vermez. Benzerlik listesi korunur (önerilen hariç).
 */
function withTemplate(base: MatchSuggestion, customerId: string | null, rows: Named[]): MatchSuggestion {
  const hit = customerId ? rows.find((r) => r.id === customerId) : undefined;
  if (!hit) return base;
  const list = [...(base.suggested ? [base.suggested] : []), ...base.list].filter((c) => c.id !== hit.id);
  return { rawText: base.rawText, suggested: { ...hit, score: 1 }, source: "TEMPLATE", list };
}

/** İşlem metni → kurşun gramaj çeşidi önerisi (H9). Yalnız ÖNERİ: hiçbir yere değer yazmaz, seçim operatörde. */
export interface ProcessSuggestion {
  readonly rawText: string | null;
  readonly suggested: GramajOption | null;
  /** ALIAS: onayda öğrenilmiş PROCESS sözlüğü · PATTERN: "25 GR" kalıbı · NONE: emin değil → boş. */
  readonly source: "ALIAS" | "PATTERN" | "NONE";
  /**
   * Kurşun DIŞI çeşit özellikleri (brode deseni vb., D4-D1): özellik başına öneri. Katalogda böyle özellik yoksa
   * anahtar HİÇ yazılmaz — yalnız-kurşun kurulumda yanıt H9 ile bayt-aynı.
   */
  readonly variants?: ReadonlyArray<VariantSuggestion>;
}

export interface VariantSuggestion {
  readonly propertyId: string;
  readonly suggested: GramajOption | null;
  readonly source: "ALIAS" | "PATTERN" | "NONE";
}

const EMPTY_PROCESS: ProcessSuggestion = { rawText: null, suggested: null, source: "NONE" };

type ProcessAliasRow = { targetId: string; senderCustomerId: string | null; propertyId: string | null; kursun: boolean };

async function processAliasRows(senderCustomerId: string | null, raw: string): Promise<ProcessAliasRow[]> {
  const rawKey = aliasKey("PROCESS", raw);
  if (!rawKey) return [];
  const rows = await prisma.deliveryNoteAlias.findMany({
    where: { scope: "PROCESS", rawKey, OR: [{ senderCustomerId: null }, ...(senderCustomerId ? [{ senderCustomerId }] : [])] },
    select: { targetId: true, senderCustomerId: true, propertyId: true, property: { select: { variantOf: { select: { code: true } } } } },
  });
  return rows.map((r) => ({ targetId: r.targetId, senderCustomerId: r.senderCustomerId, propertyId: r.propertyId, kursun: r.property?.variantOf?.code === KURSUN_PROPERTY_CODE }));
}

/**
 * D2b: bir özellik grubunun sözlük hedefi. Kapsamlı satır (propertyId) YALNIZ kendi özelliğinde okunur; NULL kapsamlı
 * eski satır bugünkü kuralla (tek hedef, gönderene özel genel satırı ezer) — yalnız eski satır varken yanıt bayt-aynı.
 * Sıra: kapsamlı+gönderene özel > eski+gönderene özel (grupta) > kapsamlı genel > eski kural.
 */
function processAliasFor(rows: readonly ProcessAliasRow[], senderCustomerId: string | null, inGroup: (r: ProcessAliasRow) => boolean, options: readonly { id: string }[]): string | null {
  const scoped = rows.filter((r) => r.propertyId !== null && inGroup(r));
  const legacy = rows.filter((r) => r.propertyId === null);
  const mine = <T extends ProcessAliasRow>(list: readonly T[]) => (senderCustomerId ? list.find((r) => r.senderCustomerId === senderCustomerId) : undefined);
  const scopedSpecific = mine(scoped);
  if (scopedSpecific) return scopedSpecific.targetId;
  const legacySpecific = mine(legacy);
  if (legacySpecific && options.some((o) => o.id === legacySpecific.targetId)) return legacySpecific.targetId;
  const scopedGeneral = scoped.find((r) => r.senderCustomerId === null);
  return scopedGeneral?.targetId ?? legacySpecific?.targetId ?? legacy.find((r) => r.senderCustomerId === null)?.targetId ?? null;
}

/**
 * Sözlük kalıptan ÖNCE (gönderene özel satır genel satırı ezer); sözlük hedefi artık aktif çeşit değeri değilse yok
 * sayılır (kalıba düşer). D2b: sözlük ÖZELLİK KAPSAMLIDIR — aynı metin her özellikte ayrı değere öğrenilir; NULL
 * kapsamlı eski satır metin başına tek değerdir (hedef hangi özelliğin değeriyse o grup). Grup içinde iki değere uyan metin → öneri YOK.
 */
export async function suggestProcess(
  raw: string | null | undefined,
  senderCustomerId: string | null,
  options: readonly GramajOption[],
  groups: readonly ProcessChoiceGroup[] = [],
): Promise<ProcessSuggestion> {
  const text = raw?.trim();
  const withVariants = (base: ProcessSuggestion, variants: VariantSuggestion[]): ProcessSuggestion => (groups.length > 0 ? { ...base, variants } : base);
  const none = (): VariantSuggestion[] => groups.map((g) => ({ propertyId: g.propertyId, suggested: null, source: "NONE" }));
  if (!text || (options.length === 0 && groups.length === 0)) return withVariants(text ? { ...EMPTY_PROCESS, rawText: text } : EMPTY_PROCESS, none());
  const rows = await processAliasRows(senderCustomerId, text);
  const variants: VariantSuggestion[] = groups.map((g) => {
    const target = processAliasFor(rows, senderCustomerId, (r) => r.propertyId === g.propertyId, g.options);
    const alias = target ? g.options.find((o) => o.id === target) : undefined;
    if (alias) return { propertyId: g.propertyId, suggested: { id: alias.id, name: alias.name }, source: "ALIAS" };
    const hit = matchChoiceOption(text, g.options);
    return hit ? { propertyId: g.propertyId, suggested: { id: hit.id, name: hit.name }, source: "PATTERN" } : { propertyId: g.propertyId, suggested: null, source: "NONE" };
  });
  if (options.length === 0) return withVariants({ ...EMPTY_PROCESS, rawText: text }, variants);
  const target = processAliasFor(rows, senderCustomerId, (r) => r.kursun, options);
  const alias = target ? options.find((o) => o.id === target) : undefined;
  if (alias) return withVariants({ rawText: text, suggested: alias, source: "ALIAS" }, variants);
  const hit = matchGramajOption(text, options);
  return withVariants(hit ? { rawText: text, suggested: hit, source: "PATTERN" } : { rawText: text, suggested: null, source: "NONE" }, variants);
}

export interface NoteMatchSuggestions {
  readonly noteId: string;
  readonly sender: MatchSuggestion;
  readonly owner: MatchSuggestion;
  /** Başlığın işlem metni için gramaj önerisi (H9). */
  readonly process: ProcessSuggestion;
  /** Seçilebilir aktif kurşun gramaj çeşitleri (işlem metni yoksa boş): panel kataloğu `gelen-belge:read` kapsamından okur, `property:read` istemez. */
  readonly processOptions: ReadonlyArray<GramajOption>;
  /** Kurşun dışı çeşit katalogları (D4-D1; işlem metni yoksa ya da böyle özellik yoksa anahtar YOK — eski yanıt bayt-aynı). */
  readonly processGroups?: ReadonlyArray<ProcessChoiceGroup>;
  /** `process`: satırın işlem metni; satırda metin yoksa başlığınki (satır kendi metnini taşırsa o kazanır). */
  readonly lines: ReadonlyArray<{ lineId: string; lineNo: number; item: MatchSuggestion; color: MatchSuggestion; process: ProcessSuggestion }>;
  /** Sahibin ETKİN varsayılan ürünü (E4: müşteri > fabrika) — ürünsüz satır onayda bununla doğar; panel ipucu/ön kontrol bunu okur. */
  readonly defaultItem: EffectiveDefaultItem;
}

/** Taslağın başlık + satır metinleri için öneriler (salt okunur; panel D5 bunu gösterir, operatör seçer). */
export async function suggestForNote(noteId: string): Promise<NoteMatchSuggestions> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { id: true, ownerCustomerId: true, senderCustomerId: true, senderText: true, ownerText: true, processText: true, template: { select: { isActive: true, senderCustomerId: true, defaultOwnerCustomerId: true } }, lines: { select: { id: true, lineNo: true, itemText: true, colorText: true, processText: true }, orderBy: { lineNo: "asc" } } },
  });
  if (!note) throw AppError.notFound("İrsaliye bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const customers = await loadCustomers();
  const tpl = note.template?.isActive ? note.template : null;
  const sender = withTemplate(await suggestCustomer(note.senderText, null, customers), tpl?.senderCustomerId ?? null, customers);
  const senderId = note.senderCustomerId ?? sender.suggested?.id ?? null;
  const ownerByText = await suggestCustomer(note.ownerText, senderId, customers);
  // Şablonun varsayılan sahibi YALNIZ belgedeki sahip metni bir öneriye varmadığında devreye girer ("sahip = gönderen" varsayımı yok).
  const owner = ownerByText.suggested ? ownerByText : withTemplate(ownerByText, tpl?.defaultOwnerCustomerId ?? null, customers);
  const hasItem = note.lines.some((l) => l.itemText?.trim());
  const hasColor = note.lines.some((l) => l.colorText?.trim());
  const items = hasItem ? await loadItems() : [];
  const colors = hasColor ? await loadColors() : [];
  // Aynı metin satırlarda tekrar eder (0245: tek ürün 21 satır) → metin başına bir hesap.
  const itemCache = new Map<string, MatchSuggestion>();
  const colorCache = new Map<string, MatchSuggestion>();
  const hasProcess = !!note.processText?.trim() || note.lines.some((l) => l.processText?.trim());
  const gramajOptions = hasProcess ? await loadKursunGramajOptions() : [];
  const choiceGroups = hasProcess ? await loadProcessChoiceGroups() : [];
  const processCache = new Map<string, ProcessSuggestion>();
  const processFor = async (raw: string | null): Promise<ProcessSuggestion> => {
    const key = raw?.trim() ?? "";
    if (!processCache.has(key)) processCache.set(key, await suggestProcess(key, senderId, gramajOptions, choiceGroups));
    return processCache.get(key)!;
  };
  const process = await processFor(note.processText);
  const lines = [];
  for (const l of note.lines) {
    const it = l.itemText ?? "";
    const co = l.colorText ?? "";
    if (!itemCache.has(it)) itemCache.set(it, await suggestItem(it, senderId, items));
    if (!colorCache.has(co)) colorCache.set(co, await suggestColor(co, senderId, colors));
    const lineProcess = l.processText?.trim() ? await processFor(l.processText) : process;
    lines.push({ lineId: l.id, lineNo: l.lineNo, item: itemCache.get(it)!, color: colorCache.get(co)!, process: lineProcess });
  }
  const defaultItem = await resolveEffectiveDefaultItem(note.ownerCustomerId);
  // Anahtar sırası H9 yanıtıyla aynı; kurşun dışı katalog yalnız varsa eklenir.
  return choiceGroups.length > 0
    ? { noteId, sender, owner, process, processOptions: gramajOptions, processGroups: choiceGroups, lines, defaultItem }
    : { noteId, sender, owner, process, processOptions: gramajOptions, lines, defaultItem };
}
