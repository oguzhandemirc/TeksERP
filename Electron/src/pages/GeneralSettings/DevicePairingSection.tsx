import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FlagToggle, ReadOnlyRow } from "./SettingRow";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";
import { UnpairedPasswordLoginRow, UnpairedPasswordLoginWarning } from "./UnpairedPasswordLoginRow";
import { useDevicePairingDrafts } from "./useDevicePairingDrafts";

/**
 * Cihaz eşleştirme zorunluluğu + "hızlı PIN / kart yalnız onaylı cihazdan" kuralı.
 * İkinci kural eşleştirmeyi de zorunlu kılar (otomatik onaylanan cihaz "onaylı" sayılmasın);
 * backend aynı kuralı ENFORCE eder ve kural açıkken eşleştirmeyi kapatmayı 409 ile reddeder.
 * Kısa kimlik kuralını, cihaz kanıtını ve onaysız parola girişini yalnız `admin:settings` yazar.
 */
export function DevicePairingSection({
  writePermissions = [SETTINGS_ADMIN_PERMISSION],
}: {
  writePermissions?: string[];
}) {
  const { hasAnyPermission } = useRoleAccess();
  const canEdit = hasAnyPermission(writePermissions);
  const canEditAdmin = hasAnyPermission([SETTINGS_ADMIN_PERMISSION]);
  const { isLoading, server, draft, set, dirty, mut, reset } = useDevicePairingDrafts();

  if (isLoading) {
    return <Skeleton className="h-12 w-full" />;
  }
  const busy = mut.isPending;

  return (
    <div className="space-y-4">
      <PairingRow
        canEdit={canEdit}
        checked={draft.devicePairingRequired}
        server={server.devicePairingRequired}
        locked={draft.shortCredentialApprovedDeviceOnly}
        disabled={busy}
        onChange={set.pairing}
      />

      <ShortCredentialDeviceRow
        canEdit={canEditAdmin}
        draft={draft.shortCredentialApprovedDeviceOnly}
        server={server.shortCredentialApprovedDeviceOnly}
        disabled={busy}
        onChange={set.short}
      />
      {draft.shortCredentialApprovedDeviceOnly && !draft.deviceProofRequired && <ShortCredentialProofWarning />}

      <DeviceProofRow
        canEdit={canEditAdmin}
        draft={draft.deviceProofRequired}
        server={server.deviceProofRequired}
        disabled={busy}
        onChange={set.proof}
      />

      <UnpairedPasswordLoginRow
        canEdit={canEditAdmin}
        draft={draft.deviceUnpairedPasswordLogin}
        server={server.deviceUnpairedPasswordLogin}
        disabled={busy}
        onChange={set.unpaired}
      />
      {draft.deviceUnpairedPasswordLogin && <UnpairedPasswordLoginWarning />}

      <PairingNote />

      {(canEdit || canEditAdmin) && (
        <SettingsSaveBar dirty={dirty} saving={busy} onSave={() => mut.mutate()} onReset={reset} />
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

/** Fabrikada kısa kimlik kuralı kanıtı zorlamaz; kanıtsız cihaz kimliği yalnız bir başlıktır. */
function ShortCredentialProofWarning() {
  return (
    <p className="-mt-2 px-1 text-xs text-amber-600 dark:text-amber-400" data-testid="short-credential-proof-warning">
      Cihaz kanıtı kapalıyken bu kapı başlıkla aşılabilir — Cihaz kanıtı ayarını açın.
    </p>
  );
}

/** "Cihaz kanıtı zorunlu" satırı — yazma yalnız `admin:settings`. */
function DeviceProofRow({
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
  const title = "Cihaz kanıtı zorunlu (taklit edilemez cihaz kimliği)";
  if (!canEdit) {
    return <ReadOnlyRow title={title} enabled={server} onLabel="Açık" offLabel="Kapalı" />;
  }
  return (
    <FlagToggle
      title={title}
      desc={
        <>
          Açıkken onaylı bir tablet her istekte sunucunun ona verdiği gizli anahtarla imza
          gönderir; imzasız ya da yanlış imzalı istek onaylı cihaz sayılmaz (hızlı PIN/kart
          girişi reddedilir). Eski sürüm tabletler imza üretemez — açmadan önce bütün
          tabletleri güncelleyin. Kapalıyken (varsayılan) bugünkü gibi cihaz kimliği yeter.
          Bulut (barındırılan) kurulumda bu kural her zaman açıktır.
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
