import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type ExportColumn } from "@/lib/list-export";
import { exportListAs, listExportCatalog } from "@/lib/list-export-sections";
import { exportListName } from "@/lib/table-export";
import { useExportRange } from "@/hooks/useExportRange";
import { ExportDialog } from "./export-dialog/ExportDialog";

/**
 * TanStack tablosu OLMAYAN ekranlar için "Dışa aktar" — ortak çıktı diyaloğunu açar (biçim + sütunlar).
 * Kullanım: sütunları tarif et, elindeki satırları ver.
 *
 *   <ListExportMenu name="Kullanıcılar" rows={users} columns={USER_EXPORT_COLUMNS} />
 *
 * ⚠️ `rows` EKRANDA GÖRÜNEN satırlardır — sayfalı/sonsuz kaydırmalı bir listede yalnız yüklenenler iner.
 * Sunucudaki tümü gerekiyorsa çağıran önce hepsini çeker (bkz. `useTableExportAll`). Sütunda `hidden: true`
 * → diyalogda işaretsiz gelir (ekranda gösterilmeyen ayrıntı).
 */
export function ListExportMenu<T>({
  rows,
  columns,
  name,
  label = "Dışa aktar",
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
  const [open, setOpen] = useState(false);
  const range = useExportRange();
  const empty = rows.length === 0;
  return (
    <>
      <ExportDialog
        open={open}
        onOpenChange={setOpen}
        title={`Dışa aktar — ${name}`}
        info={notes?.length ? notes.join(" ") : "Satırlar ekrandaki liste ile aynıdır; Excel, PDF ve CSV aynı değerleri taşır."}
        catalog={open ? listExportCatalog(columns) : []}
        scopes={[{ key: "loaded", label: "Listedeki kayıtlar", count: rows.length }]}
        prefKey={`liste:${name}`}
        onRun={async (c) => {
          try {
            return await exportListAs(c.format, columns, c.columns, rows, exportListName(name, { range }), notes);
          } catch {
            toast.error("İndirme hazırlanamadı.");
            return false;
          }
        }}
      />
      <Button
        type="button"
        size={size ?? "sm"}
        variant={variant ?? "outline"}
        className="gap-1.5"
        disabled={disabled || empty}
        title={title ?? (empty ? "İndirilecek kayıt yok" : "Listeyi dosyaya aktar (biçim ve sütunlar seçilir)")}
        onClick={() => setOpen(true)}
      >
        <Download className="h-4 w-4" /> {label}
      </Button>
    </>
  );
}
