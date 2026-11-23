import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useTableExportAll } from "@/hooks/useTableExportAll";

/** Sayfalama çubuğundaki "Tümünü İndir" — ortak çıktı diyaloğunu açar ve diyaloğu kendisi çizer. */
export function ExportAllButton({ exp, label = "Tümünü İndir" }: { exp: ReturnType<typeof useTableExportAll>; label?: string }) {
  return (
    <>
      {exp.dialog}
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5" disabled={exp.busy} onClick={exp.open} title="Filtreye uyan tüm kayıtları dosyaya aktar (biçim ve sütunlar seçilir)">
        {exp.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {exp.busy ? exp.busyLabel ?? "Hazırlanıyor…" : label}
      </Button>
    </>
  );
}
