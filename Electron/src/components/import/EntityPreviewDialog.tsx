import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { importService } from "@/services/importService";
import { downloadTemplate } from "@/lib/import/template";
import { ImportDataPreview, ImportSpecPreview } from "./ImportSpecPreview";

/** Önizlemede gösterilen satır sayısı — dosyanın ŞEKLİNİ anlamaya yeter. */
const PREVIEW_ROWS = 10;

/**
 * "İndirmeden önce bak" diyaloğu — iki kip:
 *  • `template` → şablonun sütunları/kuralları/kabul edilen değerleri
 *  • `data`     → mevcut kayıtların ilk {PREVIEW_ROWS} satırı
 *
 * İndirme düğmesi diyaloğun İÇİNDE: amaç indirmeyi zorlaştırmak değil, önce
 * bakma imkânı vermek. Bir tık ekliyor, karşılığında yanlış dosyayı indirip
 * Excel'de açma turunu kaldırıyor.
 */
export function EntityPreviewDialog({
  open,
  onOpenChange,
  entity,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: string;
  mode: "template" | "data";
}) {
  const [busy, setBusy] = useState(false);

  const templateQuery = useQuery({
    queryKey: ["import-template", entity],
    queryFn: () => importService.template(entity),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const dataQuery = useQuery({
    queryKey: ["import-export-preview", entity],
    queryFn: () => importService.exportData(entity, PREVIEW_ROWS),
    // Yalnız veri kipinde çekilir — şablona bakan kullanıcı için gereksiz sorgu.
    enabled: open && mode === "data",
    staleTime: 60 * 1000,
  });

  const spec = templateQuery.data?.data;
  const data = dataQuery.data?.data;

  const onDownloadTemplate = async () => {
    if (!spec) return;
    setBusy(true);
    try {
      await downloadTemplate(spec);
    } catch {
      toast.error("Şablon indirilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const onDownloadData = async () => {
    setBusy(true);
    try {
      // İndirme LİMİTSİZ çeker — önizlemedeki 10 satır yalnız bakmak içindi.
      const res = await importService.exportData(entity);
      const { columns, rows, label } = res.data;
      if (rows.length === 0) {
        toast.info("Aktarılacak kayıt yok.");
        return;
      }
      const { exportRowsToXlsx } = await import("@/lib/list-export");
      const cols = columns
        .filter((c) => !c.readOnly)
        .map((c) => ({ label: c.label, value: (r: Record<string, string>) => r[c.key] ?? "" }));
      await exportRowsToXlsx(cols, rows, `${label} - veri`, [
        "Bu dosya içe aktarım şablonuyla AYNI sütunları taşır — düzenleyip geri yükleyebilirsiniz.",
      ]);
    } catch {
      toast.error("Veri indirilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const loading = mode === "template" ? templateQuery.isLoading : templateQuery.isLoading || dataQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {spec?.label ?? "Yükleniyor…"} — {mode === "template" ? "Şablon" : "Mevcut Veri"}
          </DialogTitle>
          <DialogDescription>
            {mode === "template"
              ? "Şablonun hangi sütunları istediği, hangilerinin zorunlu olduğu ve kabul edilen değerler."
              : "İndirilecek dosyanın ilk satırları — sütun düzenini görmek için."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : mode === "template" ? (
          spec ? (
            <ImportSpecPreview spec={spec} />
          ) : (
            <p className="text-sm text-destructive">Şablon bilgisi alınamadı.</p>
          )
        ) : data ? (
          <ImportDataPreview
            columns={data.columns}
            rows={data.rows}
            total={data.total}
            truncated={data.truncated}
          />
        ) : (
          <p className="text-sm text-destructive">Veri alınamadı.</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          {mode === "template" ? (
            <Button onClick={() => void onDownloadTemplate()} disabled={!spec || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Şablonu indir
            </Button>
          ) : (
            <Button onClick={() => void onDownloadData()} disabled={!data || data.total === 0 || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {data ? `Tümünü indir (${data.total.toLocaleString("tr-TR")} kayıt)` : "İndir"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
