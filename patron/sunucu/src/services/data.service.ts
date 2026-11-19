// VERİ API'si — projeksiyon okuma; İZİN SÜZMESİ SUNUCUDA, iki katmanda: (1) uygulama kapısı — hesap
// projeksiyonun izin kümesini taşımıyorsa 403; (2) RLS — tx `app.projeksiyonlar`ı hesabın okuyabildiği
// adlarla açar, izinsiz alt satır (`.finans` · `.kisisel`) DB düzeyinde görünmez (sol birleşimde NULL).
// Bulut hesap yapmaz: satır fabrikanın hesapladığı hâliyle döner; süzgeç yalnız saklı alan eşitliği.
import { Prisma } from "@prisma/client";
import type { SessionContext } from "../auth/session.service";
import { projectionDef, type ProjectionDef } from "../catalog/projections";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { foldSql, searchCondition } from "../lib/search";
import { NO_TENANT, withTesis } from "../lib/tenant";
import { ANAHTAR_SUZGEC_AZAMI, ARAMA_AZAMI, ASAMA_DEGERLERI, LIST_ID_FILTER_KEYS, LIST_ID_FILTERS, LIST_KEY_FILTER_KEYS, LIST_KEY_FILTERS, LIST_MEMBER_FILTER_KEYS, LIST_MEMBER_FILTERS, LIST_SEARCH, LIST_SORT, type ListSortDir, type ListSortKind, type FacilityStatus, type ListCapabilities, type ListIdFilterKey, type ListKeyFilterKey, type ListMemberFilterKey, type Page, type ProjectionRecord, type Snapshot } from "../wire/api";
import type { CloudContext } from "./context";
import { loadServiceFacts, serviceState } from "./service-lifecycle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readableDef(s: SessionContext, name: string, kind: "KAYIT" | "ANLIK"): ProjectionDef {
  const def = projectionDef(name);
  if (!def || def.subRow) throw notFound("Projeksiyon");
  if ((kind === "ANLIK") !== (def.root.kind === "ANLIK")) throw notFound("Projeksiyon");
  if (!def.permissions.every((p) => s.permissions.has(p))) throw forbidden("Bu veriyi görme yetkiniz yok");
  return def;
}

/** Hesabın görebildiği alt satırlar (uygulama kapısı; RLS aynı kararı DB'de verir). */
export function visibleSubRows(s: SessionContext, def: ProjectionDef): { finans: boolean; kisisel: boolean } {
  const can = (sub: "finans" | "kisisel") => (def.root.subRows ?? []).includes(sub) && s.projections.includes(`${def.name}.${sub}`);
  return { finans: can("finans"), kisisel: can("kisisel") };
}

export interface ListQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly durum?: string;
  /** Kimlik süzgeçleri (`LIST_ID_FILTERS` beyanı); beyansız projeksiyonda 400. */
  readonly kimlik?: Partial<Readonly<Record<ListIdFilterKey, string>>>;
  /** Fabrika anahtarı süzgeçleri (`LIST_KEY_FILTERS` beyanı); beyansız projeksiyonda 400. */
  readonly anahtar?: Partial<Readonly<Record<ListKeyFilterKey, string>>>;
  /** Üyelik süzgeçleri (`LIST_MEMBER_FILTERS` beyanı); beyansız projeksiyonda 400. */
  readonly uyelik?: Partial<Readonly<Record<ListMemberFilterKey, string>>>;
  /** Seçici araması (`LIST_SEARCH`teki projeksiyonlar); imleç aynı terimle devam eder. */
  readonly ara?: string;
  readonly suzgec?: string;
  /** Sıralama (`LIST_SORT` beyanı); yoksa `sort_at` azalan. */
  readonly sirala?: string;
  readonly yon?: string;
}

/** `ara`/`suzgec` koşulları: arama beyanı olmayan listede ya da tanınmayan süzgeçte 400 (fail-closed). */
function searchFilters(name: string, q: ListQuery): Prisma.Sql[] {
  if (q.ara === undefined && q.suzgec === undefined) return [];
  const spec = Object.hasOwn(LIST_SEARCH, name) ? LIST_SEARCH[name] : undefined;
  if (!spec) throw badRequest("Bu listede arama yok");
  const out: Prisma.Sql[] = [];
  if (q.ara !== undefined) {
    if (q.ara.length > ARAMA_AZAMI) throw badRequest(`Arama en çok ${ARAMA_AZAMI} karakter`);
    out.push(searchCondition(spec.alanlar, q.ara));
  }
  if (q.suzgec !== undefined) {
    const opt = spec.suzgec?.secenekler.find((o) => o.deger === q.suzgec);
    if (!opt) throw badRequest(`Tanınmayan süzgeç: ${q.suzgec}`);
    out.push(Prisma.sql`AND (r.data->${opt.alan}) = ${JSON.stringify(opt.esit)}::jsonb`);
  }
  return out;
}

/** Literal ifade: `projection_rows_cari_idx` (`data->>'cariKartId'`) parametreli anahtarla eşleşmez. */
const ID_FIELD_SQL: Readonly<Record<ListIdFilterKey, Prisma.Sql>> = {
  cariKartId: Prisma.sql`r.data->>'cariKartId'`,
  cariHesapId: Prisma.sql`r.data->>'cariHesapId'`,
  siparisId: Prisma.sql`r.data->>'siparisId'`,
  teklifId: Prisma.sql`r.data->>'teklifId'`,
  urunId: Prisma.sql`r.data->>'urunId'`,
};

/** Kimlik süzgeçleri: anahtar projeksiyonun beyanında değilse ya da değer UUID değilse 400 (fail-closed). */
function idFilters(name: string, q: ListQuery): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  for (const key of LIST_ID_FILTER_KEYS) {
    const v = q.kimlik?.[key];
    if (v === undefined || memberField(name, key)) continue;
    if (!LIST_ID_FILTERS[key].includes(name)) throw badRequest(`Bu listede ${key} süzgeci yok`);
    if (!UUID.test(v)) throw badRequest(`${key} biçimsiz`);
    out.push(Prisma.sql`AND ${ID_FIELD_SQL[key]} = ${v.toLowerCase()}`);
  }
  return out;
}

const memberField = (name: string, key: string): string | undefined =>
  Object.hasOwn(LIST_MEMBER_FILTERS, name) ? (LIST_MEMBER_FILTERS[name] as Partial<Record<string, string>>)[key] : undefined;
const ID_KEYS: ReadonlySet<string> = new Set(LIST_ID_FILTER_KEYS);

/**
 * Üyelik süzgeçleri: fabrikanın dizi alanı değeri içerir (jsonb `@>`). Kimlik anahtarıyla AYNI adlı parametre üyelik
 * beyanı olmayan listede kimlik süzgecine kalır; diğer beyansız anahtar 400, biçimsiz değer 400 (fail-closed).
 */
function memberFilters(name: string, q: ListQuery): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  for (const key of LIST_MEMBER_FILTER_KEYS) {
    const v = q.uyelik?.[key];
    if (v === undefined) continue;
    const field = memberField(name, key);
    if (!field) {
      if (ID_KEYS.has(key)) continue;
      throw badRequest(`Bu listede ${key} süzgeci yok`);
    }
    const ok = key === "asama" ? (ASAMA_DEGERLERI as readonly string[]).includes(v) : UUID.test(v);
    if (!ok) throw badRequest(`${key} biçimsiz`);
    out.push(Prisma.sql`AND (r.data->${field}) @> ${JSON.stringify([key === "asama" ? v : v.toLowerCase()])}::jsonb`);
  }
  return out;
}

/** Literal ifade (parametreli JSON yolu yok); değer fabrikanın anahtarıdır, bulut onu yalnız eşitler. */
const KEY_FIELD_SQL: Readonly<Record<ListKeyFilterKey, Prisma.Sql>> = {
  kategoriAnahtari: Prisma.sql`r.data->>'kategoriAnahtari'`,
};

/** Anahtar süzgeçleri: beyansız projeksiyonda ya da azamiden uzun değerde 400 (fail-closed; sessiz kırpma yok). */
function keyFilters(name: string, q: ListQuery): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  for (const key of LIST_KEY_FILTER_KEYS) {
    const v = q.anahtar?.[key];
    if (v === undefined) continue;
    if (!LIST_KEY_FILTERS[key].includes(name)) throw badRequest(`Bu listede ${key} süzgeci yok`);
    if (v.length > ANAHTAR_SUZGEC_AZAMI) throw badRequest(`${key} en çok ${ANAHTAR_SUZGEC_AZAMI} karakter`);
    out.push(Prisma.sql`AND ${KEY_FIELD_SQL[key]} = ${v}`);
  }
  return out;
}

/** İstemcinin özellik kapısı: eski sunucu bu alanı göndermez, tanımadığı parametreyi de yok sayar. */
export const LIST_CAPABILITIES: ListCapabilities = {
  kimlikSuzgecleri: LIST_ID_FILTERS, aranabilir: Object.keys(LIST_SEARCH), anahtarSuzgecleri: LIST_KEY_FILTERS,
  uyelikSuzgecleri: Object.fromEntries(Object.entries(LIST_MEMBER_FILTERS).map(([p, m]) => [p, LIST_MEMBER_FILTER_KEYS.filter((k) => m[k] !== undefined)])),
  siralama: Object.fromEntries(Object.entries(LIST_SORT).map(([p, f]) => [p, Object.keys(f)])),
};

const NUMERIC = "^-?[0-9]+(\\.[0-9]+)?$";

/** Sıralama anahtarı: boş değer (yok · JSON null · boş metin · sayı olmayan) SQL NULL'dur ve HEP sonda kalır. */
function sortKeySql(field: string, kind: ListSortKind): Prisma.Sql {
  const text = Prisma.sql`NULLIF(r.data->>${field}, '')`;
  if (kind === "sayi") return Prisma.sql`(CASE WHEN ${text} ~ ${NUMERIC} THEN ${text}::numeric END)`;
  if (kind === "metin") return foldSql(text);
  return Prisma.sql`(${text} COLLATE "C")`;
}

export interface SortSpec {
  readonly field: string;
  readonly kind: ListSortKind;
  readonly dir: ListSortDir;
}

/** `sirala`/`yon`: beyansız alan, tanınmayan yön ya da tek başına `yon` 400 (fail-closed); ikisi de yoksa null (eski sıra). */
export function sortSpec(name: string, q: Pick<ListQuery, "sirala" | "yon">): SortSpec | null {
  if (q.yon !== undefined && q.yon !== "artan" && q.yon !== "azalan") throw badRequest("yon artan ya da azalan olmalı");
  if (q.sirala === undefined) {
    if (q.yon !== undefined) throw badRequest("yon yalnız sirala ile");
    return null;
  }
  const fields = Object.hasOwn(LIST_SORT, name) ? LIST_SORT[name]! : {};
  const kind = Object.hasOwn(fields, q.sirala) ? fields[q.sirala] : undefined;
  if (!kind) throw badRequest(`Bu listede ${q.sirala} sıralaması yok`);
  return { field: q.sirala, kind, dir: (q.yon as ListSortDir | undefined) ?? "artan" };
}

/** Sıralı imleç: `[anahtar metni | null, kayıt kimliği]` (anahtar SQL'de aynı türe geri çevrilir). */
function decodeSortCursor(cursor: string): { key: string | null; id: string } {
  try {
    const [key, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [unknown, string];
    if ((key !== null && typeof key !== "string") || !UUID.test(id)) throw new Error("biçim");
    return { key, id };
  } catch {
    throw badRequest("İmleç biçimsiz");
  }
}

const encodeSortCursor = (key: string | null, id: string): string => Buffer.from(JSON.stringify([key, id])).toString("base64url");

/** Sıralı imleç koşulu: (boş mu, anahtar yönlü, kimlik yönlü) sırasında imlecin ardından gelenler. */
function sortCursorFilter(sort: SortSpec, c: { key: string | null; id: string }): Prisma.Sql {
  const k = sortKeySql(sort.field, sort.kind);
  const cmp = sort.dir === "artan" ? Prisma.sql`>` : Prisma.sql`<`;
  if (c.key === null) return Prisma.sql`AND ${k} IS NULL AND r.record_id ${cmp} ${c.id}::uuid`;
  if (sort.kind === "sayi" && !new RegExp(NUMERIC).test(c.key)) throw badRequest("İmleç biçimsiz");
  const p = sort.kind === "sayi" ? Prisma.sql`${c.key}::numeric` : Prisma.sql`(${c.key}::text COLLATE "C")`;
  return Prisma.sql`AND (${k} IS NULL OR ${k} ${cmp} ${p} OR (${k} = ${p} AND r.record_id ${cmp} ${c.id}::uuid))`;
}

function sortOrderSql(sort: SortSpec | null): Prisma.Sql {
  if (!sort) return Prisma.sql`r.sort_at DESC, r.record_id DESC`;
  const d = sort.dir === "artan" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return Prisma.sql`${sortKeySql(sort.field, sort.kind)} ${d} NULLS LAST, r.record_id ${d}`;
}

function decodeCursor(cursor: string): { sortAt: Date; id: string } {
  try {
    const [t, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const sortAt = new Date(t);
    if (!Number.isFinite(sortAt.getTime()) || !UUID.test(id)) throw new Error("biçim");
    return { sortAt, id };
  } catch {
    throw badRequest("İmleç biçimsiz");
  }
}

const encodeCursor = (sortAt: Date, id: string): string => Buffer.from(JSON.stringify([sortAt.toISOString(), id])).toString("base64url");

export interface Row {
  record_id: string;
  data: unknown;
  version_at: Date;
  sort_at: Date;
  /** Yalnız sıralı listede: sıralama anahtarının metni (imleç için). */
  sort_key?: string | null;
  finans: unknown;
  kisisel: unknown;
}

export function rowView(r: Row, sub: { finans: boolean; kisisel: boolean }): ProjectionRecord {
  return {
    id: r.record_id,
    kayit: r.data,
    ...(sub.finans ? { finans: r.finans ?? null } : {}),
    ...(sub.kisisel ? { kisisel: r.kisisel ?? null } : {}),
    surum: r.version_at.toISOString(),
  };
}

/** Kök + (izinliyse) alt satırlar tek sorguda; imleç `(sort_at, record_id)` azalan (liste ve dışa aktarma aynı sıra). */
export function selectRows(s: SessionContext, def: ProjectionDef, where: Prisma.Sql, limit: number, sort: SortSpec | null = null): Prisma.Sql {
  const key = sort ? Prisma.sql`, (${sortKeySql(sort.field, sort.kind)})::text AS sort_key` : Prisma.empty;
  return Prisma.sql`
    SELECT r.record_id, r.data, r.version_at, r.sort_at, f.data AS finans, k.data AS kisisel${key}
      FROM projection_rows r
      LEFT JOIN projection_rows f ON f.tesis_id = r.tesis_id AND f.projection = ${`${def.name}.finans`} AND f.record_id = r.record_id AND f.deleted_at IS NULL
      LEFT JOIN projection_rows k ON k.tesis_id = r.tesis_id AND k.projection = ${`${def.name}.kisisel`} AND k.record_id = r.record_id AND k.deleted_at IS NULL
     WHERE r.tesis_id = ${s.tesisId}::uuid AND r.projection = ${def.name} AND r.deleted_at IS NULL ${where}
     ORDER BY ${sortOrderSql(sort)}
     LIMIT ${limit}`;
}

export async function listProjection(ctx: CloudContext, s: SessionContext, name: string, q: ListQuery): Promise<Page<ProjectionRecord>> {
  const def = readableDef(s, name, "KAYIT");
  if (q.durum !== undefined && !/^[A-Z][A-Z0-9_]{0,39}$/.test(q.durum)) throw badRequest("durum biçimsiz");
  const filters: Prisma.Sql[] = [...idFilters(def.name, q), ...memberFilters(def.name, q), ...keyFilters(def.name, q), ...searchFilters(def.name, q)];
  if (q.durum) filters.push(Prisma.sql`AND r.data->>'durum' = ${q.durum}`);
  const sort = sortSpec(def.name, q);
  if (q.cursor && sort) filters.push(sortCursorFilter(sort, decodeSortCursor(q.cursor)));
  else if (q.cursor) {
    const c = decodeCursor(q.cursor);
    filters.push(Prisma.sql`AND (r.sort_at, r.record_id) < (${c.sortAt}::timestamptz, ${c.id}::uuid)`);
  }
  const sub = visibleSubRows(s, def);
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, (tx) =>
    tx.$queryRaw<Row[]>(selectRows(s, def, filters.length > 0 ? Prisma.join(filters, " ") : Prisma.empty, q.limit + 1, sort)),
  );
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const next = rows.length > q.limit && last ? (sort ? encodeSortCursor(last.sort_key ?? null, last.record_id) : encodeCursor(last.sort_at, last.record_id)) : null;
  return { kayitlar: page.map((r) => rowView(r, sub)), sonraki: next };
}

export async function getProjectionRecord(ctx: CloudContext, s: SessionContext, name: string, id: string) {
  const def = readableDef(s, name, "KAYIT");
  if (!UUID.test(id)) throw notFound("Kayıt");
  const sub = visibleSubRows(s, def);
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, (tx) =>
    tx.$queryRaw<Row[]>(selectRows(s, def, Prisma.sql`AND r.record_id = ${id}::uuid`, 1)),
  );
  if (!rows[0]) throw notFound("Kayıt");
  return rowView(rows[0], sub);
}

export async function getSnapshot(ctx: CloudContext, s: SessionContext, name: string): Promise<Snapshot> {
  const def = readableDef(s, name, "ANLIK");
  const row = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, (tx) =>
    tx.projectionRow.findUnique({ where: { tesisId_projection_recordId: { tesisId: s.tesisId, projection: def.name, recordId: NO_TENANT } } }),
  );
  if (!row || row.deletedAt) throw notFound("Anlık görüntü");
  return { projeksiyon: def.name, veri: row.data, surum: row.versionAt.toISOString() };
}

/** Ekranın üst şeridi: tesis adı · son eşitleme · sözleşme uyarısı · takılan ufuk · görülebilir projeksiyonlar · hizmet aşaması. */
export async function facilityStatus(ctx: CloudContext, s: SessionContext): Promise<FacilityStatus> {
  const nowMs = ctx.now();
  const { facility, state, facts } = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => ({
    facility: await tx.facility.findUnique({ where: { tesisId: s.tesisId } }),
    state: await tx.syncState.findUnique({ where: { tesisId: s.tesisId } }),
    facts: await loadServiceFacts(tx, s.tesisId),
  }));
  const stuckMs = state ? nowMs - state.horizonChangedAt.getTime() : 0;
  const service = facts ? serviceState(facts, nowMs) : { phase: "KAPALI" as const, endedAt: null, readOnlyUntil: null };
  return {
    tesis: { id: s.tesisId, ad: facility?.name ?? null, saklamaAy: facility?.retentionMonths ?? null },
    hesap: { id: s.accountId, ad: s.accountName, eposta: s.email, izinler: [...s.permissions].sort() },
    projeksiyonlar: s.projections,
    esitleme: state
      ? {
          sonEsitleme: state.lastPackageAt.toISOString(),
          ufuk: state.horizon.toISOString(),
          ufukTakildi: stuckMs > 15 * 60_000 && nowMs - state.lastPackageAt.getTime() < stuckMs,
          sozlesmeUyarisi: state.contractWarning,
          fabrikaSurumu: state.appVersion,
        }
      : null,
    hizmet: { asama: service.phase, bitis: service.endedAt?.toISOString() ?? null, saltOkunurBitis: service.readOnlyUntil?.toISOString() ?? null },
    liste: LIST_CAPABILITIES,
    simdiEsitle: true,
  };
}
