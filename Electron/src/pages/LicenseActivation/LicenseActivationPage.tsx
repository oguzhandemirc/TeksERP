import { Navigate } from "react-router-dom";
import { KeyRound, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { PencereKontrolleri } from "@/components/layout/PencereKontrolleri";
import { DataExportPanel } from "@/components/license/DataExportPanel";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { acceptanceGate } from "@/lib/license/acceptance";
import { useActivationLock } from "@/lib/license/activation-lock";
import { useAuthStore } from "@/store/auth";
import { useLicenseAcceptance, useLicenseDetail } from "@/pages/System/License/hooks";
import { LicenseAcceptanceCard } from "@/pages/System/License/LicenseAcceptanceCard";
import { LicenseActivateCard } from "@/pages/System/License/LicenseActivateCard";
import { LicenseOfflineCard } from "@/pages/System/License/LicenseOfflineCard";
import { LicenseFileUpload } from "@/pages/System/License/LicenseFileUpload";
import { LicenseTransferCard } from "@/pages/System/License/LicenseTransferCard";

/**
 * G2 — ETKİNLEŞTİRME KİLİDİ: hiç etkinleşmemiş (ya da başka kurulumun kopyası olan) sunucuda oturum açan yalnız bu
 * sayfayı görür (uygulama kabuğu bağlanmaz). Birinci yol karekod (telefonla okut → yanıtı tabletten okut ya da
 * yapıştır), sonra internetle kod, sonra portal dosyası (uzatma ya da muafiyet). KOPYA'da "verilerimi al" ve taşıma
 * talebi de açık; bekleyen taşıma talebi etkin saymaz, kartı ve durumu burada görünür. Çağırdığı her uç backend'in kilit izin kümesindedir (`isOpenWhenActivationLocked`).
 * Etkinleşince durum sorgusu sinyali kapatır; kabuk kendiliğinden geri gelir.
 */
export function LicenseActivationPage() {
  const user = useAuthStore((s) => s.user);
  const sinif = useActivationLock((s) => s.sinif);
  useLicenseStatus();
  const { hasPermission } = useRoleAccess();
  const canView = hasPermission("license:view") || hasPermission("license:manage");
  const canManage = hasPermission("license:manage");
  const q = useLicenseDetail(Boolean(user) && canView);
  const acceptance = useLicenseAcceptance(Boolean(user) && canView);
  if (!user) return <Navigate to="/login" replace />;
  const d = q.data;
  const gate = acceptanceGate(acceptance);
  const kopya = sinif === "KOPYA";
  return (
    <div className="flex h-screen w-screen flex-col overflow-y-auto bg-background" data-testid="lisans-etkinlestirme-sayfasi">
      <div className="flex justify-end p-3">
        <PencereKontrolleri />
      </div>
      <main className="mx-auto w-full max-w-3xl space-y-4 px-6 pb-10">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <KeyRound className="h-5 w-5 text-primary" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">{kopya ? "Bu kurulumun lisansı doğrulanamadı" : "Sunucu lisansı etkinleştirilmedi"}</h1>
            <p className="text-xs text-muted-foreground">Program etkinleştirilene kadar yalnız bu ekran açıktır.</p>
          </div>
        </div>
        {kopya && (
          <Callout tone="warning" title="Veritabanı başka bir kurulumdan taşınmış görünüyor">
            Lisansı bu sunucuda etkinleştirin ya da taşıma talebi açın. Verilerinize erişiminiz açıktır: aşağıdan yedek
            alabilir ve dışa aktarabilirsiniz.
          </Callout>
        )}
        {!canManage && (
          <Callout tone="info" title="Yöneticinize başvurun">
            Etkinleştirmeyi lisans yetkisi olan bir yönetici yapar. Etkinleştirildikten sonra yeniden giriş yapmanız yeter.
          </Callout>
        )}
        {canManage && q.isLoading && <Skeleton className="h-40 w-full" />}
        {canManage && q.isError && (
          <Callout tone="warning" title="Lisans bilgisi okunamadı">
            {apiErrorText(q.error, "Sunucu lisans bilgisini döndürmedi.")}
          </Callout>
        )}
        {canManage && d && (
          <div className="space-y-4">
            {d.tasima && (
              <Callout tone="info" title={d.tasima.durum === "ONAYLANDI" ? "Taşıma talebiniz onaylandı" : "Taşıma talebiniz onay bekliyor"}>
                Bu sunucu taşıma kodu girilene kadar yalnız bu ekranı açar; eski sunucu bu sürede çalışmaya devam eder.
                Onaylanınca portaldan iletilen taşıma kodunu aşağıdaki internetle kod alanına girin.
              </Callout>
            )}
            <LicenseAcceptanceCard q={acceptance} canManage={canManage} active={d.kurulum.etkin} />
            <LicenseOfflineCard d={d} gate={gate} />
            <LicenseActivateCard d={d} gate={gate} />
            <section className="space-y-2 rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">Portaldan aldığınız lisans ya da muafiyet dosyası:</p>
              <LicenseFileUpload />
            </section>
            {(kopya || d.tasima) && <LicenseTransferCard d={d} />}
          </div>
        )}
        {kopya && (
          <section className="rounded-xl border bg-card p-4">
            <DataExportPanel />
          </section>
        )}
        <div className="flex justify-end border-t pt-3">
          <Button variant="ghost" onClick={() => void useAuthStore.getState().logout()}>
            <LogOut className="mr-1.5 h-4 w-4" /> Çıkış yap
          </Button>
        </div>
      </main>
    </div>
  );
}
