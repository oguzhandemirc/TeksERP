import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { DatabaseBackup, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { licenseService } from "@/services/licenseService";
import { importService } from "@/services/importService";
import apiClient from "@/services/apiClient";
import { downloadBackup } from "@/pages/System/Backups/service";
import { downloadEntityData } from "@/lib/import/entity-data-export";
import { apiErrorText } from "@/lib/api-error";
import { safeFormat } from "@/lib/format";

/** Backend `veri-disari` guard'ının aynası: (ayar ∨ yedek) VE kullanıcı yönetimi. */
export const DATA_EXPORT_ANY = ["admin:settings", "system:backups"];
export const DATA_EXPORT_ALSO = "admin:users";

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/**
 * "VERİLERİMİ AL" — lisans durdurulmuş olsa da yedek ve dışa aktarma AÇIKTIR
 * (kullanıcı kararı, K5). Yalnız yönetici: kapı backend'de, burada yalnız ayna.
 */
export function DataExportPanel() {
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const allowed = hasAnyPermission(DATA_EXPORT_ANY) && hasPermission(DATA_EXPORT_ALSO);
  const [busy, setBusy] = useState<string | null>(null);
  const manifest = useQuery({ queryKey: ["license", "veri-disari"], queryFn: licenseService.dataExport, enabled: allowed });
  const entities = useQuery({
    queryKey: ["license", "veri-disari", "varliklar"],
    queryFn: () => importService.entities().then((r) => r.data.filter((e) => e.canRead)),
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <Callout tone="muted" title="Verilerimi al">
        Yedek indirmek ve verileri dışa aktarmak için yönetici hesabıyla giriş yapın (yedek ve
        kullanıcı yönetimi yetkisi).
      </Callout>
    );
  }

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(apiErrorText(err, "İşlem tamamlanamadı."));
    } finally {
      setBusy(null);
    }
  };

  const startBackup = () =>
    run(
      "yedek",
      () => apiClient.post("/api/admin/backup", {}, { suppressErrorToast: true }).then(() => manifest.refetch()),
      "Yedek başlatıldı; birkaç dakika içinde listede görünür.",
    );

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Verilerimi al</h3>
        <Button size="sm" variant="outline" onClick={startBackup} disabled={busy !== null}>
          <DatabaseBackup className="mr-1.5 h-4 w-4" /> Yeni yedek al
        </Button>
      </div>
      {manifest.isError && <Callout tone="warning">{apiErrorText(manifest.error, "Yedek listesi okunamadı.")}</Callout>}
      <ul className="space-y-1">
        {(manifest.data?.yedekler ?? []).map((y) => (
          <li key={y.ad} className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono">{y.ad}</span>
            <span className="text-muted-foreground">{safeFormat(y.zaman, "dd.MM.yyyy HH:mm")} · {mb(y.boyutBayt)}</span>
            <Button size="sm" variant="ghost" className="h-7" disabled={busy !== null} onClick={() => run(y.ad, () => downloadBackup(y.ad))}>
              {busy === y.ad ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Kayıtları Excel olarak indir (içe aktarım şablonuyla aynı sütunlar):</p>
      <div className="flex flex-wrap gap-1.5">
        {(entities.data ?? []).map((e) => (
          <Button
            key={e.entity}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy !== null}
            onClick={() => run(e.entity, () => downloadEntityData(e.entity))}
          >
            <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> {e.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
