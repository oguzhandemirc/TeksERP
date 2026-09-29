import { Navigate } from "react-router-dom";
import { Lock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PencereKontrolleri } from "@/components/layout/PencereKontrolleri";
import { DataExportPanel } from "@/components/license/DataExportPanel";
import { LicenseLockActions } from "@/components/license/LicenseLockActions";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { useAuthStore } from "@/store/auth";

/**
 * K5 — LİSANS DURDURULDU: oturum açan yalnız bu sayfayı görür (uygulama kabuğu
 * bağlanmaz). Açık olan tek şey lisansı yenilemek, "verilerimi al" (yedek +
 * dışa aktarma, yönetici) ve çıkış. Çağırdığı her uç backend'in DURDURULMUŞ
 * izin listesindedir (`constants/license-routes.ts`); bekçi `test_lisans_kapisi`
 * bu dosyadan başlayıp çağrıları statik çıkarır.
 * Durum sorgusu kademe düşünce sinyali kapatır; kabuk kendiliğinden geri gelir.
 */
export function LicenseSuspendedPage() {
  const user = useAuthStore((s) => s.user);
  const status = useLicenseStatus();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="flex h-screen w-screen flex-col overflow-y-auto bg-background" data-testid="lisans-k5-sayfasi">
      <div className="flex justify-end p-3">
        <PencereKontrolleri />
      </div>
      <main className="mx-auto w-full max-w-2xl space-y-4 px-6 pb-10">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-destructive/15">
            <Lock className="h-5 w-5 text-destructive" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Program durduruldu</h1>
            <p className="text-xs text-muted-foreground">
              {status?.lisansNo ? `Lisans ${status.lisansNo}` : "Lisans"}
              {status?.lisansSahibi ? ` · ${status.lisansSahibi.musteri}` : ""}
            </p>
          </div>
        </div>
        <p className="text-sm">
          {status?.bant?.metin ??
            "Bu kurulumun lisansı durduruldu. Verilerinize erişiminiz açıktır; yedek alabilir ve dışa aktarabilirsiniz."}
        </p>
        <LicenseLockActions />
        <section className="rounded-xl border bg-card p-4">
          <DataExportPanel />
        </section>
        <div className="flex justify-end border-t pt-3">
          <Button variant="ghost" onClick={() => void useAuthStore.getState().logout()}>
            <LogOut className="mr-1.5 h-4 w-4" /> Çıkış yap
          </Button>
        </div>
      </main>
    </div>
  );
}
