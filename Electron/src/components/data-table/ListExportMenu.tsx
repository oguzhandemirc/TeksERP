import { ExportMenu } from "./ExportMenu";
import { exportRowsToCsv, exportRowsToPdf, exportRowsToXlsx, type ExportColumn } from "@/lib/list-export";
import { exportListName } from "@/lib/table-export";
import { useExportRange } from "@/hooks/useExportRange";

/**
 * TanStack tablosu OLMAYAN ekranlar için "İndir ▾" (PDF / Excel / CSV).
 * Kullanım: sütunları tarif et, elindeki satırları ver.
 *
 *   <ListExportMenu name="Kullanıcılar" rows={users} columns={USER_EXPORT_COLUMNS} />
 *
 * ⚠️ `rows` EKRANDA GÖRÜNEN satırlardır — sayfalı/sonsuz kaydırmalı bir listede
 * yalnız yüklenenler iner. Sunucudaki tümü gerekiyorsa çağıran önce hepsini
 * çeker (bkz. `useTableExportAll`), yoksa kullanıcı eksik dosya indirdiğini
 * fark etmez.
 */
export function ListExportMenu<T>({
  rows,
  columns,
  name,
  label = "İndir",
  notes,
  disabled,
  size,
  variant,
  title,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  /** Dosya adı tabanı (ör. "Kullanıcılar"). Tarih/aralık damgası otomatik eklenir. */
  name: string;
  label?: string;
  /** Tablonun altına yazılan bağlam notları (Excel + PDF) — "bu rakam neyi kapsar". */
  notes?: string[];
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  title?: string;
}) {
  const range = useExportRange();
  const filename = () => exportListName(name, { range });
  return (
    <ExportMenu
      label={label}
      size={size ?? "sm"}
      variant={variant ?? "outline"}
      disabled={disabled || rows.length === 0}
      title={title ?? (rows.length === 0 ? "İndirilecek kayıt yok" : undefined)}
      onPdf={() => exportRowsToPdf(columns, rows, filename(), notes)}
      onExcel={() => exportRowsToXlsx(columns, rows, filename(), notes)}
      onCsv={() => exportRowsToCsv(columns, rows, filename())}
    />
  );
}
