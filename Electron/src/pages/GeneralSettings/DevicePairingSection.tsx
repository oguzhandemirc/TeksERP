import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import { FlagToggle, ReadOnlyRow } from "./SettingRow";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";

/**
 * Cihaz eşleştirme zorunluluğu aç/kapa. Default PASİF (false): eşleşmemiş tabletler
 * de sisteme girip çalışabilir. Backend tarafından ENFORCE edilir (uyarılı bölüm).
 * TEK kaydetme standardı: toggle taslak tutulur, "Kaydet" yazar (anında-kayıt YOK).
 */
export function DevicePairingSection({
  writePermissions = [SETTINGS_ADMIN_PERMISSION],
}: {
  writePermissions?: string[];
}) {
  const qc = useQueryClient();
  const { hasAnyPermission } = useRoleAccess();
  const canEdit = hasAnyPermission(writePermissions);
  const flagsQ = useFeatureFlags();
  const server = flagsQ.data?.data?.devicePairingRequired ?? false;

  const [draft, setDraft] = useState(server);
  useEffect(() => setDraft(server), [server]);
  const dirty = draft !== server;
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: () => featureFlagService.update({ devicePairingRequired: draft }),
    onSuccess: () => {
      toast.success("Cihaz eşleştirme ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) {
    return <Skeleton className="h-12 w-full" />;
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <FlagToggle
          title="Sahadaki tabletler için eşleştirmeyi zorunlu kıl"
          desc={
            <>
              Kapalıyken (varsayılan) eşleştirme <strong>pasiftir</strong>: onaylanmamış
              tabletler de login olup tüm istasyon ekranlarını kullanabilir. Açıkken bir
              tablet ancak admin Cihazlar sayfasından <strong>"Onayla"</strong> ile
              onaylamadan sisteme giremez.
            </>
          }
          checked={draft}
          disabled={mut.isPending}
          onChange={setDraft}
        />
      ) : (
        <ReadOnlyRow
          title="Cihaz eşleştirme zorunluluğu"
          enabled={server}
          onLabel="Aktif"
          offLabel="Pasif"
        />
      )}

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-amber-600 dark:text-amber-400">Dikkat:</strong>{" "}
        Eşleştirme pasifken, <strong>eşleşmemiş</strong> bir tabletten işlenen toplarda
        "hangi makinede işlendi" bilgisi (makine atfı) boş kalır — üretim raporlarında
        makine kırılımı görünmez. Makine izini korumak isteyen tabletler yine gönüllü
        olarak eşleştirilebilir; eşleşmiş cihazlar bu moddan etkilenmez.
      </div>

      {canEdit && (
        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          onSave={() => mut.mutate()}
          onReset={() => setDraft(server)}
        />
      )}
    </div>
  );
}
