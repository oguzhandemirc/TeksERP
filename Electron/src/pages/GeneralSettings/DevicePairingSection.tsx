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
 * Cihaz eşleştirme zorunluluğu + "hızlı PIN / kart yalnız onaylı cihazdan" kuralı.
 * İkinci kural eşleştirmeyi de zorunlu kılar (otomatik onaylanan cihaz "onaylı" sayılmasın);
 * backend aynı kuralı ENFORCE eder ve kural açıkken eşleştirmeyi kapatmayı 409 ile reddeder.
 * Kısa kimlik kuralını yalnız `admin:settings` yazar (dar `settings:devices` izni yazamaz).
 */
export function DevicePairingSection({
  writePermissions = [SETTINGS_ADMIN_PERMISSION],
}: {
  writePermissions?: string[];
}) {
  const qc = useQueryClient();
  const { hasAnyPermission } = useRoleAccess();
  const canEdit = hasAnyPermission(writePermissions);
  const canEditShortCredential = hasAnyPermission([SETTINGS_ADMIN_PERMISSION]);
  const flagsQ = useFeatureFlags();
  const server = flagsQ.data?.data?.devicePairingRequired ?? false;
  const serverShort = flagsQ.data?.data?.shortCredentialApprovedDeviceOnly ?? false;

  const [draft, setDraft] = useState(server);
  const [draftShort, setDraftShort] = useState(serverShort);
  useEffect(() => setDraft(server), [server]);
  useEffect(() => setDraftShort(serverShort), [serverShort]);
  // Kısa kimlik kuralı açıkken eşleştirme etkin zorunludur — taslak da onu yansıtsın.
  const effectiveDraft = draft || draftShort;
  const dirty = effectiveDraft !== server || draftShort !== serverShort;
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: () =>
      featureFlagService.update({
        ...(draftShort !== serverShort ? { shortCredentialApprovedDeviceOnly: draftShort } : {}),
        ...(effectiveDraft !== server ? { devicePairingRequired: effectiveDraft } : {}),
      }),
    onSuccess: () => {
      toast.success("Cihaz ayarları kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) {
    return <Skeleton className="h-12 w-full" />;
  }

  return (
    <div className="space-y-4">
      <PairingRow
        canEdit={canEdit}
        checked={effectiveDraft}
        server={server}
        locked={draftShort}
        disabled={mut.isPending}
        onChange={setDraft}
      />

      <ShortCredentialDeviceRow
        canEdit={canEditShortCredential}
        draft={draftShort}
        server={serverShort}
        disabled={mut.isPending}
        onChange={setDraftShort}
      />

      <PairingNote />

      {(canEdit || canEditShortCredential) && (
        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          onSave={() => mut.mutate()}
          onReset={() => {
            setDraft(server);
            setDraftShort(serverShort);
          }}
        />
      )}
    </div>
  );
}

/** "Hızlı PIN / kart yalnız onaylı cihazdan" satırı — yazma yalnız `admin:settings`. */
function ShortCredentialDeviceRow({
  canEdit,
  draft,
  server,
  disabled,
  onChange,
}: {
  canEdit: boolean;
  draft: boolean;
  server: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  if (!canEdit) {
    return (
      <ReadOnlyRow
        title="Hızlı PIN ve personel kartı yalnız onaylı cihazdan"
        enabled={server}
        onLabel="Açık"
        offLabel="Kapalı"
      />
    );
  }
  return (
    <FlagToggle
      title="Hızlı PIN ve personel kartı yalnız onaylı cihazdan"
      desc={
        <>
          Açıkken hızlı PIN ve QR personel kartıyla giriş yalnız yöneticinin onayladığı
          tablet/telefonlardan kabul edilir; eşleştirme de zorunlu olur. Kullanıcı adı +
          şifre girişi etkilenmez. Kapalıyken (varsayılan) bugünkü gibi her cihaz PIN/kart
          deneyebilir. Bulut (barındırılan) kurulumda bu kural her zaman açıktır.
        </>
      }
      checked={draft}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/** Eşleştirme zorunluluğu satırı — kısa kimlik kuralı açıkken kilitli. */
function PairingRow({
  canEdit,
  checked,
  server,
  locked,
  disabled,
  onChange,
}: {
  canEdit: boolean;
  checked: boolean;
  server: boolean;
  locked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  if (!canEdit) {
    return <ReadOnlyRow title="Cihaz eşleştirme zorunluluğu" enabled={server} onLabel="Aktif" offLabel="Pasif" />;
  }
  return (
    <FlagToggle
      title="Sahadaki tabletler için eşleştirmeyi zorunlu kıl"
      desc={
        <>
          Kapalıyken (varsayılan) eşleştirme <strong>pasiftir</strong>: onaylanmamış
          tabletler de login olup tüm istasyon ekranlarını kullanabilir. Açıkken bir
          tablet ancak admin Cihazlar sayfasından <strong>"Onayla"</strong> ile
          onaylamadan sisteme giremez.
          {locked && (
            <>
              {" "}
              <strong>"Hızlı PIN / kart yalnız onaylı cihazdan" açıkken bu kural kapatılamaz.</strong>
            </>
          )}
        </>
      }
      checked={checked}
      disabled={disabled || locked}
      onChange={onChange}
    />
  );
}

function PairingNote() {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
      <strong className="text-amber-600 dark:text-amber-400">Dikkat:</strong>{" "}
      Eşleştirme pasifken, <strong>eşleşmemiş</strong> bir tabletten işlenen toplarda
      "hangi makinede işlendi" bilgisi (makine atfı) boş kalır — üretim raporlarında
      makine kırılımı görünmez. Makine izini korumak isteyen tabletler yine gönüllü
      olarak eşleştirilebilir; eşleşmiş cihazlar bu moddan etkilenmez.
    </div>
  );
}
