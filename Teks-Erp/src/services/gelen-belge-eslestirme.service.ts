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
import { matchGramajOption, type GramajOption } from "../lib/gelen-belge/gramaj-oneri";

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

/** Alias anahtarı: `scope`a göre katlama (renk ayraç/sıra bağımsız). */
export function aliasKey(scope: DeliveryNoteAliasScope, raw: string): string {
  return scope === "COLOR" ? foldColorNameForCompare(raw) : foldNameForCompare(raw);
}

/** Sözlükte saklanan anahtarın tavanı: onayda öğrenme (`learnAliases`) aynı tavanla keser → uzun metin yine bulunur. */
export const ALIAS_KEY_MAX = 160;

export type Named = { id: string; code: string | null; name: string };

function rank(raw: string, rows: Named[], scope: DeliveryNoteAliasScope): MatchCandidate[] {
  const key = aliasKey(scope, raw);
  if (!key || key.length < 2) return [];
  const out: MatchCandidate[] = [];
  for (const r of rows) {
    const k = aliasKey(scope, r.name);
    if (!k) continue;
    const score = k === key ? 1 : scope === "SENDER" ? firmNameSimilarity(key, k, FUZZY_NOISE_WORDS) : productNameSimilarity(key, k);
    if (score >= MATCH_LIST_THRESHOLD) out.push({ id: r.id, code: r.code, name: r.name, score: Math.round(score * 10000) / 10000 });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr")).slice(0, LIST_MAX);
}

async function aliasTarget(scope: DeliveryNoteAliasScope, senderCustomerId: string | null, raw: string): Promise<string | null> {
  const rawKey = aliasKey(scope, raw).slice(0, ALIAS_KEY_MAX);
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
}

const EMPTY_PROCESS: ProcessSuggestion = { rawText: null, suggested: null, source: "NONE" };

/** Sözlük kalıptan ÖNCE; sözlük hedefi artık aktif gramaj çeşidi değilse yok sayılır (kalıba düşer). */
export async function suggestProcess(raw: string | null | undefined, senderCustomerId: string | null, options: readonly GramajOption[]): Promise<ProcessSuggestion> {
  const text = raw?.trim();
  if (!text || options.length === 0) return text ? { ...EMPTY_PROCESS, rawText: text } : EMPTY_PROCESS;
  const target = await aliasTarget("PROCESS", senderCustomerId, text);
  const alias = target ? options.find((o) => o.id === target) : undefined;
  if (alias) return { rawText: text, suggested: alias, source: "ALIAS" };
  const hit = matchGramajOption(text, options);
  return hit ? { rawText: text, suggested: hit, source: "PATTERN" } : { rawText: text, suggested: null, source: "NONE" };
}

export interface NoteMatchSuggestions {
  readonly noteId: string;
  readonly sender: MatchSuggestion;
  readonly owner: MatchSuggestion;
  /** Başlığın işlem metni için gramaj önerisi (H9). */
  readonly process: ProcessSuggestion;
  /** Seçilebilir aktif kurşun gramaj çeşitleri (işlem metni yoksa boş): panel kataloğu `gelen-belge:read` kapsamından okur, `property:read` istemez. */
  readonly processOptions: ReadonlyArray<GramajOption>;
  /** `process`: satırın işlem metni; satırda metin yoksa başlığınki (satır kendi metnini taşırsa o kazanır). */
  readonly lines: ReadonlyArray<{ lineId: string; lineNo: number; item: MatchSuggestion; color: MatchSuggestion; process: ProcessSuggestion }>;
}

/** Taslağın başlık + satır metinleri için öneriler (salt okunur; panel D5 bunu gösterir, operatör seçer). */
export async function suggestForNote(noteId: string): Promise<NoteMatchSuggestions> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { id: true, senderCustomerId: true, senderText: true, ownerText: true, processText: true, template: { select: { isActive: true, senderCustomerId: true, defaultOwnerCustomerId: true } }, lines: { select: { id: true, lineNo: true, itemText: true, colorText: true, processText: true }, orderBy: { lineNo: "asc" } } },
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
  const processCache = new Map<string, ProcessSuggestion>();
  const processFor = async (raw: string | null): Promise<ProcessSuggestion> => {
    const key = raw?.trim() ?? "";
    if (!processCache.has(key)) processCache.set(key, await suggestProcess(key, senderId, gramajOptions));
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
  return { noteId, sender, owner, process, processOptions: gramajOptions, lines };
}
