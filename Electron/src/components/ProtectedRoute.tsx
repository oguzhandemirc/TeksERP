import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { canEnterApp } from "@/types/auth";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { reportKeyOfPath } from "@/lib/report-gate";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";

interface Props {
  children: React.ReactNode;
  requirePermission?: string;
  /** Bunlardan HERHANGİ biri yeterli (örn. muhasebe = shipping:read VEYA report:sales). */
  requireAnyPermission?: string[];
  /**
   * SATICI (süperadmin) kimliği şart mı? — izin DEĞİL KİMLİK kapısı.
   *
   * ⚠️ SUPAP TAŞIR (2026-09-04): modül anahtarlarının İKİNCİ yazma yolu
   * (Genel Ayarlar → Modüller sekmesi) kaldırıldığı için supapsız bir kapı
   * artık KİLİTLENME üretir — süperadmin hesabı doğmamış kurulum modülleri bir
   * daha açamaz. Yüklem tek kaynaktan: `lib/superadmin-gate.ts`.
   */
  requireSystemAccount?: boolean;
}

export function ProtectedRoute({
  children,
  requirePermission,
  requireAnyPermission,
  requireSystemAccount,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const location = useLocation();
  // Modül bağlamı: ETKİN değer + varsayılan yön TEK yerde (karo ve paletle aynı).
  const moduleCtx = useOperationsVisibilityContext();

  if (!isHydrated) return null;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!canEnterApp(user.permissions)) {
    return <Navigate to="/forbidden" replace />;
  }

  if (requirePermission && !hasPermission(requirePermission)) {
    return <Navigate to="/forbidden" replace />;
  }

  if (requireAnyPermission && requireAnyPermission.length > 0 && !hasAnyPermission(requireAnyPermission)) {
    return <Navigate to="/forbidden" replace />;
  }

  // MODÜL KAPISI (2026-09-14) — izinden SONRA: bayrak KAPALI + izin VAR + adres
  // çubuğundan URL → `/forbidden` (ayrı "modül kapalı" sayfası YOK; ekransız
  // yeni yüzey açılmaz). Karo ve palet zaten gizli; bu kapı üçüncü yolu (elle
  // yazılan URL) kapatır. Yol → modül aynası `lib/route-modules.ts`
  // (`SCREEN_CATALOG.modul`, bekçi `test_screen_catalog §4b`); modülsüz yol
  // (çekirdek · planlanan · hub) dokunulmaz.
  //
  // ⚠️ BAYRAK YÜKLENENE DEK BEKLE (2026-09-17, kullanıcı bulgusu): yüklenmemiş bayrak
  // "kapalı" değil "bilinmiyor"dur. Eskiden `?? false` ile kapalı okunup `replace` ile
  // /forbidden'a yönlendiriliyordu — Mal Kabul / Alış Siparişleri yenilemede (HMR · Cmd+R ·
  // ilk giriş) ara sıra "Erişim engellendi" veriyor, menüden dönünce düzeliyordu (üretim
  // yolları `?? true` olduğu için onlarda görülmüyordu). İzin kapıları JWT'den okur, beklemez.
  if (!moduleCtx.flagsReady) return null;
  // Sorgu HATA verdiyse bayraklar bilinmiyor: yönlendirme YOK, route çizilir — gerçek kapı
  // backend'dir (403 MODULE_DISABLED / REPORT_DISABLED); kapalı modülün ekranı boş/403 toast'ıyla
  // kalır, bu "bilinmiyor"u "kapalı" diye okuyup yetkili kullanıcıyı dışarı atmaktan iyidir.
  if (!moduleCtx.flagsFailed) {
    if (!isRouteModuleOpen(location.pathname, moduleCtx)) {
      return <Navigate to="/forbidden" replace />;
    }
    // Rapor kapısı (Raporlar K5): modül kapısından SONRA, izin kapısından SONRA — süperadminin
    // kapattığı rapor izni olan kullanıcıya da çizilmez (backend 403 REPORT_DISABLED ile aynı).
    // Kategori hub'ı (iki segment) rapor değildir; bilinmeyen anahtar KAPALIDIR.
    const reportKey = reportKeyOfPath(location.pathname);
    if (reportKey !== null && !moduleCtx.isReportOpen(reportKey)) {
      return <Navigate to="/forbidden" replace />;
    }
  }

  // Kimlik kapısı izinlerden SONRA: yetkisiz kullanıcı zaten yukarıda elendi,
  // buraya gelen `admin:settings` sahibi fabrika yöneticisidir ve satıcı
  // ekranını adres çubuğundan da açamaz — süperadmin hesabı DOĞMUŞSA.
  if (requireSystemAccount && !isSuperadminGateOpen({ isSystemAccount, systemAccountExists })) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
