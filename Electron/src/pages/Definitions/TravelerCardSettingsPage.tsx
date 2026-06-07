import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import { TravelerCardConfigSection } from "@/pages/GeneralSettings/TravelerCardConfigSection";

/**
 * Refakat Kartı ayarı — Tanımlar → Sistem (baskı standartları bir arada).
 * İçerik ayarı kart basımında snapshot'a dondurulur; değişiklik yalnız bundan
 * sonra basılan kartlara işler.
 */
export function TravelerCardSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Refakat Kartı"
        description="Refakat kartında basılan firma adı/künyesi ve hangi bölümlerin görüneceği. Değişiklik yalnız bundan sonra basılan kartlara işler — mevcut kartlar basım anında dondurulmuştur."
        actions={
          <RefreshButton queryKey={FEATURE_FLAGS_QUERY_KEY} successMessage="Ayarlar yenilendi" />
        }
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl rounded-md border bg-card p-5">
          <TravelerCardConfigSection />
        </div>
      </div>
    </div>
  );
}
