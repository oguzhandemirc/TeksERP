import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { approvalPrompt, useApprovalPromptStore, type ApprovalPromptInfo } from "./approvalPrompt";
import { useApprovalSubmit } from "./approvalSubmit";
import { useServerUpdateStatus } from "./hooks";
import { actionText } from "./UpdateApprovalCard";

function PromptBody({ info }: { info: ApprovalPromptInfo }) {
  const dismiss = useApprovalPromptStore((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  const t = actionText("HEMEN", info.surum, "ONAYLI", null);
  const submit = useApprovalSubmit("HEMEN", info.surum, t.done, () => dismiss(info.surum));
  const go = async () => {
    setBusy(true);
    try {
      await submit();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && dismiss(info.surum)}>
      <DialogContent data-testid="guncelleme-onay-istemi">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Sunucu güncellemesi hazır
            {info.zorunlu && <Badge variant="destructive">Kritik güncelleme</Badge>}
          </DialogTitle>
          <DialogDescription>{`Kurulu sürüm ${info.kuruluSurum} · yeni sürüm ${info.surum}`}</DialogDescription>
        </DialogHeader>
        {info.ozet && (
          <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Sürüm notu</p>
            <p className="whitespace-pre-line text-sm">{info.ozet}</p>
          </div>
        )}
        {info.pgGuncellemesi && <p className="text-sm text-muted-foreground">Önce PostgreSQL küçük sürüm güncellemesi yapılacak.</p>}
        <p className="text-sm text-muted-foreground">{t.description}</p>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => dismiss(info.surum)}>
            Sonra
          </Button>
          <Button disabled={busy} onClick={() => void go()}>
            Şimdi güncelle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Backend güncellemesi ONAY İSTEMİ (K11) — yalnız `license:manage`; bekleyen sürüm + sürüm notu + "Şimdi güncelle / Sonra".
 * Eski backend (uç yok) ya da hata → durum okunamaz → istem açılmaz (sessiz). Onay ucu ve kapı güncelleyici sözleşmesindedir
 * (`POST /api/guncelleme/onay`); "Sonra" yalnız bu oturumda susturur, hiçbir şey yazmaz.
 */
export function UpdateApprovalPrompt() {
  const { hasPermission } = useRoleAccess();
  const canManage = hasPermission("license:manage");
  const q = useServerUpdateStatus(canManage);
  const dismissed = useApprovalPromptStore((s) => s.dismissed);
  const info = canManage ? approvalPrompt(q.data) : null;
  if (!info || dismissed.includes(info.surum)) return null;
  return <PromptBody info={info} />;
}
