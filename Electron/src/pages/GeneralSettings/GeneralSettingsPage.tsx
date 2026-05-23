import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { PricingFlagCard } from "./PricingFlagCard";

const SETTINGS_QUERY_KEY = "system-settings";

export function GeneralSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Görünüm Ayarları"
        description="Fiyat alanlarının arayüzde gösterilip gizlenmesi."
        actions={<RefreshButton queryKey={SETTINGS_QUERY_KEY} />}
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-5 p-6">
          <PricingFlagCard />
        </div>
      </div>
    </div>
  );
}
