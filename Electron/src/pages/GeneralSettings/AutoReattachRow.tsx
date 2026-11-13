import { FlagToggle, ReadOnlyRow } from "./SettingRow";

const TITLE = "Onaylı cihaz yeniden kurulunca kendiliğinden tanınsın";

/** `device.autoReattachKnownHardware` satırı — yazma yalnız `admin:settings`; varsayılan açık, barındırılanda da kapatılabilir. */
export function AutoReattachRow({
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
          Onaylanmış bir tabletin uygulaması silinip yeniden kurulursa ya da verisi temizlenirse
          cihaz donanım kimliğinden tanınır ve yönetici onayı beklemeden aynı kayda bağlanır
          (atama ve donanım korunur, eski cihaz anahtarı geçersiz olur). Onayı geri alınmış ya da
          pasif cihaz hiçbir zaman kendiliğinden tanınmaz. Kapalıyken yeniden bağlama Cihazlar
          sayfasında onay bekler. Varsayılan: açık.
        </>
      }
      checked={draft}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
