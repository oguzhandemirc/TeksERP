import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { safeFormat } from "@/lib/format";
import { BackupButton } from "../ServerStatus/BackupButton";
import { useBackups, downloadBackup } from "./service";
import { BackupScheduleCard } from "./BackupScheduleCard";
import { BackupsTable } from "./BackupsTable";
import { RestoreDialog } from "./RestoreDialog";

export function BackupsPage() {
  const { data, isLoading, isError, refetch, isFetching } = useBackups();
  const navigate = useNavigate();
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const files = data?.files ?? [];
  const noDir = !!data && data.backupDir === null;

  async function handleDownload(name: string) {
    try {
      await downloadBackup(name);
      toast.success("Yedek indiriliyor.");
    } catch {
      toast.error("Yedek indirilemedi.");
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Yedekler"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => void refetch()} title="Yenile">
              <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
            <BackupButton />
          </div>
        }
      />

      <PageBody className="space-y-6 p-6">
        <BackupScheduleCard />

        <Callout tone="warning" title="Geri yükleme veritabanının tamamını değiştirir">
          Geri yükleme, yedek anından sonraki tüm değişiklikleri siler ve backend'i geçici
          olarak durdurur. Güvenlik için sunucuda yapılır: <b>"Geri yükle"</b> ile ne
          kaybedeceğinizi görün, onaylayın ve komut bloğunu kopyalayıp sunucuda{" "}
          <b>yönetici PowerShell</b>'de çalıştırın. Blok önce <b>doğrulanmış bir güvenlik
          yedeği</b> alır; alamazsa geri yükleme çalışmaz.
        </Callout>

        {noDir && (
          <Callout tone="danger" title="Yedekleme kapalı">
            Sunucuda <code>BACKUP_DIR</code> ortam değişkeni tanımlı değil — otomatik gece
            yedeği çalışmıyor. (Geliştirme ortamında bu normaldir.)
          </Callout>
        )}

        {data?.running && (
          <Callout tone="muted">
            Yedek alınıyor… <code>pg_dump</code> sunucuda çalışıyor; bitince liste güncellenir.
          </Callout>
        )}

        {/* Son deneme sonucu — başarısız gece yedeği eskiden hiç görünmüyordu. */}
        {data?.lastResult && !data.running && (
          <Callout
            tone={data.lastResult.ok ? "muted" : "danger"}
            title={`Son yedek denemesi${
              data.lastResult.trigger === "nightly" ? " (gece)" : " (elle)"
            } — ${data.lastResult.ok ? "başarılı" : "BAŞARISIZ"}`}
          >
            <div>{data.lastResult.message}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {safeFormat(data.lastResult.finishedAt, "dd.MM.yyyy HH:mm")}
              {data.lastResult.durationMs > 0 &&
                ` · ${Math.round(data.lastResult.durationMs / 1000)} sn sürdü`}
            </div>
          </Callout>
        )}

        <BackupsTable
          files={files}
          isLoading={isLoading}
          isError={isError}
          onDownload={(n) => void handleDownload(n)}
          onRestore={setRestoreName}
          onRestoreToCopy={(n) => navigate(`/system/db-restore?backup=${encodeURIComponent(n)}`)}
        />
      </PageBody>

      <RestoreDialog
        name={restoreName}
        listing={data}
        onClose={() => setRestoreName(null)}
      />
    </PageShell>
  );
}
