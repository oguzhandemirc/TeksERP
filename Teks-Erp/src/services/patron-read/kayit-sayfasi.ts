// =============================================================================
// PATRON OKUMA UCU — KAYIT kümesi sayfası (V3a)
// =============================================================================
// Satırı fabrikanın eşitleme kurucusu `buildRecords` kurar (aynı kolon, aynı türetilmiş alan, aynı alt satır
// bölünmesi). Kurucu kimlik İSTER, seçmez — en küçük uyarlama burada: kapsam + süzgeç + sıralama ile kök
// kimliklerini seçen tek `findMany`. İmleç ve sıra bulutla aynı biçim: base64url([sıralama ISO, id]), ikisi DESC.
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildRecords } from "../../cloud-sync/record-builder";
import { foldSearchTerm, foldSearchTokens } from "../../utils/search-fold";
import type { RecordProjection } from "../../cloud-sync/projections";
import { KEY_FILTERS, KEY_FILTER_MAX, RESOLVED_ID_FILTERS, SEARCH, keyFilterWhere, sortSourceOf, type Where } from "./kume-arama";

export { SEARCH, KEY_FILTERS } from "./kume-arama";

/** Bulut liste sorgusu (`patron/sunucu/src/services/data.service.ts` `ListQuery` ile aynı alanlar). */
export interface PatronListQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly durum?: string;
  readonly kimlik: Partial<Readonly<Record<IdFilterKey, string>>>;
  readonly ara?: string;
  readonly suzgec?: string;
  /** Bulut `LIST_KEY_FILTERS` (`kategoriAnahtari`); beyansız kümede 400. */
  readonly anahtar: Partial<Readonly<Record<keyof typeof KEY_FILTERS, string>>>;
}

/** Bulut `LIST_ID_FILTER_KEYS` ile aynı sıra; bir küme yalnız o adda KOLONU varsa kabul eder. */
export const ID_FILTER_KEYS = ["cariKartId", "cariHesapId", "siparisId", "teklifId", "urunId"] as const;
export type IdFilterKey = (typeof ID_FILTER_KEYS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARAMA_AZAMI = 60;
const bad = (m: string): AppError => AppError.badRequest(m, { code: "PATRON_LIST_QUERY" });

const sourceOf = (p: RecordProjection, wire: string): string | undefined => p.columns.find((c) => c.wire === wire && !c.resolvedBy)?.source;

/** Kümenin kabul ettiği kimlik süzgeçleri (bulut `LIST_ID_FILTERS` beyanının bu sunucudaki karşılığı). */
export function idFiltersOf(p: RecordProjection): IdFilterKey[] {
  return ID_FILTER_KEYS.filter((k) => sourceOf(p, k) !== undefined || Object.hasOwn(RESOLVED_ID_FILTERS, `${p.name}.${k}`));
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const [t, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const at = new Date(t);
    if (!Number.isFinite(at.getTime()) || !UUID.test(id)) throw new Error("biçim");
    return { at, id };
  } catch {
    throw bad("İmleç biçimsiz");
  }
}
const encodeCursor = (at: Date, id: string): string => Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url");

/** Süzgeçler → Prisma koşulları; beyansız süzgeç 400 (bulutla aynı fail-closed). `null` = sonuç kesin boş. */
async function filterWhere(p: RecordProjection, q: PatronListQuery, nowMs: number): Promise<Where[] | null> {
  const and: Where[] = [];
  if (p.scope) and.push(p.scope.prismaWhere as Where);
  for (const key of ID_FILTER_KEYS) {
    const v = q.kimlik[key];
    if (v === undefined) continue;
    const src = sourceOf(p, key);
    const resolved = Object.hasOwn(RESOLVED_ID_FILTERS, `${p.name}.${key}`) ? RESOLVED_ID_FILTERS[`${p.name}.${key}`] : undefined;
    if (!src && !resolved) throw bad(`Bu listede ${key} süzgeci yok`);
    if (!UUID.test(v)) throw bad(`${key} biçimsiz`);
    if (resolved) {
      const w = await resolved(v.toLowerCase());
      if (w === null) return null;
      and.push(w);
    } else and.push({ [src!]: v.toLowerCase() });
  }
  if (q.durum !== undefined) {
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(q.durum)) throw bad("durum biçimsiz");
    const src = sourceOf(p, "durum");
    // Bulut `data->>'durum'` eşitler: alanı olmayan kümede sonuç boştur, hata değil.
    if (!src) return null;
    and.push({ [src]: q.durum });
  }
  for (const [key, sets] of Object.entries(KEY_FILTERS) as Array<[keyof typeof KEY_FILTERS, readonly string[]]>) {
    const v = q.anahtar[key];
    if (v === undefined) continue;
    if (!sets.includes(p.name)) throw bad(`Bu listede ${key} süzgeci yok`);
    if (v.length > KEY_FILTER_MAX) throw bad(`${key} en çok ${KEY_FILTER_MAX} karakter`);
    const w = await keyFilterWhere(v);
    if (w === null) return null;
    and.push(w);
  }
  if (q.ara !== undefined || q.suzgec !== undefined) {
    const spec = Object.hasOwn(SEARCH, p.name) ? SEARCH[p.name] : undefined;
    if (!spec) throw bad("Bu listede arama yok");
    if (q.ara !== undefined) {
      if (q.ara.length > ARAMA_AZAMI) throw bad(`Arama en çok ${ARAMA_AZAMI} karakter`);
      for (const token of foldSearchTokens(q.ara)) and.push({ OR: spec.terim(foldSearchTerm(token)) });
    }
    if (q.suzgec !== undefined) {
      const opt = spec.secenekler.find((o) => o.deger === q.suzgec);
      if (!opt) throw bad(`Tanınmayan süzgeç: ${q.suzgec}`);
      and.push(opt.where(nowMs));
    }
  }
  return and;
}

type Delegate = { findMany: (args: Where) => Promise<Array<Record<string, unknown> & { id: string }>> };
function delegateOf(p: RecordProjection): Delegate {
  const name = p.root.model.charAt(0).toLowerCase() + p.root.model.slice(1);
  return (prisma as unknown as Record<string, Delegate>)[name]!;
}

/** Bulut `ProjectionRecord` biçimi; alt satır anahtarı yalnız izinliyse VAR. */
export interface PatronRecord { id: string; kayit: unknown; finans?: unknown; kisisel?: unknown; surum: string }

async function assemble(p: RecordProjection, ids: string[], sub: { finans: boolean; kisisel: boolean }, nowMs: number): Promise<Map<string, PatronRecord>> {
  const built = await buildRecords(p, ids, nowMs);
  const by = (suffix: string) => new Map((built.rows.get(suffix ? `${p.name}.${suffix}` : p.name) ?? []).map((r) => [r.id, r]));
  const root = by(""), fin = by("finans"), kis = by("kisisel");
  const builtAt = new Date(nowMs).toISOString();
  const out = new Map<string, PatronRecord>();
  for (const [id, row] of root) {
    out.set(id, { id, kayit: row, ...(sub.finans ? { finans: fin.get(id) ?? null } : {}), ...(sub.kisisel ? { kisisel: kis.get(id) ?? null } : {}), surum: builtAt });
  }
  return out;
}

export async function listRecords(p: RecordProjection, q: PatronListQuery, sub: { finans: boolean; kisisel: boolean }, nowMs: number): Promise<{ kayitlar: PatronRecord[]; sonraki: string | null }> {
  const and = await filterWhere(p, q, nowMs);
  if (and === null) return { kayitlar: [], sonraki: null };
  const sortSrc = sortSourceOf(p.name);
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    and.push({ OR: [{ [sortSrc]: { lt: c.at } }, { [sortSrc]: c.at, id: { lt: c.id } }] });
  }
  const found = await delegateOf(p).findMany({
    where: and.length > 0 ? { AND: and } : {}, select: { id: true, [sortSrc]: true },
    orderBy: [{ [sortSrc]: "desc" }, { id: "desc" }], take: q.limit + 1,
  });
  const page = found.slice(0, q.limit);
  const rows = await assemble(p, page.map((r) => r.id), sub, nowMs);
  const last = page[page.length - 1];
  return {
    kayitlar: page.map((r) => rows.get(r.id)).filter((r): r is PatronRecord => r !== undefined),
    sonraki: found.length > q.limit && last ? encodeCursor(last[sortSrc] as Date, last.id) : null,
  };
}

export async function getRecord(p: RecordProjection, id: string, sub: { finans: boolean; kisisel: boolean }, nowMs: number): Promise<PatronRecord | null> {
  if (!UUID.test(id)) return null;
  return (await assemble(p, [id.toLowerCase()], sub, nowMs)).get(id.toLowerCase()) ?? null;
}
