import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  featureFlagService,
  DEFAULT_TRAVELER_CARD_CONFIG,
  type TravelerCardConfig,
} from "@/services/featureFlagService";
import { FlagToggle } from "./SettingRow";

/**
 * Refakat kartı marka/içerik ayarı paneli. Firma adı + hangi bölümlerin
 * basılacağı (toggle). Kaydedince yalnızca BUNDAN SONRA basılan kartlara işler
 * — mevcut kartlar basım anında dondurulduğu için (snapshot) değişmez.
 */
export function TravelerCardConfigSection() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const current = flagsQ.data?.data?.travelerCardConfig ?? DEFAULT_TRAVELER_CARD_CONFIG;

  const [draft, setDraft] = useState<TravelerCardConfig>(current);
  useEffect(() => {
    setDraft(current);
    // Sunucudan gelen değer değişince formu eşitle.
  }, [current.companyName, current.showOperationGrid, current.showNotes, current.showOrders]);

  const mut = useMutation({
    mutationFn: (cfg: TravelerCardConfig) =>
      featureFlagService.update({ travelerCardConfig: cfg }),
    onSuccess: () => {
      toast.success("Refakat kartı ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-40 w-full" />;

  const trimmed = draft.companyName.trim();
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <div className="text-sm text-muted-foreground">
          Bu ayarı değiştirmek için yetkin yok.
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="tc-company" className="text-sm font-medium">
            Firma Adı
          </label>
          <p className="text-xs text-muted-foreground">
            Refakat kartının üst başlığında basılır.
          </p>
          <input
            id="tc-company"
            value={draft.companyName}
            maxLength={120}
            onChange={(e) => setDraft((d) => ({ ...d, companyName: e.target.value }))}
            placeholder={DEFAULT_TRAVELER_CARD_CONFIG.companyName}
            className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="divide-y divide-border rounded-md border px-3">
          <div className="py-3">
            <FlagToggle
              title="Operasyon kaydı (imza grid'i)"
              desc="İstasyon başına operatör/tarih/metraj/fire/imza tablosu — elle doldurulur."
              checked={draft.showOperationGrid}
              disabled={mut.isPending}
              onChange={(v) => setDraft((d) => ({ ...d, showOperationGrid: v }))}
            />
          </div>
          <div className="py-3">
            <FlagToggle
              title="Talimatlar / Boyahane notu"
              desc="İş emrindeki boyahane notu kutusu kartta basılsın mı."
              checked={draft.showNotes}
              disabled={mut.isPending}
              onChange={(v) => setDraft((d) => ({ ...d, showNotes: v }))}
            />
          </div>
          <div className="py-3">
            <FlagToggle
              title="Bağlı siparişler"
              desc="Sipariş no / müşteri / ürün / miktar tablosu kartta basılsın mı."
              checked={draft.showOrders}
              disabled={mut.isPending}
              onChange={(v) => setDraft((d) => ({ ...d, showOrders: v }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || !trimmed || mut.isPending}
            onClick={() =>
              mut.mutate({
                ...draft,
                companyName: trimmed || DEFAULT_TRAVELER_CARD_CONFIG.companyName,
              })
            }
          >
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Değişiklik yalnızca bundan sonra basılan kartlara işler — mevcut kartlar
            basım anında dondurulmuştur.
          </span>
        </div>
      </div>
    </PermissionGate>
  );
}
