// DIŞA AKTARMA (Ek-6/A §4.2) — tesis yöneticisi (`bulut:hesap:yonet`) Bulut Kopyası'nın ve bulutta doğan verinin
// dökümünü JSON ya da CSV alır. Hizmet açıkken ve bittikten sonraki 90 gün (SALT_OKUNUR) açıktır; KAPALI'da oturum
// zaten açılmaz. Kurallar:
//   · Projeksiyonlar hesabın OKUYABİLDİĞİ kadardır: tx `app.projeksiyonlar`ı oturumla aynı açar (RLS), izinsiz alt
//     satır (`.finans`/`.kisisel`) dökümde de yoktur; yöneticiye ayrı bir kapı YOK.
//   · Kolonlar saklı satırın kendi alanlarıdır (fabrika kataloğunun opt-in kolonları); bulut kolon EKLEMEZ.
//   · Bulutta doğan veri sırsız görünümle: hesaplar (parola/TOTP/davet yok), gelen kutusu, hesap denetimi.
//   · Sayfalı akış: her sayfa kendi kısa kiracı tx'i (uzun tx yok); bitince ayak izi `DISA_AKTARIM`.
import { Prisma } from "@prisma/client";
import type { SessionContext } from "../auth/session.service";
import { PROJECTION_CATALOG, projectionDef, type ProjectionDef } from "../catalog/projections";
import { accountActor, recordAudit } from "../lib/audit";
import { CSV_BOM, csvLine } from "../lib/csv";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { NO_TENANT, withTesis } from "../lib/tenant";
import type { ExportDataset, ExportFormat, ExportManifest } from "../wire/api";
import { ADMIN_PERMISSION, accountView } from "./account.service";
import type { CloudContext } from "./context";
import { rowView, selectRows, visibleSubRows, type Row } from "./data.service";
import { messageView } from "./inbox.service";
import { loadServiceFacts, serviceState } from "./service-lifecycle";

const PAGE = 500;

/** Akışın yazıcısı: parça yazar (geri basınç çağıranda). */
export type ExportSink = (chunk: string) => Promise<void>;

export interface ExportFile {
  readonly fileName: string;
  readonly contentType: string;
  /** Dosyayı yazar, yazılan satır sayısını döner (ayak izi bundan sonra). */
  readonly write: (sink: ExportSink) => Promise<number>;
}

interface ExportRow {
  readonly json: unknown;
  readonly cells: Readonly<Record<string, unknown>>;
}

interface Dataset {
  readonly name: string;
  readonly kind: ExportDataset["tur"];
  /** CSV sütunları; null = yalnız JSON (ANLIK). */
  columns(): Promise<readonly string[] | null>;
  pages(): AsyncGenerator<readonly ExportRow[]>;
}

function requireAdmin(s: SessionContext): void {
  if (!s.permissions.has(ADMIN_PERMISSION)) throw forbidden("Dışa aktarma yalnız hesap yöneticisine açıktır");
}

/** Hesabın okuyabildiği kök projeksiyonlar (alt satır kendi kökünün içinde gider). */
function readableRoots(s: SessionContext): ProjectionDef[] {
  return [...PROJECTION_CATALOG.values()].filter((d) => !d.subRow && d.permissions.every((p) => s.permissions.has(p)));
}

// ---------------------------------------------------------------- projeksiyon kümeleri

async function jsonKeys(ctx: CloudContext, s: SessionContext, projection: string): Promise<string[]> {
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, (tx) =>
    tx.$queryRaw<{ k: string }[]>`
      SELECT DISTINCT k FROM projection_rows r CROSS JOIN LATERAL jsonb_object_keys(r.data) AS k
       WHERE r.tesis_id = ${s.tesisId}::uuid AND r.projection = ${projection} AND r.deleted_at IS NULL AND jsonb_typeof(r.data) = 'object'
       ORDER BY k`,
  );
  return rows.map((r) => r.k).filter((k) => k !== "id");
}

function recordDataset(ctx: CloudContext, s: SessionContext, def: ProjectionDef): Dataset {
  const sub = visibleSubRows(s, def);
  let layout: { root: string[]; finans: string[]; kisisel: string[] } | null = null;
  return {
    name: def.name,
    kind: "KAYIT",
    async columns() {
      layout = {
        root: await jsonKeys(ctx, s, def.name),
        finans: sub.finans ? await jsonKeys(ctx, s, `${def.name}.finans`) : [],
        kisisel: sub.kisisel ? await jsonKeys(ctx, s, `${def.name}.kisisel`) : [],
      };
      return ["id", ...layout.root, ...layout.finans.map((k) => `finans.${k}`), ...layout.kisisel.map((k) => `kisisel.${k}`), "surum"];
    },
    async *pages() {
      let cursor: Prisma.Sql = Prisma.empty;
      for (;;) {
        const rows = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, (tx) => tx.$queryRaw<Row[]>(selectRows(s, def, cursor, PAGE)));
        if (rows.length === 0) return;
        yield rows.map((r) => ({ json: rowView(r, sub), cells: flatCells(r, layout) }));
        if (rows.length < PAGE) return;
        const last = rows[rows.length - 1]!;
        cursor = Prisma.sql`AND (r.sort_at, r.record_id) < (${last.sort_at}::timestamptz, ${last.record_id}::uuid)`;
      }
    },
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function flatCells(r: Row, layout: { root: string[]; finans: string[]; kisisel: string[] } | null): Record<string, unknown> {
  const out: Record<string, unknown> = { id: r.record_id, surum: r.version_at.toISOString() };
  if (!layout) return out;
  const data = obj(r.data);
  for (const k of layout.root) out[k] = data[k];
  for (const k of layout.finans) out[`finans.${k}`] = obj(r.finans)[k];
  for (const k of layout.kisisel) out[`kisisel.${k}`] = obj(r.kisisel)[k];
  return out;
}

function snapshotDataset(ctx: CloudContext, s: SessionContext, def: ProjectionDef): Dataset {
  return {
    name: def.name,
    kind: "ANLIK",
    columns: async () => null,
    async *pages() {
      const row = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, (tx) =>
        tx.projectionRow.findUnique({ where: { tesisId_projection_recordId: { tesisId: s.tesisId, projection: def.name, recordId: NO_TENANT } } }),
      );
      if (row && !row.deletedAt) yield [{ json: { veri: row.data, surum: row.versionAt.toISOString() }, cells: {} }];
    },
  };
}

// ---------------------------------------------------------------- bulutta doğan veri

/** Kimlik imleçli sayfalar (`createdAt desc, id desc` — listelerle aynı sıra). */
async function* byIdPages<T extends { id: string }>(fetch: (cursor: string | undefined) => Promise<T[]>, map: (row: T) => ExportRow): AsyncGenerator<readonly ExportRow[]> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetch(cursor);
    if (rows.length === 0) return;
    yield rows.map(map);
    if (rows.length < PAGE) return;
    cursor = rows[rows.length - 1]!.id;
  }
}

const page = (cursor: string | undefined) => ({ orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });

const INBOX_COLUMNS = ["mesajId", "tur", "durum", "hesapId", "hesapAdi", "olusturulma", "islenme", "iptal", "govde", "sonuc"];
const ACCOUNT_COLUMNS = ["id", "eposta", "ad", "durum", "izinler", "sonGiris", "davetBitis", "olusturulma"];
const AUDIT_COLUMNS = ["id", "aktor", "olay", "varlik", "varlikId", "ozet", "zaman"];

function cloudDatasets(ctx: CloudContext, s: SessionContext): Dataset[] {
  const scope = { tesisId: s.tesisId };
  const cells = (v: object): ExportRow => ({ json: v, cells: v as Record<string, unknown> });
  return [
    {
      name: "gelen-kutusu",
      kind: "BULUT",
      columns: async () => INBOX_COLUMNS,
      pages: () =>
        byIdPages(
          (c) => withTesis(ctx.app, scope, (tx) => tx.inboxMessage.findMany({ where: scope, ...page(c) })),
          (m) => cells({ ...messageView(m), hesapId: m.accountId }),
        ),
    },
    {
      name: "hesaplar",
      kind: "BULUT",
      columns: async () => ACCOUNT_COLUMNS,
      pages: () => byIdPages((c) => withTesis(ctx.app, scope, (tx) => tx.account.findMany({ where: scope, ...page(c) })), (a) => cells(accountView(a))),
    },
    {
      name: "hesap-denetimi",
      kind: "BULUT",
      columns: async () => AUDIT_COLUMNS,
      pages: () =>
        byIdPages(
          (c) => withTesis(ctx.app, scope, (tx) => tx.accountAudit.findMany({ where: scope, ...page(c) })),
          (r) => cells({ id: r.id, aktor: r.actor, olay: r.event, varlik: r.entity, varlikId: r.entityId, ozet: r.summary, zaman: r.createdAt.toISOString() }),
        ),
    },
  ];
}

async function cloudCounts(ctx: CloudContext, s: SessionContext): Promise<Record<string, number>> {
  const scope = { tesisId: s.tesisId };
  return withTesis(ctx.app, scope, async (tx) => ({
    "gelen-kutusu": await tx.inboxMessage.count({ where: scope }),
    hesaplar: await tx.account.count({ where: scope }),
    "hesap-denetimi": await tx.accountAudit.count({ where: scope }),
  }));
}

// ---------------------------------------------------------------- manifest + dosya

export async function exportManifest(ctx: CloudContext, s: SessionContext): Promise<ExportManifest> {
  requireAdmin(s);
  const nowMs = ctx.now();
  const roots = readableRoots(s);
  const { counts, facts } = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, async (tx) => ({
    counts: await tx.$queryRaw<{ projection: string; n: number }[]>`
      SELECT projection, count(*)::int AS n FROM projection_rows
       WHERE tesis_id = ${s.tesisId}::uuid AND deleted_at IS NULL AND projection = ANY(${roots.map((r) => r.name)}::text[])
       GROUP BY projection`,
    facts: await loadServiceFacts(tx, s.tesisId),
  }));
  const byName = new Map(counts.map((c) => [c.projection, c.n]));
  const cloud = await cloudCounts(ctx, s);
  const state = facts ? serviceState(facts, nowMs) : null;
  const kumeler: ExportDataset[] = [
    ...roots.map((d): ExportDataset => ({ ad: d.name, tur: d.root.kind === "ANLIK" ? "ANLIK" : "KAYIT", adet: byName.get(d.name) ?? 0, bicimler: d.root.kind === "ANLIK" ? ["json"] : ["json", "csv"] })),
    ...Object.entries(cloud).map(([ad, adet]): ExportDataset => ({ ad, tur: "BULUT", adet, bicimler: ["json", "csv"] })),
  ];
  return {
    hizmet: { asama: state?.phase ?? "KAPALI", bitis: state?.endedAt?.toISOString() ?? null, saltOkunurBitis: state?.readOnlyUntil?.toISOString() ?? null },
    kumeler,
  };
}

function resolveDataset(ctx: CloudContext, s: SessionContext, name: string): Dataset {
  const cloud = cloudDatasets(ctx, s).find((d) => d.name === name);
  if (cloud) return cloud;
  const def = projectionDef(name);
  if (!def || def.subRow) throw notFound("Dışa aktarma kümesi");
  if (!def.permissions.every((p) => s.permissions.has(p))) throw forbidden("Bu veriyi görme yetkiniz yok");
  return def.root.kind === "ANLIK" ? snapshotDataset(ctx, s, def) : recordDataset(ctx, s, def);
}

export function parseExportFormat(value: unknown): ExportFormat {
  if (value === undefined || value === "json") return "json";
  if (value === "csv") return "csv";
  throw badRequest("bicim json ya da csv olmalı");
}

async function writeJson(ds: Dataset, head: Record<string, unknown>, sink: ExportSink): Promise<number> {
  let n = 0;
  if (ds.kind === "ANLIK") {
    let body: Record<string, unknown> = { veri: null, surum: null };
    for await (const rows of ds.pages()) {
      for (const r of rows) {
        body = r.json as Record<string, unknown>;
        n++;
      }
    }
    await sink(`${JSON.stringify({ ...head, ...body })}\n`);
    return n;
  }
  await sink(`${JSON.stringify(head).slice(0, -1)},"kayitlar":[`);
  for await (const rows of ds.pages()) {
    for (const r of rows) await sink(`${n++ === 0 ? "\n" : ",\n"}${JSON.stringify(r.json)}`);
  }
  await sink("\n]}\n");
  return n;
}

async function writeCsv(ds: Dataset, columns: readonly string[], sink: ExportSink): Promise<number> {
  let n = 0;
  await sink(CSV_BOM + csvLine(columns));
  for await (const rows of ds.pages()) {
    let chunk = "";
    for (const r of rows) {
      chunk += csvLine(columns.map((c) => r.cells[c]));
      n++;
    }
    await sink(chunk);
  }
  return n;
}

export async function openExport(ctx: CloudContext, s: SessionContext, name: string, format: ExportFormat): Promise<ExportFile> {
  requireAdmin(s);
  const ds = resolveDataset(ctx, s, name);
  const columns = format === "csv" ? await ds.columns() : null;
  if (format === "csv" && !columns) throw badRequest("Bu küme (anlık özet) yalnız JSON olarak dışa aktarılır");
  const now = new Date(ctx.now());
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13);
  return {
    fileName: `patron-${s.tesisId.slice(0, 8)}-${ds.name}-${stamp}Z.${format}`,
    contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    write: async (sink) => {
      const head = { kume: ds.name, tur: ds.kind, tesisId: s.tesisId, uretildi: now.toISOString() };
      const n = columns ? await writeCsv(ds, columns, sink) : await writeJson(ds, head, sink);
      await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "DISA_AKTARIM", entity: "Export", entityId: ds.name, summary: { kume: ds.name, bicim: format, adet: n } });
      return n;
    },
  };
}
