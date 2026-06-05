import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import { FlagToggle, ReadOnlyRow } from "./SettingRow";

/**
 * Cihaz eşleştirme zorunluluğu aç/kapa. Default PASİF (false): eşleşmemiş tabletler
 * de sisteme girip çalışabilir. Diğer görünüm flag'lerinden farklı olarak backend
 * tarafından ENFORCE edilir — bu yüzden ayrı, uyarılı bir bölümde tutulur.
 */
export function DevicePairingSection() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const required = flagsQ.data?.data?.devicePairingRequired ?? false;

  const mut = useMutation({
    mutationFn: (next: boolean) =>
      featureFlagService.update({ devicePairingRequired: next }),
    onSuccess: () => {
      toast.success("Cihaz eşleştirme ayarı güncellendi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) {
    return <Skeleton className="h-12 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <span
          className={`rounded-md border px-2 py-0.5 text-xs ${
            required
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
        >
          {required ? "Aktif (zorunlu)" : "Pasif (varsayılan)"}
        </span>
      </div>

      <PermissionGate
        permission="admin:settings"
        fallback={
          <ReadOnlyRow
            title="Cihaz eşleştirme zorunluluğu"
            enabled={required}
            onLabel="Aktif"
            offLabel="Pasif"
          />
        }
      >
        <FlagToggle
          title="Sahadaki tabletler için eşleştirmeyi zorunlu kıl"
          desc={
            <>
              Kapalıyken (varsayılan) eşleştirme <strong>pasiftir</strong>: eşleşmemiş
              tabletler de login olup tüm istasyon ekranlarını kullanabilir. Açıkken bir
              tablet ancak admin'in verdiği 6 haneli kodla bir makineye eşleştikten
              sonra sisteme girebilir.
            </>
          }
          checked={required}
          disabled={mut.isPending}
          onChange={(v) => mut.mutate(v)}
        />
      </PermissionGate>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-amber-600 dark:text-amber-400">Dikkat:</strong>{" "}
        Eşleştirme pasifken, <strong>eşleşmemiş</strong> bir tabletten işlenen toplarda
        "hangi makinede işlendi" bilgisi (makine atfı) boş kalır — üretim raporlarında
        makine kırılımı görünmez. Makine izini korumak isteyen tabletler yine gönüllü
        olarak eşleştirilebilir; eşleşmiş cihazlar bu moddan etkilenmez.
      </div>
    </div>
  );
}
