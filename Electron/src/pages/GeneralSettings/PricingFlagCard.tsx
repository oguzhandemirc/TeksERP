import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import {
  FEATURE_FLAGS_QUERY_KEY,
  useFeatureFlags,
} from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";

export function PricingFlagCard() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const pricingEnabled = flagsQ.data?.data?.pricingEnabled ?? false;

  const mut = useMutation({
    mutationFn: (next: boolean) => featureFlagService.update({ pricingEnabled: next }),
    onSuccess: () => {
      toast.success("Görünüm ayarı güncellendi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="text-sm font-medium">Görünüm Ayarları</div>
      </CardHeader>
      <CardContent className="p-5">
        {flagsQ.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <PermissionGate
            permission="admin:settings"
            fallback={
              <ReadOnlyRow enabled={pricingEnabled} />
            }
          >
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <div className="space-y-1 text-sm">
                <div className="font-medium">
                  Sipariş para birimi ve fiyat alanlarını göster
                </div>
                <p className="text-xs text-muted-foreground">
                  Kapalıyken sipariş ekranlarında para birimi seçici, birim fiyat input'u ve toplam tutar gizlenir. Mevcut kayıtlardaki değerler korunur — kalıcı veri kaybı YOK.
                </p>
              </div>
              <input
                type="checkbox"
                checked={pricingEnabled}
                onChange={(e) => mut.mutate(e.target.checked)}
                disabled={mut.isPending}
                className="mt-1 h-5 w-5 cursor-pointer"
              />
            </label>
          </PermissionGate>
        )}
      </CardContent>
    </Card>
  );
}

function ReadOnlyRow({ enabled }: { enabled: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div>
        <div className="font-medium">Sipariş fiyat alanları</div>
        <p className="text-xs text-muted-foreground">
          Bu ayarı değiştirmek için `admin:settings` yetkisi gerekir.
        </p>
      </div>
      <span className="rounded-md border px-2 py-0.5 text-xs">
        {enabled ? "Açık" : "Kapalı"}
      </span>
    </div>
  );
}
