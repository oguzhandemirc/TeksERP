import { useEffect, useState } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LicenseLockActions } from "@/components/license/LicenseLockActions";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { useAuthStore } from "@/store/auth";
import { licenseLockKind } from "@/lib/license/visibility";

/**
 * KISITLI KİP KİLİDİ — `App.tsx` `Root`ta `UpdateGate`in kardeşi, yalnız oturumda.
 *
 * Karar backend'in UYGULADIĞI kademedir (`GET /durum`.kademe); gözlemde kademe
 * daima NORMAL döner ve bu ekran HİÇ çizilmez (sıfır fark). Okumalar serbest,
 * yazmalar kapalı: bilgilendiren kapı "salt okunur devam et" ile kapanır (kademe
 * değişince yeniden açılır). DURDURULMUS burada ÇİZİLMEZ: o kademede kabuk hiç
 * bağlanmaz, oturum `pages/LicenseSuspended` sayfasını açar (`Root` kararı).
 * Güncelleme kapısı (`z-[100]`) bunun üstünde kalır: kilitli kurulum da güncellenir.
 */
export function LicenseLockGate() {
  const status = useLicenseStatus();
  const kind = licenseLockKind(status);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (kind !== "restricted") setDismissed(false);
  }, [kind]);
  if (kind !== "restricted" || dismissed) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="lisans-kilit-basligi"
      data-testid="lisans-kilidi-restricted"
      className="app-no-drag fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/15">
            <ShieldAlert className="h-5 w-5 text-destructive" />
          </span>
          <div className="min-w-0">
            <h2 id="lisans-kilit-basligi" className="text-base font-semibold leading-tight">
              Program kısıtlı kipte
            </h2>
            <p className="text-xs text-muted-foreground">
              {status?.lisansNo ? `Lisans ${status.lisansNo}` : "Lisans"}
              {status?.lisansSahibi ? ` · ${status.lisansSahibi.musteri}` : ""}
            </p>
          </div>
        </div>
        <p className="text-sm">
          {status?.bant?.metin ?? "Bu kurulum kısıtlı kipte: kayıtlar okunabilir, yeni kayıt ve değişiklik yapılamaz."}
        </p>
        <LicenseLockActions />
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={() => void useAuthStore.getState().logout()}>
            <LogOut className="mr-1.5 h-4 w-4" /> Çıkış yap
          </Button>
          <Button onClick={() => setDismissed(true)}>Salt okunur devam et</Button>
        </div>
      </div>
    </div>
  );
}
