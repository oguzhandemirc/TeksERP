import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { visibleSettingsCategories } from "./settings-config";
import { FeatureFlagSection } from "./FeatureFlagSection";
import { DevicePairingSection } from "./DevicePairingSection";
import { CompanySettingsSection } from "./CompanySettingsSection";
import { SessionSettingsSection } from "./SessionSettingsSection";
import { LabelSettingsSection } from "./LabelSettingsSection";
import { WorkstationTabs } from "./WorkstationTabs";
import { SettingsDirtyProvider } from "./settings-dirty";

/**
 * Genel Ayarlar — sol dikey kategori menüsü + sağ içerik. Ayarlar domaine bölünür
 * (kategoriler `settings-config.ts`'te tanımlı). Özellik anahtarları config'ten
 * otomatik render edilir; cihaz eşleştirme ve sunucu adresi özel section'lardır.
 */
export function GeneralSettingsPage() {
  // Kategoriler izne göre süzülür: `settings:workstation` taşıyan (ama
  // `admin:settings` taşımayan) personel YALNIZ "Bu Bilgisayar"ı görür — sistem
  // geneli kategoriler salt-okunur bile olsa listelenmez.
  const { hasAnyPermission } = useRoleAccess();
  const categories = visibleSettingsCategories(hasAnyPermission);

  // Aktif kategori URL'den (?tab=) gelir → komut paleti / derin bağlantı doğru sekmeyi açar.
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = categories[0]?.id;
  const param = searchParams.get("tab");
  // Görünmeyen bir sekmeye derin bağlantı gelirse (izin daraldı / eski favori)
  // sessizce ilk görünür sekmeye düşülür — boş ekran gösterme.
  const active = categories.some((c) => c.id === param) ? param! : fallback;

  // Tek kategori kalıyorsa başlık onun adı olur: "Genel Ayarlar" yazan bir sayfada
  // tek satır görmek, ayarların gizlendiği izlenimi verirdi.
  const soleCategory = categories.length === 1 ? categories[0] : undefined;

  // Aktif sekmede kaydedilmemiş taslak varsa sekme değişiminde uyar (taslak kaybını
  // önle). Aktif bölüm kendi kirliliğini SettingsDirtyProvider üzerinden bildirir.
  const dirtyRef = useRef(false);
  const registerDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  const handleTabChange = (next: string) => {
    if (
      dirtyRef.current &&
      !window.confirm(
        "Bu sekmede kaydedilmemiş değişiklikler var. Kaydetmeden geçmek istiyor musunuz?",
      )
    ) {
      return;
    }
    dirtyRef.current = false;
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true },
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={soleCategory ? soleCategory.label : "Genel Ayarlar"}
        actions={
          <RefreshButton queryKey={FEATURE_FLAGS_QUERY_KEY} successMessage="Ayarlar yenilendi" />
        }
      />

      <SettingsDirtyProvider value={registerDirty}>
      <Tabs
        value={active}
        onValueChange={handleTabChange}
        orientation="vertical"
        className="flex min-h-0 flex-1"
      >
        {/* Tek kategori kalıyorsa sol ray HİÇ çizilmez — tek satırlık bir menü,
            seçilecek başka bir şey varmış izlenimi verir. (Radix'te TabsContent
            listeye bağımlı değil, `value` eşleşmesiyle çalışır.) */}
        {!soleCategory && (
          <TabsList className="h-full w-56 shrink-0 flex-col items-stretch justify-start gap-1 overflow-auto rounded-none border-r bg-muted/30 p-3">
            {categories.map((cat) => {
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
        )}

        <div className="min-w-0 flex-1 overflow-auto p-6">
          {categories.map((cat) => {
            const Icon = cat.icon;
            return (
              <TabsContent key={cat.id} value={cat.id} className="mt-0 max-w-3xl">
                {/* Sade başlık + ayraç — sol ray zaten sekmeyi etiketliyor; kart/çifte
                    çerçeve yok, içerik doğrudan akar. */}
                <div className="mb-5 border-b pb-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold">{cat.label}</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{cat.description}</p>
                </div>

                {/* Termin varsayılanı ilgili flag sekmesine gömülü — TEK Kaydet altında. */}
                {cat.kind === "flags" && cat.flags && (
                  <FeatureFlagSection
                    flags={cat.flags}
                    numberFlags={cat.numberFlags}
                    deadlineField={
                      cat.id === "orders" ? "order" : cat.id === "work-orders" ? "wo" : undefined
                    }
                  />
                )}
                {cat.kind === "device" && <DevicePairingSection />}
                {/* Bu bilgisayara özel donanım — iç içe (segment) sekmeler. */}
                {cat.kind === "workstation" && <WorkstationTabs />}
                {cat.kind === "company" && <CompanySettingsSection />}
                {cat.kind === "session" && <SessionSettingsSection />}
                {cat.kind === "label" && <LabelSettingsSection />}
              </TabsContent>
            );
          })}
        </div>
      </Tabs>
      </SettingsDirtyProvider>
    </PageShell>
  );
}
