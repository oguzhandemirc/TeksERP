import { useState } from "react";
import { FileText, FileSpreadsheet, FileType2, Loader2, Settings2 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  columnLabel,
  exportTableToPdf,
  exportTableToXlsx,
  exportTableToCsv,
  exportListName,
} from "@/lib/table-export";
import { useExportRange } from "@/hooks/useExportRange";

type ExportKind = "pdf" | "xlsx" | "csv";

interface Props<T> {
  table: Table<T>;
  /** İndirilen liste dosya adı tabanı (ör. "Sevkiyatlar"). Tarih otomatik eklenir. */
  exportName?: string;
  /** Verilirse "İndir" ekrandaki YÜKLÜ satırları değil, aktif filtre/aramaya uyan
   *  SUNUCUDAKİ TÜM kayıtları çeker (useDataTable.fetchAll). Sektör standardı: dışa
   *  aktarma = tüm liste. Verilmezse yalnız bellekteki satırlar iner (geriye uyumlu).
   *  onProgress: her sayfadan sonra (yüklenen, ~toplam) — uzun indirmede ilerleme. */
  fetchAll?: (onProgress?: (loaded: number, total?: number) => void) => Promise<T[]>;
  /** true → indirme bölümü gizlenir (yalnız sütun göster/gizle kalır). İndirme başka
   *  bir yerde (ör. sayfalama çubuğunda "Tümünü İndir") görünür olduğunda çift olmasın. */
  hideExport?: boolean;
}

const LABELS: Record<ExportKind, string> = {
  pdf: "PDF indir",
  xlsx: "Excel indir",
  csv: "CSV indir",
};

/**
 * Tablo araçları — sütun göster/gizle (kullanıcı tercihinde kalıcı) ve listeyi
 * PDF/Excel indirme (format seçilir). `fetchAll` verilirse tüm kayıtları indirir.
 */
export function DataTableTools<T>({ table, exportName = "Liste", fetchAll, hideExport }: Props<T>) {
  const [busy, setBusy] = useState<null | ExportKind>(null);
  // Dosya adındaki damga: filtrede tarih aralığı varsa VERİNİN dönemi, yoksa bugün.
  const range = useExportRange();
  // Uzun "tümünü indir"de ilerleme (yüklenen / ~toplam) — 30k'da 30+ sn sürebilir,
  // belirsiz spinner "dondu mu?" paniği yaratır; sayaç güven verir.
  const [progress, setProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const hideable = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && c.id !== "select" && c.id !== "actions");

  // Tümünü (fetchAll) ya da yalnız yüklü satırları indir. fetchAll varsa liste büyük
  // olabileceğinden butonu "hazırlanıyor" durumuna alır (çift-tık + erken toast önlenir).
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

  // Buton etiketi: indirirken "N / ~T" (toplam biliniyorsa), yoksa "Hazırlanıyor…".
  const busyLabel = (kind: ExportKind): string => {
    if (busy !== kind) return LABELS[kind];
    if (progress) {
      const t = progress.total ? ` / ~${progress.total.toLocaleString("tr-TR")}` : "";
      return `${progress.loaded.toLocaleString("tr-TR")}${t} indiriliyor…`;
    }
    return "Hazırlanıyor…";
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" title="Sütunlar & dışa aktar">
          <Settings2 className="h-3.5 w-3.5" />
          Sütunlar
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Görünür Sütunlar</p>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {hideable.map((col) => (
            <li key={col.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                <Checkbox
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(Boolean(v))}
                />
                <span className="truncate">{columnLabel(col)}</span>
              </label>
            </li>
          ))}
        </ul>
        {!hideExport && (
        <div className="mt-2 space-y-0.5 border-t pt-2">
          <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
            {fetchAll ? "Tüm listeyi indir" : "Listeyi indir"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            disabled={busy !== null}
            onClick={() => void runExport("pdf")}
          >
            {busy === "pdf" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5 text-destructive" />
            )}
            {busyLabel("pdf")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            disabled={busy !== null}
            onClick={() => void runExport("xlsx")}
          >
            {busy === "xlsx" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
            )}
            {busyLabel("xlsx")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            disabled={busy !== null}
            onClick={() => void runExport("csv")}
            title="Noktalı virgül ayraçlı, Türkçe Excel ile uyumlu düz metin"
          >
            {busy === "csv" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileType2 className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {busyLabel("csv")}
          </Button>
        </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
