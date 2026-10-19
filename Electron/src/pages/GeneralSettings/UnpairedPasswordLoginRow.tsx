import { FlagToggle, ReadOnlyRow } from "./SettingRow";

const TITLE = "Onaysız tabletler kullanıcı adı ve şifreyle girebilsin";

/** `device.unpairedPasswordLogin` satırı — yazma yalnız `admin:settings`; barındırılanda da zorlanmaz. */
export function UnpairedPasswordLoginRow({
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
    return <ReadOnlyRow title={TITLE} enabled={server} onLabel="Açık" offLabel="Kapalı" />;
  }
  return (
    <FlagToggle
      title={TITLE}
      desc={
        <>
          Eşleştirme zorunluyken onay bekleyen bir tablet, yönetici onayını beklemeden yalnız
          kullanıcı adı + şifreyle girebilir (ör. uygulama mağazası incelemesi, sunum).
          Kapalıyken (varsayılan) onaylanmamış tablet onay ekranında bekler. Eşleştirme
          pasifken bu ayarın etkisi yoktur.
        </>
      }
      checked={draft}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/** Ayar açıkken onaysız tabletin neyi yapıp neyi yapamayacağını ve yasaklama yolunu söyler. */
export function UnpairedPasswordLoginWarning() {
  return (
    <p className="-mt-2 px-1 text-xs text-amber-600 dark:text-amber-400" data-testid="unpaired-password-login-warning">
      Onaysız tablet yalnız kullanıcı adı + şifreyle girer; hızlı PIN, personel kartı ve personel
      listesi kapalı kalır, işlenen toplarda makine atfı boş olur. Bir tableti yasaklamak için
      Cihazlar sayfasında pasifleştirin — onayı geri almak yetmez.
    </p>
  );
}
