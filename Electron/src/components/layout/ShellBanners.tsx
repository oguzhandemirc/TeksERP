import { UpdateStrips } from "./UpdateSecurityStrip";
import { LicenseBanner } from "./LicenseBanner";
import { FactoryTimezoneBanner } from "./FactoryTimezoneBanner";
import { FactoryAdminCard } from "./FactoryAdminCard";
import { DefaultSuperadminBanner } from "./DefaultSuperadminBanner";
import { SystemAccountSealBanner } from "./SystemAccountSealBanner";
import { ServerOfflineBanner } from "./ServerOfflineBanner";
import { ServerOutageStrip } from "./ServerOutageStrip";
import { UpdateProgressWindow } from "@/pages/System/ServerUpdates/UpdateProgressWindow";
import { UpdateApprovalPrompt } from "@/pages/System/ServerUpdates/UpdateApprovalPrompt";
import { LoomAlarmStrip } from "@/pages/Operations/LoomAlarms/LoomAlarmStrip";

/** Üst çubuğun altındaki şerit yığını — sıra görünür sıradır. */
export function ShellBanners() {
  return (
    <>
      {/* Tezgah alarmı — en üstte; bayrak/izin yoksa hiç çizilmez. Ses + OS bildirimi de buradan. */}
      <LoomAlarmStrip />
      {/* Kurulum tetiği (`UpdateGate`) burada DEĞİL, `App.tsx` `Root`ta — giriş
          ekranı ve patron kabuğu da kurabilsin. Burada yalnız şeritler (indirme + imza reddi). */}
      <UpdateStrips />
      {/* Lisans bandı backend'in uyguladığı karardır; gözlemde hiç çizilmez. */}
      <LicenseBanner />
      {/* Satıcı hesabı hâlâ ortak varsayılan parolayla — kırmızı, kapatılamaz. */}
      <DefaultSuperadminBanner />
      {/* Sistem hesabı mühürsüz ya da mührü geçersiz — kırmızı, kapatılamaz. */}
      <SystemAccountSealBanner />
      <FactoryTimezoneBanner />
      {/* Destek hesabında, fabrika yöneticisi yokken — uyarır, engellemez. */}
      <FactoryAdminCard />
      {/* Sunucu güncellemesi: 5 dk önce uyarı, kesintide "yeniden bağlanıyor" (o sırada çevrimdışı şeridi susar). */}
      <ServerOutageStrip />
      <ServerOfflineBanner />
      {/* Backend güncellemesi onay istemi (yalnız license:manage; Sonra = bu oturumda sus). */}
      <UpdateApprovalPrompt />
      {/* Güncelleme sürerken kendiliğinden açılan/kapanan ilerleme penceresi (modal değil). */}
      <UpdateProgressWindow />
    </>
  );
}
