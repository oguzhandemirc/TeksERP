// =============================================================================
// İŞLEM GÖRÜNÜMÜ KURUCU — satır + trace + kullanıcı → işlem öğesi (izlenebilirlik B2)
// -----------------------------------------------------------------------------
// `system_logs` OKUMAZ: satırları `SystemLogService` verir (beyanlı okuyucu). Burada yalnız
// kullanıcı/cihaz ADI çözümü (görüntü) ve anlatı birleştirmesi durur. YALNIZ GÖRÜNTÜ.
// =============================================================================

import prisma from "../../lib/prisma";
import { SystemLogCategory } from "@prisma/client";
import { tableLabel } from "../../constants/audit-tablo-etiketleri";
import { narrateRows, type NarrativeRow } from "../audit-narrative";
import { islemBasligi } from "../audit-narrative/islem";
import { getTrace, listRejectedTraces, type RequestTraceDto } from "../request-trace.service";
import { attachLabels, resolveChangeValues } from "./audit-value-resolver";
import { ACTOR_SELECT } from "./system-account.helper";
import type { RecordRef } from "./audit-record-resolver.helper";
import {
  type Gun, type GrupImleci, type IslemFiltresi, type OperationRow, type Kullanici, gunAraligi, imlecOku, islemOgesi,
} from "./system-log-islem.helper";

/** Ham SQL satırı (işlem görünümü). */
export interface RawOperationRow {
  id: string;
  tableName: string;
  action: string;
  recordId: string;
  userId: string | null;
  requestId: string | null;
  createdAt: Date;
  changes: unknown;
  event: string | null;
}

export interface IslemParametreleri {
  userId?: string;
  tableName?: string;
  recordId?: string;
  action?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  gun?: Gun;
  /** B4: "1" = yalnız reddedilen istekler (trace status ≥ 400). */
  reddedilen?: "0" | "1";
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Liste parametreleri → filtre. `gun` verilirse tarih aralığını o belirler (fabrika günü). */
export function islemFiltresi(p: IslemParametreleri, cats?: SystemLogCategory[]): IslemFiltresi {
  const g = p.gun ? gunAraligi(p.gun) : null;
  return {
    userId: p.userId,
    tableName: p.tableName,
    action: p.action,
    categories: cats,
    from: g?.from ?? parseDate(p.dateFrom),
    to: g?.to ?? parseDate(p.dateTo),
  };
}

/** Reddedilen istek (audit satırı yok) yalnız tablo/kayıt/işlem süzgeci YOKKEN ve DOMAIN görünümünde listelenir. */
export function islemdeReddedilenGorunur(p: IslemParametreleri, cats?: SystemLogCategory[]): boolean {
  if (p.tableName || p.recordId || p.action) return false;
  return !cats || cats.includes(SystemLogCategory.DOMAIN);
}

/**
 * "Reddedilenler" süzgeci (B4): yalnız trace status ≥ 400 — süzme SUNUCUDA, kısmi indeksten.
 * Tablo/işlem/kayıt süzgeci ya da DOMAIN dışı kategori reddedileni dışlar → boş sayfa.
 */
export async function rejectedTracePage(
  p: IslemParametreleri & { cursor?: string }, cats: SystemLogCategory[] | undefined, f: IslemFiltresi, limit: number,
) {
  const c = imlecOku(p.cursor);
  const izler = islemdeReddedilenGorunur(p, cats)
    ? await listRejectedTraces({ userId: p.userId, from: f.from, to: f.to, before: c ? { at: c.at, id: c.key } : undefined }, limit + 1, { auditliDahil: true })
    : [];
  const pageTraces = izler.slice(0, limit);
  return { izler: pageTraces, hasMore: izler.length > limit, page: pageTraces.map((t) => ({ at: t.createdAt, key: t.id, istekli: true })) };
}

async function kullanicilar(ids: Array<string | null | undefined>): Promise<Map<string, Kullanici>> {
  const tekil = [...new Set(ids.filter((x): x is string => !!x))];
  if (tekil.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: tekil } }, select: ACTOR_SELECT });
  return new Map(rows.map((u) => [u.id, u]));
}

function toNarrativeRow(r: RawOperationRow, users: Map<string, Kullanici>): NarrativeRow & RawOperationRow {
  return { ...r, user: r.userId ? (users.get(r.userId) ?? null) : null };
}

/** Sayfadaki gruplar → işlem öğeleri (sıra korunur). */
export async function islemleriKur(
  sayfa: ReadonlyArray<GrupImleci & { istekli: boolean }>,
  rows: readonly RawOperationRow[],
  izler: readonly RequestTraceDto[],
) {
  const users = await kullanicilar([...rows.map((r) => r.userId), ...izler.map((t) => t.userId)]);
  const anlatili = (await narrateRows(rows.map((r) => toNarrativeRow(r, users)))) as OperationRow[];
  const izMap = new Map(izler.map((t) => [t.id, t]));
  return sayfa.map((g) => {
    const lines = anlatili.filter((s) => (g.istekli ? s.requestId === g.key : s.id === g.key));
    const iz = g.istekli ? (izMap.get(g.key) ?? null) : null;
    const uid = iz?.userId ?? lines[0]?.userId ?? null;
    return islemOgesi(g, lines, iz, uid ? (users.get(uid) ?? null) : null);
  });
}

type FullRow = NarrativeRow & { requestId: string | null; createdAt: Date; userId: string | null; user: Kullanici | null; event?: string | null; newData?: unknown; oldData?: unknown };

export function olayi(newData: unknown): string | null {
  const e = newData && typeof newData === "object" ? (newData as { event?: unknown }).event : null;
  return typeof e === "string" ? e : null;
}

/** `findIslem`in gövdesi: trace + cihaz adı + etkilenen kayıtlar + alan farkları + ham. */
export async function islemAyrintisi(requestId: string, rows: readonly FullRow[]) {
  const iz = await getTrace(requestId);
  if (!iz && rows.length === 0) return { success: false as const, data: null, message: "İşlem bulunamadı" };
  const cihaz = iz?.deviceRefId
    ? await prisma.device.findUnique({ where: { id: iz.deviceRefId }, select: { name: true, deviceId: true } })
    : null;
  const users = await kullanicilar([iz?.userId, ...rows.map((r) => r.userId)]);
  const lines = await narrateRows(rows.map((r) => ({ ...r, event: olayi(r.newData) })));
  const etiketler = await resolveChangeValues(rows.map((r) => r.changes) as never);
  const uid = iz?.userId ?? rows[0]?.userId ?? null;
  const user = uid ? (users.get(uid) ?? null) : null;
  return {
    success: true as const,
    data: {
      requestId,
      user,
      anlati: islemBasligi(user, iz, lines),
      iz: iz ? { ...iz, cihazAdi: cihaz?.name ?? cihaz?.deviceId ?? null } : null,
      kayitlar: lines.map((s) => ({
        id: s.id, tableName: s.tableName, modul: tableLabel(s.tableName), recordId: s.recordId,
        action: s.action, olay: s.event ?? null, anlati: s.anlati, changes: attachLabels(s.changes, etiketler),
      })),
      ham: rows,
    },
  };
}

type ShortRow = { id: string; tableName: string; recordId: string; action: string; requestId: string | null; createdAt: Date; changes?: unknown; user?: NarrativeRow["user"] };

/** `listByRecordQuery` gövdesi: doğrudan + kardeş satırlar, tekilleştirilmiş, yeniden eskiye. */
export async function recordSearchResult(
  kayitlar: Array<RecordRef & { numara: string }>,
  dogrudan: readonly ShortRow[],
  kardes: readonly ShortRow[],
) {
  const eslesen = new Set(kayitlar.map((k) => `${k.tableName}:${k.recordId}`));
  const seen = new Set<string>();
  const hepsi = [...dogrudan, ...kardes]
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  const data = (await narrateRows(hepsi)).map((r) => ({ ...r, kardes: !eslesen.has(`${r.tableName}:${r.recordId}`) }));
  return { success: true, data, kayitlar };
}

/** `gun` → `dateFrom/dateTo` (fabrika günü); `gun` yoksa parametreler aynen. */
export function gunluParams<T extends { gun?: Gun; dateFrom?: string; dateTo?: string }>(p: T): T {
  if (!p.gun) return p;
  const g = gunAraligi(p.gun);
  return { ...p, dateFrom: g.from.toISOString(), dateTo: g.to.toISOString() };
}

/** Liste sayfasına `anlati` ekler; `ekler` aynı sayfanın diff + olay işaretidir (EK alan). */
export async function anlatiEkle<T extends { id: string; tableName: string; recordId: string; action: string }>(
  page: readonly T[],
  ekler: ReadonlyArray<{ id: string; changes: unknown; event: string | null }>,
) {
  const ek = new Map(ekler.map((e) => [e.id, e]));
  const anlatili = await narrateRows(
    page.map((r) => ({ ...r, changes: ek.get(r.id)?.changes, event: ek.get(r.id)?.event ?? null })),
  );
  return page.map((r, i) => ({ ...r, anlati: anlatili[i]!.anlati }));
}

/** Tek satırın anlatısı (ayrıntı paneli). */
export async function tekAnlati(r: NarrativeRow & { newData?: unknown }) {
  const [x] = await narrateRows([{ ...r, event: olayi(r.newData) }]);
  return x!.anlati;
}
