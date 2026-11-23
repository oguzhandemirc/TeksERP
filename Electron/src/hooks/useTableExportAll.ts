import type { ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { useTableExportDialog, type TableFetchAll } from "@/components/data-table/export-dialog/useTableExportDialog";

/**
 * "Tümünü İndir" — aktif filtreye uyan SUNUCUDAKİ tüm kayıtlar için ortak çıktı diyaloğu (biçim · kapsam · sütunlar).
 * `DataTableTools`un "Dışa aktar"ıyla AYNI kanca: indirmeyi kendi düğmesinde (sayfalama çubuğu) gösteren sayfalar içindir.
 * İki yerde ayrı yazılınca "aynı listeden iki farklı dosya" olurdu.
 */
export function useTableExportAll<T>(opts: {
  table: Table<T>;
  fetchAll: TableFetchAll<T>;
  /** Dosya adı tabanı (ör. "Envanter"). Tarih/aralık damgası otomatik eklenir. */
  name: string;
}): {
  /** Diyaloğu "filtreye uyan tüm kayıtlar" kapsamıyla açar. */
  open: () => void;
  busy: boolean;
  /** İndirme sürerken "N / ~T indiriliyor…". */
  busyLabel: string | undefined;
  /** Diyalog + büyük liste onayı — çağıran sayfa ağacında çizer. */
  dialog: ReactNode;
} {
  const exp = useTableExportDialog({ table: opts.table, exportName: opts.name, fetchAll: opts.fetchAll });
  return { open: () => exp.open("all"), busy: exp.busy, busyLabel: exp.busyLabel, dialog: exp.dialog };
}
