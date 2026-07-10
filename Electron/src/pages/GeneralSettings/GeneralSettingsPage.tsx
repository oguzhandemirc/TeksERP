import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FeatureFlagSection } from "./FeatureFlagSection";
import { DevicePairingSection } from "./DevicePairingSection";
import { ApiEndpointSection } from "./ApiEndpointSection";
import { CompanySettingsSection } from "./CompanySettingsSection";
import { SessionSettingsSection } from "./SessionSettingsSection";
import { LabelSettingsSection } from "./LabelSettingsSection";
import { SackCodeTemplateSetting } from "./SackCodeTemplateSetting";
import { ScannerSettingsSection } from "./ScannerSettingsSection";
import { DeadlineDefaultsSection } from "./DeadlineDefaultsSection";
import { ScaleDeviceSettings } from "./ScaleDeviceSettings";
import { LabelPrinterDeviceSettings } from "./LabelPrinterDeviceSettings";

/**
 * Genel Ayarlar — sol dikey kategori menüsü + sağ içerik. Ayarlar domaine bölünür
 * (kategoriler `settings-config.ts`'te tanımlı). Özellik anahtarları config'ten
 * otomatik render edilir; cihaz eşleştirme ve sunucu adresi özel section'lardır.
 */
export function GeneralSettingsPage() {
  // Aktif kategori URL'den (?tab=) gelir → komut paleti / derin bağlantı doğru sekmeyi açar.
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = SETTINGS_CATEGORIES[0]?.id;
  const param = searchParams.get("tab");
  const active = SETTINGS_CATEGORIES.some((c) => c.id === param) ? param! : fallback;

  const handleTabChange = (next: string) => {
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Genel Ayarlar"
        description="Modüle göre ayrılmış özellik anahtarları, cihaz ve sistem ayarları."
        actions={
          <RefreshButton queryKey={FEATURE_FLAGS_QUERY_KEY} successMessage="Ayarlar yenilendi" />
        }
      />

      <Tabs
        value={active}
        onValueChange={handleTabChange}
        orientation="vertical"
        className="flex min-h-0 flex-1"
      >
        <TabsList className="h-full w-56 shrink-0 flex-col items-stretch justify-start gap-1 overflow-auto rounded-none border-r bg-muted/30 p-3">
          {SETTINGS_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <TabsTrigger
                key={cat.id}
                value={cat.id}
                className="w-full justify-start gap-2.5 rounded-md px-3 py-2 text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{cat.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="min-w-0 flex-1 overflow-auto p-6">
          {SETTINGS_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <TabsContent key={cat.id} value={cat.id} className="mt-0 max-w-3xl">
                <Card>
                  <CardHeader className="border-b p-5">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">{cat.label}</CardTitle>
                    </div>
                    <CardDescription className="text-xs">{cat.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-5">
                    {cat.kind === "flags" && cat.flags && (
                      <>
                        <FeatureFlagSection flags={cat.flags} />
                        {/* Sevkiyat kategorisinin toggle-olmayan tek ayarı: çuval kodu şablonu. */}
                        {cat.id === "shipping" && (
                          <div className="mt-4 border-t pt-4">
                            <SackCodeTemplateSetting />
                          </div>
                        )}
                      </>
                    )}
                    {cat.kind === "device" && <DevicePairingSection />}
                    {cat.kind === "workstation" && (
                      // Bu bilgisayara özel yerel ayarlar bir arada: yazıcı + kantar + sunucu.
                      <div className="space-y-6">
                        <div>
                          <p className="mb-2 text-sm font-medium">
                            Etiket yazıcısı (bu bilgisayar)
                          </p>
                          <LabelPrinterDeviceSettings />
                        </div>
                        <ScaleDeviceSettings />
                        <div className="border-t pt-4">
                          <p className="mb-2 text-sm font-medium">Sunucu Adresi</p>
                          <ApiEndpointSection />
                        </div>
                      </div>
                    )}
                    {cat.kind === "company" && <CompanySettingsSection />}
                    {cat.kind === "session" && <SessionSettingsSection />}
                    {cat.kind === "label" && <LabelSettingsSection />}
                    {cat.kind === "scanner" && <ScannerSettingsSection />}
                    {cat.kind === "deadline" && <DeadlineDefaultsSection />}
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </div>
      </Tabs>
    </div>
  );
}
