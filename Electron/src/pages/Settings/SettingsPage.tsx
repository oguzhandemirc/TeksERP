import { useState } from "react";
import { Bell, BriefcaseBusiness, Palette, UserRound, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppearanceSettings } from "@/components/layout/appearance/AppearanceSettings";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION } from "@/pages/GeneralSettings/settings-config";
import { MasaustuBildirimKarti } from "@/components/bildirim/MasaustuBildirimKarti";
import { BildirimTercihKarti } from "@/components/bildirim/BildirimTercihKarti";
import { WebTotpPreferenceCard } from "./WebTotpPreferenceCard";
import { TrustedDevicesCard } from "@/components/auth/TrustedDevicesCard";
import { authService } from "@/services/authService";
import { WorkPreferencesCard } from "./WorkPreferencesCard";
import { FavoritesCard, ResetPreferencesCard, WorkstationCard } from "./SettingsAccountCards";

type Section = "gorunum" | "calisma" | "bildirim" | "hesap";
const SECTIONS: { value: Section; label: string; icon: LucideIcon }[] = [
  { value: "gorunum", label: "Görünüm", icon: Palette },
  { value: "calisma", label: "Çalışma", icon: BriefcaseBusiness },
  { value: "bildirim", label: "Bildirimler", icon: Bell },
  { value: "hesap", label: "Hesap", icon: UserRound },
];

/**
 * Kişisel tercihler — yalnız bu kullanıcıyı etkiler (sistem geneli ayarlar Sistem ekranlarında).
 * Görünüm sekmesi YALNIZ görünümü taşır; iş tercihleri "Çalışma"da (kullanıcı 2026-11-12).
 */
export function SettingsPage() {
  const { hasAnyPermission } = useRoleAccess();
  const [section, setSection] = useState<Section>("gorunum");
  // "Bu Bilgisayar" donanım ekranına `settings:workstation` taşıyan personelin tek kapısı (izin + yol birlikte).
  const canOpenWorkstation = hasAnyPermission([SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION]);

  return (
    <PageShell>
      <PageHeader title="Kullanıcı Tercihleri" />

      <PageBody className="p-6">
        <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
          <TabsList className="h-10">
            {SECTIONS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-2 px-4 py-1.5">
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="gorunum" className="mt-5">
            <Card id="gorunum">
              <CardContent className="pt-6">
                <AppearanceSettings />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calisma" className="mt-5 grid gap-6 lg:grid-cols-2">
            <WorkPreferencesCard />
            {canOpenWorkstation && <WorkstationCard />}
          </TabsContent>

          <TabsContent value="bildirim" className="mt-5 grid gap-6 lg:grid-cols-2">
            <MasaustuBildirimKarti />
            {/* kişisel bildirim tercihleri (N4-PANEL) — eski sunucuda/bayrak kapalıyken kart çizilmez */}
            <BildirimTercihKarti />
          </TabsContent>

          <TabsContent value="hesap" className="mt-5 grid gap-6 lg:grid-cols-2">
            {/* İnternetten giriş: politika USER_CHOICE iken kendi hesabında web 2FA tercihi. */}
            <WebTotpPreferenceCard />
            <TrustedDevicesCard
              scopeKey="self"
              load={authService.listTrustedDevices}
              revoke={authService.revokeTrustedDevice}
              revokeAll={authService.revokeAllTrustedDevices}
            />
            <FavoritesCard />
            <ResetPreferencesCard />
          </TabsContent>
        </Tabs>
      </PageBody>
    </PageShell>
  );
}
