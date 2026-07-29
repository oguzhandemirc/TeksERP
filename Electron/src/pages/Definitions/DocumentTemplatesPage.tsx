import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_COMPANY_LETTERHEAD,
} from "@/services/featureFlagService";
import { documentProfileService } from "@/services/documentProfileService";
import type { DocumentsConfig, ResolvedDocConfig } from "@/services/documentConfig";
import {
  DocumentConfigSection,
  type DocConfigExternalTarget,
} from "@/pages/GeneralSettings/DocumentConfigSection";
import { DocumentPreview } from "./DocumentTemplates/DocumentPreview";
import { ProfileBar, PROFILES_QUERY_KEY } from "./DocumentTemplates/ProfileBar";

/**
 * Belge Şablonları — Tanımlar → Sistem. Üstte hedef seçimi (Genel Ayarlar |
 * profiller), solda içerik ayarı (bölüm/kolon/stil/damga/blok/dil), sağda gerçek
 * belgenin örnek veriyle canlı önizlemesi. Profil düzenlenirken önizleme genel
 * ayar + profil merge'ini gösterir (freeze anındaki çözüm zinciriyle aynı).
 */
export function DocumentTemplatesPage() {
  const qc = useQueryClient();
  const flags = useFeatureFlags().data?.data;
  const companyName = flags?.companyName ?? DEFAULT_COMPANY_NAME;
  const letterhead = flags?.companyLetterhead ?? DEFAULT_COMPANY_LETTERHEAD;
  const globalConfig = flags?.documentsConfig ?? {};

  const [profileId, setProfileId] = useState<string | null>(null);
  const [pv, setPv] = useState<{ docKey: string; cfg: ResolvedDocConfig } | null>(null);
  const onPreview = useCallback((docKey: string, cfg: ResolvedDocConfig) => {
    setPv({ docKey, cfg });
  }, []);

  // Seçili profilin config'i (düzenleme hedefi).
  const profileQ = useQuery({
    queryKey: [...PROFILES_QUERY_KEY, profileId],
    queryFn: () => documentProfileService.get(profileId!),
    enabled: Boolean(profileId),
  });
  const profile = profileQ.data?.data ?? null;

  const saveMut = useMutation({
    mutationFn: (config: DocumentsConfig) =>
      documentProfileService.update(profileId!, { config }),
    onSuccess: () => {
      toast.success("Profil kaydedildi.");
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
    },
  });

  const external: DocConfigExternalTarget | undefined =
    profileId && profile
      ? {
          value: (profile.config ?? {}) as DocumentsConfig,
          baseline: globalConfig,
          saving: saveMut.isPending,
          onSave: (cfg) => saveMut.mutate(cfg),
          note: `"${profile.name}" profili düzenleniyor — boş bırakılan alanlar genel ayardan gelir.`,
        }
      : undefined;

  return (
    <PageShell>
      <PageHeader
        title="Belge Şablonları"
        actions={
          <RefreshButton queryKey={FEATURE_FLAGS_QUERY_KEY} successMessage="Ayarlar yenilendi" />
        }
      />
      {/* Profiller çubuğu — SABİT chrome; kolonlar kayarken yerinde durur. */}
      <div className="shrink-0 px-4 pt-4">
        <ProfileBar selectedId={profileId} onSelect={setProfileId} />
      </div>
      {/* İçerik ayarı (sol) + canlı önizleme (sağ). lg'de her biri BAĞIMSIZ kayar
          (dış kap overflow-hidden, her kolon kendi overflow-auto'su); dar ekranda
          tek kaydırma bölgesi olarak alt alta yığılır. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4 lg:flex-row lg:overflow-hidden">
        <div className="rounded-md border bg-card p-4 lg:min-h-0 lg:w-[460px] lg:shrink-0 lg:overflow-auto">
          {profileId && !profile ? (
            <div className="text-sm text-muted-foreground">Profil yükleniyor…</div>
          ) : (
            <DocumentConfigSection
              key={profileId ?? "global"}
              onPreview={onPreview}
              external={external}
            />
          )}
        </div>
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
          {pv && (
            <DocumentPreview
              docKey={pv.docKey}
              preview={{ cfg: pv.cfg, companyName, letterhead }}
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
