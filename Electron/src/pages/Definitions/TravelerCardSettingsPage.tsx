import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import type { TravelerCardConfig } from "@/services/featureFlagService";
import { TravelerCardConfigSection } from "@/pages/GeneralSettings/TravelerCardConfigSection";
import { TravelerCardPreview } from "./DocumentTemplates/TravelerCardPreview";
import { travelerTemplateService } from "./TravelerCardStudio/service";

/**
 * Refakat Kartı ayarı — Tanımlar → Sistem (baskı standartları bir arada).
 * Solda içerik ayarı, sağda gerçek kartın örnek veriyle canlı PDF önizlemesi.
 * İçerik ayarı kart basımında snapshot'a dondurulur; değişiklik yalnız bundan
 * sonra basılan kartlara işler.
 */
export function TravelerCardSettingsPage() {
  const [draft, setDraft] = useState<TravelerCardConfig | null>(null);
  const onPreview = useCallback((cfg: TravelerCardConfig) => setDraft(cfg), []);
  const templatesQ = useQuery({
    queryKey: ["traveler-templates"],
    queryFn: travelerTemplateService.list,
    staleTime: 60_000,
  });
  const activeTemplate = (templatesQ.data ?? []).find((t) => t.isDefault) ?? null;

  return (
    <PageShell>
      <PageHeader
        title="Refakat Kartı"
        actions={
          <RefreshButton queryKey={FEATURE_FLAGS_QUERY_KEY} successMessage="Ayarlar yenilendi" />
        }
      />
      <PageBody className="p-4">
        {/* Varsayılan bir ŞABLON varsa bu ekrandaki ayarlar kullanılmaz (şablon
            kendi config'ini taşır — `resolveForPrint`). Bunu söylememek, kullanıcının
            burada ayar değiştirip "kartta neden değişmedi?" demesine yol açar. */}
        {activeTemplate && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <div>
              Şu anda <strong>{activeTemplate.name}</strong> şablonu varsayılan — kart o
              şablonla basılıyor ve <strong>bu ekrandaki ayarlar kullanılmıyor</strong>.
              Düzenlemek için{" "}
              <Link to="/definitions/traveler-card-studio" className="font-medium underline">
                Refakat Kartı Şablonları
              </Link>
              ; ya da oradan varsayılanı kaldırıp yerleşik karta dönebilirsiniz.
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
          <div className="rounded-md border bg-card p-4">
            <TravelerCardConfigSection onPreview={onPreview} />
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            {draft && <TravelerCardPreview config={draft} />}
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}
