import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy, Undo2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PreviewErrorBlock } from "@/components/forms/PreviewErrorBlock";
import { TypeToConfirm, matchesConfirmation } from "@/components/forms/TypeToConfirm";
import { copyText } from "@/lib/clipboard";
import { useSwapCommands } from "./hooks";

/**
 * Takas komut bloğu.
 *
 * Backend takası ÇALIŞTIRAMAZ (rename kendi bağlantısını koparır, `pm2 stop/start`
 * dışarıda) — bu dialog yalnız komutu hazırlar. GERİ ALMA bloğu ileri bloktan
 * ÖNCE gösterilir ve ayrı butonla kopyalanır: operatörün elinde geri dönüş yolu
 * olmadan ileri gitmesini istemiyoruz.
 */
export function SwapCommandDialog({
  copyName,
  liveDatabase,
  onClose,
}: {
  copyName: string | null;
  liveDatabase: string;
  onClose: () => void;
}) {
  const open = copyName !== null;
  const query = useSwapCommands(open ? copyName : null);
  const [typed, setTyped] = useState("");
  const [rollbackCopied, setRollbackCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setRollbackCopied(false);
    }
  }, [open, copyName]);

  const confirmed = matchesConfirmation(typed, liveDatabase);
  const cmds = query.data;
  const forwardDisabled = !cmds || query.isLoading || query.isError || !confirmed || !rollbackCopied;

  async function copyRollback() {
    if (!cmds) return;
    await copyText(cmds.rollback);
    setRollbackCopied(true);
    toast.success("Geri alma komutu kopyalandı — güvenli bir yere kaydedin.");
  }

  async function copyForward() {
    if (!cmds) return;
    await copyText(cmds.forward);
    toast.success("Takas komutu kopyalandı. Sunucuda yönetici PowerShell'de çalıştırın.");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Kopyaya geçiş (takas)</DialogTitle>
          <DialogDescription>
            <code className="font-mono text-xs">{copyName}</code> devreye alınır,{" "}
            <code className="font-mono text-xs">{liveDatabase}</code> kenara çekilir.
            İki yeniden adlandırma; <code>DATABASE_URL</code> değişmez.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {query.isLoading && (
            <p className="py-6 text-center text-sm text-muted-foreground">Komut hazırlanıyor…</p>
          )}

          {query.isError && (
            <PreviewErrorBlock
              message="Takas komutu üretilemedi. Kopya 'hazır' durumda olmayabilir — yalnız doğrulanmış kopyaya geçiş yapılabilir."
              onRetry={() => void query.refetch()}
              isRetrying={query.isFetching}
            />
          )}

          {cmds && (
            <>
              <Callout tone="info" title="Kesinti yalnız birkaç saniye">
                Blok backend'i durdurur, iki <code>ALTER DATABASE … RENAME</code> yapar,
                {cmds.needsMigrateDeploy && (
                  <>
                    {" "}
                    <b>şemayı günceller</b> (yedek koddan eski),
                  </>
                )}{" "}
                sonra backend'i başlatır. İkinci yeniden adlandırma başarısız olursa blok{" "}
                <b>kendiliğinden geri alır</b>.
              </Callout>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    1) Önce geri alma komutunu kaydedin
                  </h4>
                  <Button variant="outline" size="sm" onClick={() => void copyRollback()}>
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    {rollbackCopied ? "Tekrar kopyala" : "Geri alma komutunu kopyala"}
                  </Button>
                </div>
                <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-[11px]">
                  {cmds.rollback}
                </pre>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  2) Takas komutu
                </h4>
                <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-[11px]">
                  {cmds.forward}
                </pre>
              </div>

              {!rollbackCopied && (
                <Callout tone="warning">
                  Takas komutunu kopyalayabilmek için önce <b>geri alma komutunu</b> alın.
                </Callout>
              )}

              <TypeToConfirm
                expected={liveDatabase}
                value={typed}
                onChange={setTyped}
                label={
                  <>
                    Devam etmek için canlı veritabanı adını yazın:{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">{liveDatabase}</code>
                  </>
                }
              />
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={forwardDisabled} onClick={() => void copyForward()}>
            <ClipboardCopy className="mr-1.5 h-4 w-4" />
            Takas komutunu kopyala
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
