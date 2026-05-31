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
  const targetQuantityEnabled = flagsQ.data?.data?.targetQuantityEnabled ?? false;

  const invalidate = () => {
    toast.success("Görünüm ayarı güncellendi.");
    void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
  };

  const pricingMut = useMutation({
    mutationFn: (next: boolean) => featureFlagService.update({ pricingEnabled: next }),
    onSuccess: invalidate,
  });
  const targetMut = useMutation({
    mutationFn: (next: boolean) =>
      featureFlagService.update({ targetQuantityEnabled: next }),
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="text-sm font-medium">Görünüm Ayarları</div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        {flagsQ.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <>
            <PermissionGate
              permission="admin:settings"
              fallback={<ReadOnlyRow title="Sipariş fiyat alanları" enabled={pricingEnabled} />}
            >
              <FlagToggle
                title="Sipariş para birimi ve fiyat alanlarını göster"
                desc="Kapalıyken sipariş ekranlarında para birimi seçici, birim fiyat input'u ve toplam tutar gizlenir. Mevcut kayıtlardaki değerler korunur — kalıcı veri kaybı YOK."
                checked={pricingEnabled}
                disabled={pricingMut.isPending}
                onChange={(v) => pricingMut.mutate(v)}
              />
            </PermissionGate>

            <PermissionGate
              permission="admin:settings"
              fallback={
                <ReadOnlyRow title="İş emri hedef metraj alanı" enabled={targetQuantityEnabled} />
              }
            >
              <FlagToggle
                title="İş emri hedef metraj alanını göster"
                desc="Kapalıyken iş emri formunda 'hedef metraj' alanı gizlenir. Proses-only fabrikada üretim miktarını giren kumaş belirler; ileride örgü/üretim eklenirse açılır."
                checked={targetQuantityEnabled}
                disabled={targetMut.isPending}
                onChange={(v) => targetMut.mutate(v)}
              />
            </PermissionGate>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FlagToggle({
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div className="space-y-1 text-sm">
        <div className="font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 h-5 w-5 cursor-pointer"
      />
    </label>
  );
}

function ReadOnlyRow({ title, enabled }: { title: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div>
        <div className="font-medium">{title}</div>
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
