import { useState, type ReactNode } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportTableToPdf, exportTableToXlsx, exportTableToCsv, exportListName } from "@/lib/table-export";
import { useExportRange } from "@/hooks/useExportRange";

type ExportKind = "pdf" | "xlsx" | "csv";

/** Ekranın kendi dışa aktarma seçeneği (ör. Siparişler "Excel (stok kalemi bazında)…"). */
export interface ExtraExportOption {
  key: string;
  label: string;
  /** Madde ipucu — ne indirdiğini söyler. */
  title?: string;
  icon?: ReactNode;
  onSelect: () => void;
}

// Bakım hattı (1.3.x) imzası: tavan uyarısı/100K onayı yok, yalnız ilerleme.
export type TableFetchAll<T> = (onProgress?: (loaded: number, total?: number) => void) => Promise<T[]>;

/** Tablo indirme işi — ilerleme (eski "Sütunlar" menüsündeki davranışın aynısı). */
function useTableExportRun<T>(table: Table<T>, exportName: string, fetchAll?: TableFetchAll<T>) {
  const [busy, setBusy] = useState<null | ExportKind>(null);
  const [progress, setProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const range = useExportRange();

  const runExport = async (kind: ExportKind) => {
    if (busy) return;
    setBusy(kind);
    setProgress(null);
    try {
      const rows = fetchAll
        ? await fetchAll((loaded, total) => setProgress({ loaded, total }))
        : table.getRowModel().rows.map((r) => r.original);
      if (rows.length === 0) {
        toast.info("İndirilecek kayıt yok.");
        return;
      }
      const name = exportListName(exportName, { range });
      if (kind === "pdf") await exportTableToPdf(table, rows, name);
      else if (kind === "csv") await exportTableToCsv(table, rows, name);
      else await exportTableToXlsx(table, rows, name);
    } catch {
      toast.error("İndirme hazırlanamadı.");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return { busy, progress, runExport };
}

/**
 * "Dışa aktar ▾" — Excel · (ekranın ek seçenekleri) · PDF · CSV. Çıktı ekrandaki sütunlardır;
 * `fetchAll` verilirse süzgece uyan TÜM kayıtlar (sektör standardı), yoksa yüklü satırlar.
 */
export function DataTableExportMenu<T>({
  table,
  exportName = "Liste",
  fetchAll,
  extraExports,
  compact,
}: {
  table: Table<T>;
  exportName?: string;
  fetchAll?: TableFetchAll<T>;
  extraExports?: ExtraExportOption[];
  /** 2xl altında yazı düşer (simge + ok kalır); indirme sürerken sayaç yine görünür. */
  compact?: boolean;
}) {
  const { busy, progress, runExport } = useTableExportRun(table, exportName, fetchAll);

  // Uzun "tümünü indir"de sayaç (30K'da 30+ sn sürebilir; belirsiz spinner "dondu mu?" dedirtir).
  const triggerLabel = !busy
    ? "Dışa aktar"
    : progress
      ? `${progress.loaded.toLocaleString("tr-TR")}${progress.total ? ` / ~${progress.total.toLocaleString("tr-TR")}` : ""} indiriliyor…`
      : "Hazırlanıyor…";
  const scope = fetchAll ? "süzgece uyan tüm kayıtlar" : "ekrandaki kayıtlar";
  const extras = extraExports ?? [];

  return (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={busy !== null}
            title={`Listeyi dosyaya aktar (${scope}, ekrandaki sütunlar)`}
            aria-label={compact && !busy ? "Dışa aktar" : undefined}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className={compact && !busy ? "hidden 2xl:inline" : undefined}>{triggerLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem className="gap-2" onSelect={() => void runExport("xlsx")}>
            <FileSpreadsheet className="h-4 w-4 text-success" /> Excel
          </DropdownMenuItem>
          {extras.map((x) => (
            <DropdownMenuItem key={x.key} className="gap-2" title={x.title} onSelect={() => x.onSelect()}>
              {x.icon ?? <FileSpreadsheet className="h-4 w-4 text-success" />} {x.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" onSelect={() => void runExport("pdf")}>
            <FileText className="h-4 w-4 text-destructive" /> PDF
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            title="Noktalı virgül ayraçlı, Türkçe Excel ile uyumlu düz metin"
            onSelect={() => void runExport("csv")}
          >
            <FileType2 className="h-4 w-4 text-muted-foreground" /> CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
  );
}
