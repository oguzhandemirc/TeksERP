import type { Table } from "@tanstack/react-table";
import { exportListName, toExportColumns } from "@/lib/table-export";
import { exportSectionsAs, type ExportSection } from "@/lib/list-export-sections";
import { type ExportColumn } from "@/lib/list-export";
import { assertKnownColumns, type ExportColumnOption } from "@/lib/export-columns";
import { drainCursor, EXPORT_PAGE_LIMIT, ExportCancelledError } from "@/lib/export-drain";
import { upTo3Text } from "@/lib/number-format";
import {
  rollService,
  buildRollForceFilters,
  rollTabDefaultSortBy,
  ROLL_GROUP_COLUMNS,
  type RollGroupColumn,
  type RollGroupsResult,
  type RollStatusTabKey,
} from "./service";
import type { Roll } from "./types";

export interface SummaryTab {
  key: RollStatusTabKey;
  label: string;
}

/** "Kumaş Stoğu Özeti" ayrıntı düzeyi: kategori toplamı · kalem kalem (ayrım sütunlarıyla) · top top. */
export type SummaryDetail = "kategori" | "kalem" | "top";

export const SUMMARY_DETAILS: { key: SummaryDetail; label: string; hint: string }[] = [
  { key: "kategori", label: "Kategori toplamı", hint: "Her kategori tek satır: top sayısı ve metre" },
  { key: "kalem", label: "Kalem kalem", hint: "Kategori başına kumaş / renk / en… satırı" },
  { key: "top", label: "Top top", hint: "Kategori başına her top bir satır (liste sütunlarıyla)" },
];

const GROUP_LABEL: Record<RollGroupColumn, string> = {
  item: "Kumaş",
  color: "Renk",
  width: "En (cm)",
  qualityGrade: "Kalite",
  foldType: "Kat",
  warehouse: "Depo",
};
const GROUP_DEFAULT: ReadonlySet<RollGroupColumn> = new Set(["item", "color", "width"]);

/** Sayaç sütunları — üç düzeyde aynı ad ve biçim (ekrandaki şeridin "top / metre"si). */
const COUNT_COLS: ExportColumnOption[] = [
  { id: "count", label: "Top Sayısı", visible: true },
  { id: "qty", label: "Toplam Metre", visible: true },
];

/** Kalem kalem kataloğu: ayrım sütunları (sunucu kapalı listesi) + sayaçlar. */
export const KALEM_CATALOG: ExportColumnOption[] = [
  ...ROLL_GROUP_COLUMNS.map((id) => ({ id, label: GROUP_LABEL[id], visible: GROUP_DEFAULT.has(id) })),
  ...COUNT_COLS,
];
export const KATEGORI_CATALOG: ExportColumnOption[] = COUNT_COLS;

type CountRow = { count: number; qty: number };
const countCols = (ids: readonly string[]): ExportColumn<CountRow>[] =>
  [
    { id: "count", label: "Top Sayısı", value: (r: CountRow) => r.count, summable: true },
    { id: "qty", label: "Toplam Metre", value: (r: CountRow) => r.qty, summable: true },
  ].filter((c) => ids.includes(c.id));

/**
 * Kategori toplamı — TEK bölüm, TOPLAM satırı YOK: kategoriler örtüşebilir (Kurşun/Tambur Bekleyen
 * "Üretimde"nin alt kümesidir) → sekmeleri toplamak çift sayardı.
 */
export function buildCategorySections(
  tabs: SummaryTab[],
  stats: Array<{ key: string; totalCount: number; totalQty: number }>,
  columnIds: readonly string[],
): ExportSection<unknown>[] {
  assertKnownColumns(KATEGORI_CATALOG, columnIds);
  const byKey = new Map(stats.map((s) => [s.key, s]));
  type Row = CountRow & { label: string };
  const rows: Row[] = tabs.map((t) => ({ label: t.label, count: byKey.get(t.key)?.totalCount ?? 0, qty: byKey.get(t.key)?.totalQty ?? 0 }));
  const cols: ExportColumn<Row>[] = [{ id: "label", label: "Kategori", value: (r) => r.label }, ...countCols(columnIds)];
  return [{ title: "Kategori toplamları", cols, rows, noTotals: true } as ExportSection<unknown>];
}

/** Kalem kalem — kategori başına bölüm; bölüm TOPLAM'ı o kategorinin şerit rakamıdır (aynı where). */
export function buildKalemSections(tabs: SummaryTab[], groups: RollGroupsResult[], columnIds: readonly string[]): ExportSection<unknown>[] {
  assertKnownColumns(KALEM_CATALOG, columnIds);
  type Row = RollGroupsResult["groups"][number];
  const dims = ROLL_GROUP_COLUMNS.filter((c) => columnIds.includes(c));
  const cols: ExportColumn<Row>[] = [
    ...dims.map((c) => ({
      id: c,
      label: GROUP_LABEL[c],
      value: (r: Row) => {
        const v = r.values[c];
        if (v == null) return "—";
        return typeof v === "number" ? upTo3Text(v) : v;
      },
    })),
    ...(countCols(columnIds) as unknown as ExportColumn<Row>[]),
  ];
  const byKey = new Map(groups.map((g) => [g.key, g]));
  // Ayrım seçilmediyse sunucu yalnız toplamı döner → bölüm tek satır.
  const rowsOf = (g: RollGroupsResult | undefined): Row[] =>
    !g ? [] : dims.length > 0 ? g.groups : [{ values: {}, count: g.totalCount, qty: g.totalQty }];
  return tabs.map((t) => ({ title: t.label, cols, rows: rowsOf(byKey.get(t.key)) }) as ExportSection<unknown>);
}

/** Kalem kalem sunucu isteğinin ayrım listesi (seçili sayaç dışı sütunlar). */
export const groupByOf = (columnIds: readonly string[]): RollGroupColumn[] =>
  ROLL_GROUP_COLUMNS.filter((c) => columnIds.includes(c));

/** Top top — kategori başına liste ucunun cursor yolundan tüm toplar (ekran listesiyle aynı where + sıralama). */
async function fetchTabRolls(key: RollStatusTabKey, confirmTotal?: (n: number) => Promise<boolean>): Promise<Roll[]> {
  const { rows, cancelled } = await drainCursor<Roll>(
    (cursor) =>
      rollService.listCursor({
        cursor,
        limit: EXPORT_PAGE_LIMIT,
        filters: buildRollForceFilters(key),
        sortBy: rollTabDefaultSortBy(key),
        sortOrder: "desc",
        withTotal: cursor === null,
      }),
    undefined,
    undefined,
    confirmTotal,
  );
  if (cancelled) throw new ExportCancelledError();
  return rows;
}

export interface SummaryRequest {
  detail: SummaryDetail;
  format: "xlsx" | "pdf";
  tabs: SummaryTab[];
  columnIds: string[];
  /** Top top için liste tablosu (sütun tarifi ekranınkiyle aynı olsun diye). */
  table: Table<Roll>;
  confirmTotal?: (n: number) => Promise<boolean>;
}

/** "Kumaş Stoğu Özeti" — seçilen düzeyde bölümleri kurar ve Excel/PDF kaydeder. */
export async function downloadInventorySummary(req: SummaryRequest): Promise<boolean> {
  const items = req.tabs.map((t) => ({ key: t.key, filters: buildRollForceFilters(t.key) }));
  let sections: ExportSection<unknown>[];
  if (req.detail === "kategori") {
    sections = buildCategorySections(req.tabs, (await rollService.getStatsBatch(items)).data ?? [], req.columnIds);
  } else if (req.detail === "kalem") {
    const res = await rollService.getStatsGroups(items, groupByOf(req.columnIds));
    sections = buildKalemSections(req.tabs, res.data ?? [], req.columnIds);
  } else {
    const cols = toExportColumns(req.table, req.columnIds) as ExportColumn<unknown>[];
    sections = [];
    for (const t of req.tabs) sections.push({ title: t.label, cols, rows: await fetchTabRolls(t.key, req.confirmTotal) });
  }
  return exportSectionsAs(req.format, "Kumaş Stoğu Özeti", sections, exportListName("Kumaş Stoğu Özeti"));
}
