// Kumaş Stoğu Özeti "kalem kalem" çıktısı — her kategori (sekme filtresi) için seçilen ayrım
// sütunlarına göre top sayısı + metre. Where liste/cursor/`/rolls/stats` ile AYNI
// (`buildRollWhere`): grup toplamları o kategorinin şerit rakamına birebir eşittir
// (`test_cikti_tutarlilik` ölçer). Ayrım sütunları KAPALI LİSTE; tanınmayan sütun 400 (fail-closed).

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import type { ApiResponse, QueryParams } from "../../types/api.types";
import { loadProducedBuckets } from "../helpers/roll-finalize.helper";
import { loadFoldTypeCatalog } from "../helpers/fold-type";
import type { InventoryServiceThis } from "./shared";

/** Çıktıda seçilebilen ayrım sütunu → Roll kolonu. Sıra = çıktıdaki sütun sırası. */
export const ROLL_GROUP_COLUMNS = {
  item: "itemId",
  color: "colorId",
  width: "width",
  qualityGrade: "qualityGrade",
  foldType: "foldType",
  warehouse: "warehouseId",
} as const;
export type RollGroupColumn = keyof typeof ROLL_GROUP_COLUMNS;
export const ROLL_GROUP_COLUMN_KEYS = Object.keys(ROLL_GROUP_COLUMNS) as RollGroupColumn[];

/** Kategori başına grup tavanı — üstü 400 (PDF/Excel'e sığmayacak bir döküm sessizce kesilmez). */
export const ROLL_GROUP_MAX = 20_000;

export interface RollGroupRow {
  /** Seçilen sütunların GÖRÜNEN değeri (ad/kod); boş değer `null`. */
  values: Partial<Record<RollGroupColumn, string | number | null>>;
  count: number;
  qty: number;
}

export interface RollGroupsResult {
  key: string;
  totalCount: number;
  totalQty: number;
  groups: RollGroupRow[];
}

/** Tanınmayan sütun → 400 `UNKNOWN_EXPORT_COLUMN`; tekrarlar atılır, sıra kapalı listeninki. */
export function resolveRollGroupColumns(raw: readonly string[]): RollGroupColumn[] {
  const unknown = raw.filter((c) => !(c in ROLL_GROUP_COLUMNS));
  if (unknown.length > 0) {
    throw AppError.badRequest(`Tanınmayan çıktı sütunu: ${unknown.join(", ")}`, {
      code: "UNKNOWN_EXPORT_COLUMN",
      unknown,
      allowed: ROLL_GROUP_COLUMN_KEYS,
    });
  }
  return ROLL_GROUP_COLUMN_KEYS.filter((c) => raw.includes(c));
}

type NameMaps = {
  item: Map<string, string>;
  color: Map<string, string>;
  qualityGrade: Map<string, string>;
  foldType: Map<string, string>;
  warehouse: Map<string, string>;
};

async function loadNames(columns: RollGroupColumn[], ids: { item: Set<string>; color: Set<string>; warehouse: Set<string> }): Promise<NameMaps> {
  const want = new Set(columns);
  const [items, colors, grades, folds, warehouses] = await Promise.all([
    want.has("item") && ids.item.size
      ? prisma.item.findMany({ where: { id: { in: [...ids.item] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    want.has("color") && ids.color.size
      ? prisma.color.findMany({ where: { id: { in: [...ids.color] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    want.has("qualityGrade") ? prisma.qualityGrade.findMany({ select: { code: true, name: true } }) : Promise.resolve([]),
    want.has("foldType") ? loadFoldTypeCatalog() : Promise.resolve({ values: [] as { code: string; name: string }[] }),
    want.has("warehouse") && ids.warehouse.size
      ? prisma.warehouse.findMany({ where: { id: { in: [...ids.warehouse] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return {
    item: new Map(items.map((r) => [r.id, r.name])),
    color: new Map(colors.map((r) => [r.id, r.name])),
    qualityGrade: new Map(grades.map((r) => [r.code, r.name])),
    foldType: new Map(folds.values.map((r) => [r.code, r.name])),
    warehouse: new Map(warehouses.map((r) => [r.id, r.name])),
  };
}

export async function getRollStatsGroups(
  this: InventoryServiceThis,
  items: Array<{ key: string; filters?: Record<string, unknown> }>,
  rawColumns: readonly string[],
): Promise<ApiResponse<RollGroupsResult[]>> {
  const columns = resolveRollGroupColumns(rawColumns);
  const by = columns.map((c) => ROLL_GROUP_COLUMNS[c]);
  const { fireCodes } = await loadProducedBuckets(prisma);

  const raw = await Promise.all(
    items.map(async (it) => {
      const where = this.buildRollWhere({ filters: it.filters ?? {} } as QueryParams, fireCodes) as Prisma.RollWhereInput;
      // Ayrımsız istek = yalnız toplam (kategori özeti); groupBy boş `by` kabul etmez.
      if (by.length === 0) {
        const agg = await prisma.roll.aggregate({ where, _count: { _all: true }, _sum: { currentQty: true } });
        return { key: it.key, rows: [{ _count: { _all: agg._count._all }, _sum: { currentQty: agg._sum.currentQty } }] as GroupRaw[] };
      }
      const rows = (await prisma.roll.groupBy({
        where,
        by: by as Prisma.RollScalarFieldEnum[],
        _count: { _all: true },
        _sum: { currentQty: true },
      })) as unknown as GroupRaw[];
      if (rows.length > ROLL_GROUP_MAX) {
        throw AppError.badRequest(`Özet çok geniş (${rows.length} satır); ayrım sütunlarını azaltın ya da kategori seçin.`, {
          code: "EXPORT_GROUPS_TOO_MANY",
          max: ROLL_GROUP_MAX,
        });
      }
      return { key: it.key, rows };
    }),
  );

  const ids = { item: new Set<string>(), color: new Set<string>(), warehouse: new Set<string>() };
  for (const r of raw) {
    for (const g of r.rows) {
      if (g.itemId) ids.item.add(g.itemId);
      if (g.colorId) ids.color.add(g.colorId);
      if (g.warehouseId) ids.warehouse.add(g.warehouseId);
    }
  }
  const names = await loadNames(columns, ids);

  const display = (c: RollGroupColumn, g: GroupRaw): string | number | null => {
    switch (c) {
      case "item": return g.itemId ? names.item.get(g.itemId) ?? g.itemId : null;
      case "color": return g.colorId ? names.color.get(g.colorId) ?? g.colorId : null;
      case "width": return g.width == null ? null : Number(g.width);
      case "qualityGrade": return g.qualityGrade ? names.qualityGrade.get(g.qualityGrade) ?? g.qualityGrade : null;
      case "foldType": return g.foldType ? names.foldType.get(g.foldType) ?? g.foldType : null;
      case "warehouse": return g.warehouseId ? names.warehouse.get(g.warehouseId) ?? g.warehouseId : null;
    }
  };

  const data = raw.map(({ key, rows }) => {
    // Toplam Decimal ile birikir (float sürüklenmesi yok) — `/rolls/stats` ile aynı yol.
    let totalCount = 0;
    let totalQty = new Prisma.Decimal(0);
    const groups: RollGroupRow[] = rows.map((g) => {
      totalCount += g._count._all;
      if (g._sum.currentQty) totalQty = totalQty.plus(g._sum.currentQty);
      return {
        values: Object.fromEntries(columns.map((c) => [c, display(c, g)])),
        count: g._count._all,
        qty: Number(g._sum.currentQty ?? 0),
      };
    });
    // Belirlenimli sıra: görünen değerlere göre (tr), eşitlikte metre azalan.
    groups.sort((a, b) => {
      for (const c of columns) {
        const x = a.values[c];
        const y = b.values[c];
        if (x === y) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "tr");
        if (d !== 0) return d;
      }
      return b.qty - a.qty;
    });
    return { key, totalCount, totalQty: Number(totalQty), groups: by.length === 0 ? [] : groups };
  });
  return { success: true, data };
}

interface GroupRaw {
  itemId?: string | null;
  colorId?: string | null;
  width?: Prisma.Decimal | null;
  qualityGrade?: string | null;
  foldType?: string | null;
  warehouseId?: string | null;
  _count: { _all: number };
  _sum: { currentQty: Prisma.Decimal | null };
}
