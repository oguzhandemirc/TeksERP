import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { FieldLabel } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import { DEFAULT_EIRSALIYE_CONFIG, type EIrsaliyeAdapter, type EIrsaliyeConfig } from "@/services/eIrsaliyeSettings";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";

/** Seçenek etiketleri — kullanıcı dili; teknik ad (`disaAktar`) ekrana çıkmaz. */
export const EIRSALIYE_ADAPTER_OPTIONS: ReadonlyArray<{ value: EIrsaliyeAdapter; label: string; hint: string }> = [
  { value: "yok", label: "Kapalı", hint: "e-İrsaliye üretilmez; sevkiyat bugünkü gibi yalnız kâğıt irsaliyeyle çalışır." },
  {
    value: "disaAktar",
    label: "Dışa aktar (portala elle yükleme)",
    hint: "XML dosyası üretilir, siz entegratör portalına yüklersiniz; numara ve durum elle kaydedilir.",
  },
  {
    value: "simulasyon",
    label: "Simülasyon (GİB'e gitmez)",
    hint: "Deneme içindir: belge üretilir ve gönderilmiş gibi işaretlenir ama hiçbir yere iletilmez.",
  },
];

/** Hazırlık denetiminin baktığı dört koşul — sunucu ölçer; burada yalnız rehber. */
const GEREKENLER = [
  "Şirket Bilgileri → Resmi künye: VKN/TCKN, unvan, vergi dairesi, il, ilçe",
  "Sistem → Numaralandırma: e-İrsaliye serisi (3 harf/rakam + yıl + 9 hane)",
  "Bu ekranda gönderim yöntemi: Dışa aktar ya da Simülasyon",
  "Bu ekranda yürürlük tarihi",
];

/**
 * e-İrsaliye yapılandırması (E3-AYAR). Modül anahtarı yok: özellik künye + seri +
 * yöntem + yürürlük tarihiyle açılır (plan §0.3 P1). Durum rozeti ve eksik listesi
 * sunucunun hazırlık ucundan gelir (E5/E7); bu ekran kendi hesabını YAPMAZ.
 */
export function EIrsaliyeSettingsSection({
  writePermissions = [SETTINGS_ADMIN_PERMISSION],
}: {
  writePermissions?: string[];
}) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const current = flagsQ.data?.data?.eIrsaliyeConfig ?? DEFAULT_EIRSALIYE_CONFIG;
  const [draft, setDraft] = useState<EIrsaliyeConfig>(current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(current), [current.adapter, current.yururlukTarihi]);

  const dirty = draft.adapter !== current.adapter || (draft.yururlukTarihi ?? "") !== (current.yururlukTarihi ?? "");
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: (payload: EIrsaliyeConfig) => featureFlagService.update({ eIrsaliyeConfig: payload }),
    onSuccess: (res) => {
      const saved = res.data?.eIrsaliyeConfig;
      if (saved) setDraft(saved);
      toast.success("e-İrsaliye ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <PermissionGate
      anyOf={writePermissions}
      fallback={<div className="text-sm text-muted-foreground">Bu ayarı değiştirmek için yetkin yok.</div>}
    >
      <div className="space-y-5" data-testid="eirsaliye-settings">
        <div>
          <FieldLabel htmlFor="eirs-adapter" label="Gönderim yöntemi" desc="Kapalı = bugünkü davranış. e-Fatura bu ekranın kapsamında değildir." />
          <div id="eirs-adapter" className="mt-2">
            <EnumRadioOptions
              name="e-İrsaliye gönderim yöntemi"
              value={draft.adapter}
              options={EIRSALIYE_ADAPTER_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, adapter: v as EIrsaliyeAdapter }))}
            />
          </div>
          {draft.adapter === "simulasyon" && (
            <div role="alert" className="mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Simülasyonda üretilen belgeler GİB'e GİTMEZ ve yasal irsaliye yerine geçmez. Gerçek sevkiyatta Dışa aktar seçin.</span>
            </div>
          )}
        </div>

        <div>
          <FieldLabel
            htmlFor="eirs-date"
            label="Yürürlük tarihi"
            desc="Bu günden (fabrika günü) önce sevk edilmiş sevkiyatlara e-İrsaliye üretilmez."
          />
          <div className="mt-2 w-48">
            <DatePickerInput
              id="eirs-date"
              value={draft.yururlukTarihi ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, yururlukTarihi: v || null }))}
            />
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-sm font-medium">Kullanıma açılması için gerekenler</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {GEREKENLER.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Hepsi tamamlanmadıkça e-İrsaliye üretilmez ve sevkiyat bugünkü gibi çalışır.
          </p>
        </div>

        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          onSave={() => mut.mutate(draft)}
          onReset={() => setDraft(current)}
        />
      </div>
    </PermissionGate>
  );
}
