import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { visibleSettingsCategories } from "./settings-config";
import {
  emptySettingsHit,
  flattenSettingsGroups,
  groupSettingsCategories,
  resolveActiveSettingsCategory,
  resolveSettingsRegime,
  searchSettings,
  settingsHitCount,
} from "./settings-groups";
import { FeatureFlagSection } from "./FeatureFlagSection";
import { DevicePairingSection } from "./DevicePairingSection";
import { CompanySettingsSection } from "./CompanySettingsSection";
import { SessionSettingsSection } from "./SessionSettingsSection";
import { LabelSettingsSection } from "./LabelSettingsSection";
import { WorkstationTabs } from "./WorkstationTabs";
import { SettingsDirtyProvider } from "./settings-dirty";

/**
 * Genel Ayarlar — sol dikey kategori menüsü (MODÜL BAŞLIKLARI altında toplu) +
 * sağ içerik. Ayarlar domaine bölünür (kategoriler `settings-config.ts`'te,
 * bölümleme/rejim/arama saf katmanda `settings-groups.ts`'te). Özellik
 * anahtarları config'ten otomatik render edilir; cihaz eşleştirme, oturum ve
 * yerel donanım özel section'lardır.
 */
export function GeneralSettingsPage() {
  // Kategoriler önce İZİNLE süzülür: `settings:workstation` taşıyan (ama
  // `admin:settings` taşımayan) personel YALNIZ "Bu Bilgisayar"ı görür — sistem
  // geneli kategoriler salt-okunur bile olsa listelenmez.
  const { hasAnyPermission } = useRoleAccess();
  const permitted = visibleSettingsCategories(hasAnyPermission);

  // ...sonra REJİM ile — ama KATEGORİ bazında, bölüm bazında DEĞİL: fabrikada
  // yalnız "Muhasebe" sekmesi çizilmez, onunla aynı başlığı paylaşan "Depo &
  // Satın Alma" durur (Mal Kabul ekranı rejimden bağımsız çalışıyor, ayarları da
  // ulaşılabilir kalmalı). Rejim anahtarlarının kendisi koşulsuz "Modüller"
  // kategorisinde durur — gizlenen bir kategori onları da götürseydi rejim geri
  // açılamazdı (bkz. settings-config `SettingsRegimeKey` gerekçesi).
  const flagsQ = useFeatureFlags();
  const regime = resolveSettingsRegime(flagsQ.data?.data);
  const groups = useMemo(
    () => groupSettingsCategories(permitted, regime),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permitted.map((c) => c.id).join(","), regime.productionEnabled, regime.financeEnabled],
  );
  const categories = flattenSettingsGroups(groups);

  // Arama — başlık, tek-cümle özet, uzun açıklama ve anahtar kelimelerde arar.
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchSettings(categories, query), [categories, query]);
  const hitByCategory = useMemo(
    () => new Map((hits ?? []).map((h) => [h.categoryId, h])),
    [hits],
  );
  // Arama varken şerit yalnız EŞLEŞEN kategorileri gösterir; eşleşme yoksa
  // liste boş kalır ve içerik alanı bunu söyler (sessiz boş ekran yok).
  const railGroups = hits
    ? groups
        .map((g) => ({ ...g, categories: g.categories.filter((c) => hitByCategory.has(c.id)) }))
        .filter((g) => g.categories.length > 0)
    : groups;

  // Aktif kategori URL'den (?tab=) gelir → komut paleti / derin bağlantı doğru sekmeyi açar.
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get("tab");
  // ⚠️⚠️ ÇÖZÜM `categories` ÜZERİNDEN — `railGroups`/arama listesi üzerinden DEĞİL.
  // Arama SÜZER, GEZİNMEZ: kutuya yazmak aktif sekmeyi değiştirseydi Radix o
  // sekmeyi unmount eder, kaydedilmemiş taslak sessizce çöpe giderdi ve aşağıdaki
  // `handleTabChange` onayı devreye GİRMEZDİ (o yalnız kullanıcı bir sekmeye
  // TIKLAYINCA koşar). Gerekçenin tamamı `settings-groups.resolveActiveSettingsCategory`
  // başlığında. Görünmeyen bir sekmeye derin bağlantı gelirse (izin daraldı /
  // rejim kapandı) sessizce ilk görünür sekmeye düşülür — boş ekran gösterme.
  const active = resolveActiveSettingsCategory(categories, param);

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
          <div className="flex h-full w-60 shrink-0 flex-col border-r bg-muted/30">
            <div className="relative p-3 pb-2">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ayar ara…"
                aria-label="Ayarlarda ara"
                className="h-8 pl-7 pr-7 text-xs"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Aramayı temizle"
                  onClick={() => setQuery("")}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <TabsList className="h-auto min-h-0 w-full flex-1 flex-col items-stretch justify-start gap-1 overflow-auto rounded-none bg-transparent p-3 pt-1">
              {railGroups.map((g) => (
                <div key={g.section.id} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {g.section.label}
                  </p>
                  {g.categories.map((cat) => {
                    const Icon = cat.icon;
                    const hit = hitByCategory.get(cat.id);
                    const count = hit && !hit.wholeCategory ? settingsHitCount(hit) : 0;
                    return (
                      <TabsTrigger
                        key={cat.id}
                        value={cat.id}
                        className="w-full justify-start gap-2.5 rounded-md px-3 py-2 text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{cat.label}</span>
                        {count > 0 && (
                          <span className="ml-auto shrink-0 rounded bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                            {count}
                          </span>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </div>
              ))}
              {railGroups.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground">
                  “{query}” ile eşleşen ayar yok.
                </p>
              )}
            </TabsList>
          </div>
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

                {cat.kind === "flags" && (
                  <FeatureFlagSection
                    flags={cat.flags ?? []}
                    numberFlags={cat.numberFlags}
                    settingFields={cat.settingFields}
                    superadminOnly={cat.superadminOnly}
                    // Arama açıkken isabetsiz kategori BOŞ isabet alır: aksi
                    // halde "eşleşen ayar yok" diyen şeridin yanında dolu bir
                    // liste kalırdı.
                    searchHit={
                      hits ? (hitByCategory.get(cat.id) ?? emptySettingsHit(cat.id)) : undefined
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
