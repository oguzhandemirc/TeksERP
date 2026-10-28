// =============================================================================
// Gelen belge EŞLEME (D3b): belgedeki ham metin → cari / ürün / renk ÖNERİSİ
// =============================================================================
// Mükerrer motoruyla TEK kaynak: katlama `foldNameForCompare`/`foldColorNameForCompare`, benzerlik
// `firmNameSimilarity`/`productNameSimilarity` (`utils/string-similarity.ts`). Önce `DeliveryNoteAlias`
// (gönderene özel satır genel satırı ezer). Eşikler: ≥ 0,90 ÖNERİ · 0,80–0,90 LİSTE · altı boş.
// Burası YAZMAZ: alias yalnız D4 onayında (`gelen-belge:approve`) doğar; "sahip = gönderen" varsayımı YOK.
// =============================================================================
import type { DeliveryNoteAliasScope } from "@prisma/client";
import prisma from "../lib/prisma";
import { FUZZY_NOISE_WORDS } from "../constants/duplicate-rules";
import { firmNameSimilarity, productNameSimilarity } from "../utils/string-similarity";
import { foldColorNameForCompare, foldNameForCompare } from "./helpers/name-normalize.helper";

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
  readonly source: "ALIAS" | "SIMILARITY" | "NONE";
  /** 0,80–0,90 (ve önerinin altındaki ≥0,80) adaylar, puana göre azalan. */
  readonly list: readonly MatchCandidate[];
}

const EMPTY: MatchSuggestion = { rawText: null, suggested: null, source: "NONE", list: [] };

/** Alias anahtarı: `scope`a göre katlama (renk ayraç/sıra bağımsız). */
export function aliasKey(scope: DeliveryNoteAliasScope, raw: string): string {
  return scope === "COLOR" ? foldColorNameForCompare(raw) : foldNameForCompare(raw);
}

type Named = { id: string; code: string | null; name: string };

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

/** Cari (gönderen ya da sahip) önerisi — aktif cariler arasında. */
export async function suggestCustomer(raw: string | null | undefined, senderCustomerId: string | null = null): Promise<MatchSuggestion> {
  const text = raw?.trim();
  if (!text) return EMPTY;
  const rows = await prisma.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });
  const target = await aliasTarget("SENDER", senderCustomerId, text);
  const alias = target ? (rows.find((r) => r.id === target) ?? null) : null;
  return build(text, rank(text, rows, "SENDER"), alias ? { ...alias, score: 1 } : null);
}

/** Ürün önerisi — gönderene özel alias önce. */
export async function suggestItem(raw: string | null | undefined, senderCustomerId: string | null = null): Promise<MatchSuggestion> {
  const text = raw?.trim();
  if (!text) return EMPTY;
  // Kartın KULLANILABİLİRLİĞİNE burada bakılmaz (tek kaynak `assertItemUsable`, D4 onayında); öneri listesi tüm kartlardır.
  const rows = await prisma.item.findMany({ select: { id: true, code: true, name: true } });
  const target = await aliasTarget("ITEM", senderCustomerId, text);
  const alias = target ? (rows.find((r) => r.id === target) ?? null) : null;
  return build(text, rank(text, rows, "ITEM"), alias ? { ...alias, score: 1 } : null);
}

/** Renk önerisi — aktif renkler; katlama ayraç/sıra bağımsız. */
export async function suggestColor(raw: string | null | undefined, senderCustomerId: string | null = null): Promise<MatchSuggestion> {
  const text = raw?.trim();
  if (!text) return EMPTY;
  const rows = await prisma.color.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });
  const target = await aliasTarget("COLOR", senderCustomerId, text);
  const alias = target ? (rows.find((r) => r.id === target) ?? null) : null;
  return build(text, rank(text, rows, "COLOR"), alias ? { ...alias, score: 1 } : null);
}

export interface NoteMatchSuggestions {
  readonly noteId: string;
  readonly sender: MatchSuggestion;
  readonly owner: MatchSuggestion;
  readonly lines: ReadonlyArray<{ lineId: string; lineNo: number; item: MatchSuggestion; color: MatchSuggestion }>;
}

/** Taslağın başlık + satır metinleri için öneriler (salt okunur; panel D5 bunu gösterir, operatör seçer). */
export async function suggestForNote(noteId: string): Promise<NoteMatchSuggestions> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { id: true, senderCustomerId: true, senderText: true, ownerText: true, lines: { select: { id: true, lineNo: true, itemText: true, colorText: true }, orderBy: { lineNo: "asc" } } },
  });
  if (!note) return { noteId, sender: EMPTY, owner: EMPTY, lines: [] };
  const sender = await suggestCustomer(note.senderText, null);
  const senderId = note.senderCustomerId ?? sender.suggested?.id ?? null;
  const owner = await suggestCustomer(note.ownerText, senderId);
  // Aynı metin satırlarda tekrar eder (0245: tek ürün 21 satır) → metin başına bir hesap.
  const itemCache = new Map<string, MatchSuggestion>();
  const colorCache = new Map<string, MatchSuggestion>();
  const lines = [];
  for (const l of note.lines) {
    const it = l.itemText ?? "";
    const co = l.colorText ?? "";
    if (!itemCache.has(it)) itemCache.set(it, await suggestItem(it, senderId));
    if (!colorCache.has(co)) colorCache.set(co, await suggestColor(co, senderId));
    lines.push({ lineId: l.id, lineNo: l.lineNo, item: itemCache.get(it)!, color: colorCache.get(co)! });
  }
  return { noteId, sender, owner, lines };
}
