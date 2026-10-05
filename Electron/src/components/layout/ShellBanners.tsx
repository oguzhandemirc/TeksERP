import { UpdateStrips } from "./UpdateSecurityStrip";
import { LicenseBanner } from "./LicenseBanner";
import { FactoryTimezoneBanner } from "./FactoryTimezoneBanner";
import { FactoryAdminCard } from "./FactoryAdminCard";
import { ServerOfflineBanner } from "./ServerOfflineBanner";
import { UpdateApprovalPrompt } from "@/pages/System/ServerUpdates/UpdateApprovalPrompt";

/** Üst çubuğun altındaki şerit yığını — sıra görünür sıradır. */
export function ShellBanners() {
  return (
    <>
      {/* Kurulum tetiği (`UpdateGate`) burada DEĞİL, `App.tsx` `Root`ta — giriş
          ekranı ve patron kabuğu da kurabilsin. Burada yalnız şeritler (indirme + imza reddi). */}
      <UpdateStrips />
      {/* Lisans bandı backend'in uyguladığı karardır; gözlemde hiç çizilmez. */}
      <LicenseBanner />
      <FactoryTimezoneBanner />
      {/* Destek hesabında, fabrika yöneticisi yokken — uyarır, engellemez. */}
      <FactoryAdminCard />
      <ServerOfflineBanner />
      {/* Backend güncellemesi onay istemi (yalnız license:manage; Sonra = bu oturumda sus). */}
      <UpdateApprovalPrompt />
    </>
  );
}
