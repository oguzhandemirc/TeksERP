// VERİ API'si — projeksiyon okuma; İZİN SÜZMESİ SUNUCUDA, iki katmanda: (1) uygulama kapısı — hesap
// projeksiyonun izin kümesini taşımıyorsa 403; (2) RLS — tx `app.projeksiyonlar`ı hesabın okuyabildiği
// adlarla açar, izinsiz alt satır (`.finans` · `.kisisel`) DB düzeyinde görünmez (sol birleşimde NULL).
// Bulut hesap yapmaz: satır fabrikanın hesapladığı hâliyle döner; süzgeç yalnız saklı alan eşitliği.
import { Prisma } from "@prisma/client";
import type { SessionContext } from "../auth/session.service";
import { projectionDef, type ProjectionDef } from "../catalog/projections";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { NO_TENANT, withTesis } from "../lib/tenant";
import type { FacilityStatus, Page, ProjectionRecord, Snapshot } from "../wire/api";
import type { CloudContext } from "./context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readableDef(s: SessionContext, name: string, kind: "KAYIT" | "ANLIK"): ProjectionDef {
  const def = projectionDef(name);
  if (!def || def.subRow) throw notFound("Projeksiyon");
  if ((kind === "ANLIK") !== (def.root.kind === "ANLIK")) throw notFound("Projeksiyon");
  if (!def.permissions.every((p) => s.permissions.has(p))) throw forbidden("Bu veriyi görme yetkiniz yok");
  return def;
}

/** Hesabın görebildiği alt satırlar (uygulama kapısı; RLS aynı kararı DB'de verir). */
function visibleSubRows(s: SessionContext, def: ProjectionDef): { finans: boolean; kisisel: boolean } {
  const can = (sub: "finans" | "kisisel") => (def.root.subRows ?? []).includes(sub) && s.projections.includes(`${def.name}.${sub}`);
  return { finans: can("finans"), kisisel: can("kisisel") };
}

export interface ListQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly durum?: string;
  readonly cariKartId?: string;
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

interface Row {
  record_id: string;
  data: unknown;
  version_at: Date;
  sort_at: Date;
  finans: unknown;
  kisisel: unknown;
}

function rowView(r: Row, sub: { finans: boolean; kisisel: boolean }): ProjectionRecord {
  return {
    id: r.record_id,
    kayit: r.data,
    ...(sub.finans ? { finans: r.finans ?? null } : {}),
    ...(sub.kisisel ? { kisisel: r.kisisel ?? null } : {}),
    surum: r.version_at.toISOString(),
  };
}

function selectRows(s: SessionContext, def: ProjectionDef, where: Prisma.Sql, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT r.record_id, r.data, r.version_at, r.sort_at, f.data AS finans, k.data AS kisisel
      FROM projection_rows r
      LEFT JOIN projection_rows f ON f.tesis_id = r.tesis_id AND f.projection = ${`${def.name}.finans`} AND f.record_id = r.record_id AND f.deleted_at IS NULL
      LEFT JOIN projection_rows k ON k.tesis_id = r.tesis_id AND k.projection = ${`${def.name}.kisisel`} AND k.record_id = r.record_id AND k.deleted_at IS NULL
     WHERE r.tesis_id = ${s.tesisId}::uuid AND r.projection = ${def.name} AND r.deleted_at IS NULL ${where}
     ORDER BY r.sort_at DESC, r.record_id DESC
     LIMIT ${limit}`;
}

export async function listProjection(ctx: CloudContext, s: SessionContext, name: string, q: ListQuery): Promise<Page<ProjectionRecord>> {
  const def = readableDef(s, name, "KAYIT");
  if (q.durum !== undefined && !/^[A-Z][A-Z0-9_]{0,39}$/.test(q.durum)) throw badRequest("durum biçimsiz");
  if (q.cariKartId !== undefined && !UUID.test(q.cariKartId)) throw badRequest("cariKartId biçimsiz");
  const filters: Prisma.Sql[] = [];
  if (q.durum) filters.push(Prisma.sql`AND r.data->>'durum' = ${q.durum}`);
  if (q.cariKartId) filters.push(Prisma.sql`AND r.data->>'cariKartId' = ${q.cariKartId.toLowerCase()}`);
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    filters.push(Prisma.sql`AND (r.sort_at, r.record_id) < (${c.sortAt}::timestamptz, ${c.id}::uuid)`);
  }
  const sub = visibleSubRows(s, def);
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, (tx) =>
    tx.$queryRaw<Row[]>(selectRows(s, def, filters.length > 0 ? Prisma.join(filters, " ") : Prisma.empty, q.limit + 1)),
  );
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return { kayitlar: page.map((r) => rowView(r, sub)), sonraki: rows.length > q.limit && last ? encodeCursor(last.sort_at, last.record_id) : null };
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

/** Ekranın üst şeridi: tesis adı · son eşitleme · sözleşme uyarısı · takılan ufuk · görülebilir projeksiyonlar. */
export async function facilityStatus(ctx: CloudContext, s: SessionContext): Promise<FacilityStatus> {
  const nowMs = ctx.now();
  const { facility, state } = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => ({
    facility: await tx.facility.findUnique({ where: { tesisId: s.tesisId } }),
    state: await tx.syncState.findUnique({ where: { tesisId: s.tesisId } }),
  }));
  const stuckMs = state ? nowMs - state.horizonChangedAt.getTime() : 0;
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
  };
}
