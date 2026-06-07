import { useCallback, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_COMPANY_LETTERHEAD,
} from "@/services/featureFlagService";
import type { ResolvedDocConfig } from "@/services/documentConfig";
import { DocumentConfigSection } from "@/pages/GeneralSettings/DocumentConfigSection";
import { DocumentPreview } from "./DocumentTemplates/DocumentPreview";

/**
 * Belge Şablonları — Tanımlar → Sistem. Solda içerik ayarı (bölüm aç/kapa, başlık,
 * künye, imza, footer), sağda gerçek belgenin örnek veriyle canlı önizlemesi.
 * Etiket Standartları düzenleme sayfasının (sol kontrol + sağ önizleme) belge eşi.
 */
export function DocumentTemplatesPage() {
  const flags = useFeatureFlags().data?.data;
  const companyName = flags?.companyName ?? DEFAULT_COMPANY_NAME;
  const letterhead = flags?.companyLetterhead ?? DEFAULT_COMPANY_LETTERHEAD;

  const [pv, setPv] = useState<{ docKey: string; cfg: ResolvedDocConfig } | null>(null);
  const onPreview = useCallback((docKey: string, cfg: ResolvedDocConfig) => {
    setPv({ docKey, cfg });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Belge Şablonları"
        description="Yazdırılan irsaliye/çeki listelerinin içeriği — bölüm aç/kapa, başlık, künye, imza ve alt not. Sağdaki önizleme örnek veriyle anlık güncellenir."
        actions={
          <RefreshButton queryKey={FEATURE_FLAGS_QUERY_KEY} successMessage="Ayarlar yenilendi" />
        }
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
          <div className="rounded-md border bg-card p-4">
            <DocumentConfigSection onPreview={onPreview} />
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            {pv && (
              <DocumentPreview
                docKey={pv.docKey}
                preview={{ cfg: pv.cfg, companyName, letterhead }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
