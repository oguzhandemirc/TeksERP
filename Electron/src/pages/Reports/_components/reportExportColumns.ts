// Rapor çıktısının sütun seçimi (ortak `ExportDialog`): katalog spec'in tablolarından türer, seçim spec'e uygulanır,
// Excel (`toSheets`) ve PDF (`buildReportHtml`) aynı süzülmüş spec'ten üretilir — biri sütun düşürüp öteki düşürmeyemez.
// Grafik veri tabloları katalogda yok: grafiğin dayandığı rakamlar seçimle kırpılmaz.
import { assertKnownColumns, type ExportColumnOption } from "@/lib/export-columns";
import type { ExportBlok, ReportExportSpec, ReportTableSpec } from "./reportExport";

interface TableRef {
  ref: string;
  table: ReportTableSpec;
}

/** Seçilebilir tablolar: `spec.tables` (t<i>) + düzendeki tablo blokları (b<j>), basım sırasıyla. */
function selectableTables(spec: ReportExportSpec): TableRef[] {
  const blocks = (spec.bloklar ?? []).flatMap((b, j) => (b.tur === "tablo" ? [{ ref: `b${j}`, table: b.tablo }] : []));
  return [...blocks, ...spec.tables.map((table, i) => ({ ref: `t${i}`, table }))];
}

const columnId = (ref: string, key: string) => `${ref}:${key}`;

/** Diyalog kataloğu — tek tabloda kolon başlığı, çok tabloda "Tablo · Kolon". Rapor kolonu ekranda hep görünür. */
export function reportColumnCatalog(spec: ReportExportSpec): ExportColumnOption[] {
  const tables = selectableTables(spec);
  const many = tables.length > 1;
  return tables.flatMap(({ ref, table }) =>
    table.columns.map((c) => ({
      id: columnId(ref, c.key),
      label: many ? `${table.name} · ${c.header}` : c.header,
      visible: true,
    })),
  );
}

/**
 * Seçimi spec'e uygular: seçilmeyen kolon iki çıktıdan da düşer; hiç kolonu kalmayan tablo basılmaz.
 * Tanınmayan id fırlatır (fail-closed) — sessizce yok saymak "ekrandakinden farklı dosya" demektir.
 */
export function applyReportColumns(spec: ReportExportSpec, ids: readonly string[]): ReportExportSpec {
  assertKnownColumns(reportColumnCatalog(spec), ids);
  const set = new Set(ids);
  const pick = (ref: string, t: ReportTableSpec): ReportTableSpec | null => {
    const columns = t.columns.filter((c) => set.has(columnId(ref, c.key)));
    return columns.length > 0 ? { ...t, columns } : null;
  };
  const tables = spec.tables.flatMap((t, i) => {
    const p = pick(`t${i}`, t);
    return p ? [p] : [];
  });
  if (!spec.bloklar) return { ...spec, tables };
  const bloklar = spec.bloklar.flatMap((b, j): ExportBlok[] => {
    if (b.tur !== "tablo") return [b];
    const p = pick(`b${j}`, b.tablo);
    return p ? [{ ...b, tablo: p }] : [];
  });
  return { ...spec, tables, bloklar };
}
