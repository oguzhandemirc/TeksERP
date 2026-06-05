import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type FeatureFlags } from "@/services/featureFlagService";
import type { FlagDef } from "./settings-config";
import { FlagToggle, ReadOnlyRow } from "./SettingRow";

/**
 * Bir kategorinin özellik anahtarlarını config'ten render eder. Tüm flag'ler tek
 * generic mutation üzerinden güncellenir; yalnız o an kaydedilen satır disable olur
 * (pending key, mutation'ın değişkenlerinden okunur — flag başına ayrı mutation yok).
 */
export function FeatureFlagSection({ flags }: { flags: FlagDef[] }) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const values = flagsQ.data?.data;

  const mut = useMutation({
    mutationFn: (patch: Partial<FeatureFlags>) => featureFlagService.update(patch),
    onSuccess: () => {
      toast.success("Ayar güncellendi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });
  const pendingKey = mut.isPending ? Object.keys(mut.variables ?? {})[0] : null;

  if (flagsQ.isLoading) {
    return <Skeleton className="h-12 w-full" />;
  }

  return (
    <div className="divide-y divide-border">
      {flags.map((flag) => {
        const checked = values?.[flag.key] ?? false;
        return (
          <div key={flag.key} className="py-4 first:pt-0 last:pb-0">
            <PermissionGate
              permission="admin:settings"
              fallback={<ReadOnlyRow title={flag.title} enabled={checked} />}
            >
              <FlagToggle
                title={flag.title}
                desc={flag.desc}
                checked={checked}
                disabled={pendingKey === flag.key}
                onChange={(v) =>
                  mut.mutate({ [flag.key]: v } as Partial<FeatureFlags>)
                }
              />
            </PermissionGate>
          </div>
        );
      })}
    </div>
  );
}
