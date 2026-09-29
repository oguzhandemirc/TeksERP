import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PreviewErrorBlock } from "@/components/forms/PreviewErrorBlock";
import { matchesConfirmation } from "@/components/forms/TypeToConfirm";
import { copyText } from "@/lib/clipboard";
import { Callout } from "@/components/ui/callout";
import {
  BACKUP_PASSWORD_CODES,
  backupPasswordErrorCode,
  backupPasswordMessage,
} from "@/lib/backup-password";
import { BackupPasswordPrompt } from "./BackupPasswordPrompt";
import { restoreCommand, type BackupListing } from "./service";
import { useRestoreImpact } from "./hooks";
import { RestoreImpactSummary } from "./RestoreImpactSummary";
import { RestoreImpactCounts } from "./RestoreImpactCounts";
import { RestoreAuditDelta } from "./RestoreAuditDelta";
import { RestoreSafetyNotice } from "./RestoreSafetyNotice";
import { RestoreConfirmGate } from "./RestoreConfirmGate";

/**
 * Geri yükleme onay dialogu.
 *
 * Geri yükleme BACKEND'DE ÇALIŞMAZ — bu dialog yalnız (a) ne kaybedileceğini
 * gösterir, (b) yazarak onay alır, (c) sunucuda çalıştırılacak komut bloğunu
 * panoya kopyalar. Panel açısından dönüşü olmayan nokta komutun panoya çıkmasıdır,
 * bu yüzden kapı KOPYALAMAYI kilitler.
 *
 * İskelet WorkOrderCompleteDialog'dan: sabit header/footer + tek kaydırılan gövde.
 */
export function RestoreDialog({
  name,
  listing,
  onClose,
}: {
  /** Seçili yedek dosyası; `null` → dialog kapalı. */
  name: string | null;
  listing: BackupListing | undefined;
  onClose: () => void;
}) {
  const open = name !== null;
  // Şifreli yedek: parola ref'te bir istek boyunca yaşar, sorgu okuyunca siler.
  const passwordRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const query = useRestoreImpact(open ? name : null, { ref: passwordRef, attempt });
  const impact = query.data;
  const [typed, setTyped] = useState("");
  const pwCode = query.isError ? backupPasswordErrorCode(query.error) : null;
  const asksPassword =
    pwCode === BACKUP_PASSWORD_CODES.REQUIRED || pwCode === BACKUP_PASSWORD_CODES.INVALID;

  // Her açılışta / dosya değişiminde onay metnini SIFIRLA — aksi halde önceki
  // onay farklı bir hedef için geçerli sayılır.
  useEffect(() => {
    if (open) setTyped("");
    passwordRef.current = null;
  }, [open, name]);

  const db = impact?.restoreTarget?.database ?? "";
  const confirmed = matchesConfirmation(typed, db);
  const copyDisabled =
    !impact || query.isLoading || query.isError || !impact.canRestore || !confirmed;

  async function handleCopy() {
    if (!name) return;
    const cmd = restoreCommand(listing, name, impact);
    if (!cmd) {
      toast.error("Geri yükleme komutu üretilemedi — etki önizlemesi eksik.");
      return;
    }
    await copyText(cmd);
    toast.success(
      impact?.encryption?.fileEncrypted
        ? "Komut bloğu kopyalandı. Sunucuda yönetici PowerShell'de çalıştırın; şifre satırını doldurun — yedek parolası o pencerede ayrıca sorulur."
        : "Komut bloğu kopyalandı. Sunucuda yönetici PowerShell'de çalıştırın; şifre satırını doldurmayı unutmayın.",
    );
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Yedeğe geri dön</DialogTitle>
          <DialogDescription>
            Geri yükleme sunucuda, backend durdurulmuş hâlde yapılır. Bu ekran ne
            kaybedeceğinizi gösterir ve çalıştırılacak komutu hazırlar.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {query.isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Etki hesaplanıyor…
            </p>
          )}

          {asksPassword && (
            <BackupPasswordPrompt
              invalid={pwCode === BACKUP_PASSWORD_CODES.INVALID}
              pending={query.isFetching}
              onSubmit={(pw) => {
                passwordRef.current = pw;
                setAttempt((n) => n + 1);
              }}
            />
          )}

          {query.isError && pwCode === BACKUP_PASSWORD_CODES.LOCKED && (
            <Callout tone="danger">
              {backupPasswordMessage(query.error, "Çok fazla hatalı yedek parolası denemesi.")}
            </Callout>
          )}

          {query.isError && !pwCode && (
            <PreviewErrorBlock
              message="Bu yedeğe dönüldüğünde ne kaybedileceği hesaplanamadı — önizleme görülmeden geri yükleme komutu üretilmez."
              onRetry={() => void query.refetch()}
              isRetrying={query.isFetching}
            />
          )}

          {impact && !query.isError && (
            <>
              {impact.encryption?.fileEncrypted && impact.encryption.unlocked && (
                <Callout tone="info">
                  Şifreli yedek — yedek parolasıyla açıldı ve içeriği doğrulandı. Komut bloğu yedeği
                  önce geçici bir kopyaya çözer; parola sunucu penceresinde ayrıca sorulur ve
                  panoya yazılmaz.
                </Callout>
              )}
              <RestoreImpactSummary impact={impact} />
              <RestoreImpactCounts impact={impact} />
              <RestoreAuditDelta audit={impact.audit} />
              <RestoreSafetyNotice
                impact={impact}
                lastBackupDurationMs={listing?.lastResult?.durationMs ?? null}
              />
              <RestoreConfirmGate impact={impact} typed={typed} onTypedChange={setTyped} />
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={copyDisabled} onClick={() => void handleCopy()}>
            <ClipboardCopy className="mr-1.5 h-4 w-4" />
            Geri yükleme komutunu kopyala
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
