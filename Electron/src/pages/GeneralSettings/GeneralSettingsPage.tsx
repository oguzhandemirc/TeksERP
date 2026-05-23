import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { PricingFlagCard } from "./PricingFlagCard";
import { PlanningDefaultsCard } from "./PlanningDefaultsCard";

const SETTINGS_QUERY_KEY = "system-settings";

export function GeneralSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Genel Ayarlar"
        description="Sistem genelinde geçerli planlama, fiyat ve görünüm seçenekleri."
        actions={<RefreshButton queryKey={SETTINGS_QUERY_KEY} />}
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-5 p-6">
          <PricingFlagCard />
          <PlanningDefaultsCard />
        </div>
      </div>
    </div>
  );
}
