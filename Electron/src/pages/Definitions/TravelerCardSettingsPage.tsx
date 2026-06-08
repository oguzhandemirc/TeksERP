import { useCallback, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import type { TravelerCardConfig } from "@/services/featureFlagService";
import { TravelerCardConfigSection } from "@/pages/GeneralSettings/TravelerCardConfigSection";
import { TravelerCardPreview } from "./DocumentTemplates/TravelerCardPreview";

/**
 * Refakat Kartı ayarı — Tanımlar → Sistem (baskı standartları bir arada).
 * Solda içerik ayarı, sağda gerçek kartın örnek veriyle canlı PDF önizlemesi.
 * İçerik ayarı kart basımında snapshot'a dondurulur; değişiklik yalnız bundan
 * sonra basılan kartlara işler.
 */
export function TravelerCardSettingsPage() {
  const [draft, setDraft] = useState<TravelerCardConfig | null>(null);
  const onPreview = useCallback((cfg: TravelerCardConfig) => setDraft(cfg), []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Refakat Kartı"
        description="Refakat kartında basılan firma adı/künyesi ve hangi bölümlerin görüneceği. Değişiklik yalnız bundan sonra basılan kartlara işler — mevcut kartlar basım anında dondurulmuştur."
        actions={
          <RefreshButton queryKey={FEATURE_FLAGS_QUERY_KEY} successMessage="Ayarlar yenilendi" />
        }
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
          <div className="rounded-md border bg-card p-4">
            <TravelerCardConfigSection onPreview={onPreview} />
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            {draft && <TravelerCardPreview config={draft} />}
          </div>
        </div>
      </div>
    </div>
  );
}
