import { toast } from "sonner";
import { Download, ClipboardCopy, AlertTriangle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copyText } from "@/lib/clipboard";
import { safeFormat } from "@/lib/format";
import { BackupButton } from "../ServerStatus/BackupButton";
import { fmtBytes } from "../ServerStatus/serverHealth";
import { useBackups, downloadBackup, restoreCommand } from "./service";

export function BackupsPage() {
  const { data, isLoading, isError, refetch, isFetching } = useBackups();
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

  async function handleCopyRestore(name: string) {
    await copyText(restoreCommand(data, name));
    toast.success("Geri yükleme komutu kopyalandı — sunucuda yönetici PowerShell'de çalıştırın.");
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
        {/* Geri yükleme uyarısı */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-medium">Geri yükleme veritabanının tamamını değiştirir.</p>
            <p className="text-muted-foreground">
              Geri yükleme, yedek anından sonraki tüm değişiklikleri siler ve backend'i geçici
              olarak durdurur. Güvenlik için sunucuda yapılır: aşağıdaki "Geri yükleme komutu"nu
              kopyalayıp sunucuda <b>yönetici PowerShell</b>'de çalıştırın (ya da sunucudaki tepsi
              menüsünden "Yedekten geri yükle"yi kullanın). Geri yükleme için <code>.dump</code> +{" "}
              <code>secret.json</code> birlikte gerekir.
            </p>
          </div>
        </div>

        {noDir && (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            Yedek klasörü yalnızca kurulu Windows sunucusunda bulunur (geliştirme ortamında liste
            boştur).
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <Table containerClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Dosya</TableHead>
                  <TableHead className="w-28">Boyut</TableHead>
                  <TableHead className="w-44">Tarih</TableHead>
                  <TableHead className="w-56 text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Yükleniyor…
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-destructive">
                      Yedek listesi alınamadı.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && files.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Henüz yedek yok.
                    </TableCell>
                  </TableRow>
                )}
                {files.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-xs">{f.name}</TableCell>
                    <TableCell className="tabular-nums">{fmtBytes(f.sizeBytes)}</TableCell>
                    <TableCell className="tabular-nums">
                      {safeFormat(f.time, "dd.MM.yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => void handleDownload(f.name)}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          İndir
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleCopyRestore(f.name)}
                          title="Geri yükleme komutunu kopyala"
                        >
                          <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
                          Geri yükle
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
