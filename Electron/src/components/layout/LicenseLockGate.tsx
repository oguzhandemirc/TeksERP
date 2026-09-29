import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataExportPanel } from "@/components/license/DataExportPanel";
import { useLicenseStatus, LICENSE_STATUS_KEY } from "@/hooks/useLicenseStatus";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAuthStore } from "@/store/auth";
import { licenseLockKind } from "@/lib/license/visibility";
import { canRelay, relayViaPanel } from "@/lib/license/relay";
import { licenseService } from "@/services/licenseService";
import { apiErrorText } from "@/lib/api-error";

/**
 * LİSANS KİLİT EKRANI — `App.tsx` `Root`ta `UpdateGate`in kardeşi, yalnız oturumda.
 *
 * Karar backend'in UYGULADIĞI kademedir (`GET /durum`.kademe); gözlemde kademe
 * daima NORMAL döner ve bu ekran HİÇ çizilmez (sıfır fark).
 *  · KISITLI  → okumalar serbest, yazmalar kapalı: bilgilendiren kapı, "salt
 *    okunur devam et" ile kapanır (kademe değişince yeniden açılır).
 *  · DURDURULMUS → kapanmaz: yalnız lisansı yenileme + "verilerimi al" + çıkış.
 * Güncelleme kapısı (`z-[100]`) bunun üstünde kalır: kilitli kurulum da güncellenir.
 */
export function LicenseLockGate() {
  const status = useLicenseStatus();
  const kind = licenseLockKind(status);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  useEffect(() => {
    if (kind === null) setDismissedFor(null);
  }, [kind]);
  if (!kind || (kind === "restricted" && dismissedFor === kind)) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="lisans-kilit-basligi"
      data-testid={`lisans-kilidi-${kind}`}
      className="app-no-drag fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/15">
            {kind === "suspended" ? <Lock className="h-5 w-5 text-destructive" /> : <ShieldAlert className="h-5 w-5 text-destructive" />}
          </span>
          <div className="min-w-0">
            <h2 id="lisans-kilit-basligi" className="text-base font-semibold leading-tight">
              {kind === "suspended" ? "Program durduruldu" : "Program kısıtlı kipte"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {status?.lisansNo ? `Lisans ${status.lisansNo}` : "Lisans"}
              {status?.lisansSahibi ? ` · ${status.lisansSahibi.musteri}` : ""}
            </p>
          </div>
        </div>
        <p className="text-sm">
          {status?.bant?.metin ??
            (kind === "suspended"
              ? "Bu kurulumun lisansı durduruldu. Verilerinize erişiminiz açıktır; yedek alabilir ve dışa aktarabilirsiniz."
              : "Bu kurulum kısıtlı kipte: kayıtlar okunabilir, yeni kayıt ve değişiklik yapılamaz.")}
        </p>
        <LockActions />
        {kind === "suspended" && <DataExportPanel />}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={() => void useAuthStore.getState().logout()}>
            <LogOut className="mr-1.5 h-4 w-4" /> Çıkış yap
          </Button>
          {kind === "restricted" && <Button onClick={() => setDismissedFor(kind)}>Salt okunur devam et</Button>}
        </div>
      </div>
    </div>
  );
}

/** Satıcı yaptırımı kaldırdıysa kilidin hemen açılması için: şimdi yokla / panelden aktar. */
function LockActions() {
  const { hasPermission } = useRoleAccess();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!hasPermission("license:manage")) return null;
  const refresh = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.info(await fn());
      await qc.invalidateQueries({ queryKey: LICENSE_STATUS_KEY });
    } catch (err) {
      toast.error(apiErrorText(err, "Lisans yenilenemedi."));
    } finally {
      setBusy(false);
    }
  };
  const poll = () =>
    refresh(async () => {
      const r = await licenseService.pollNow();
      return r.outcome === "BASARILI" ? "Lisans yenilendi." : `Yoklama sonucu: ${r.code ?? r.outcome}`;
    });
  const relay = () =>
    refresh(async () => {
      const r = await relayViaPanel("yokla");
      return r.ok ? "Lisans bu bilgisayar üzerinden yenilendi." : r.message;
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void poll()}>
        <RefreshCw className={`mr-1.5 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Lisansı şimdi yokla
      </Button>
      {canRelay() && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void relay()}>
          Bu bilgisayar üzerinden yenile
        </Button>
      )}
    </div>
  );
}
