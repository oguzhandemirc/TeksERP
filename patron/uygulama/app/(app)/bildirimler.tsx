// Bildirimler: ayarlar (ana anahtar · tür · sessiz saat · eşikler), tesis varsayılanı (yönetici), bu cihaz, geçmiş.
// Karar sunucudadır: ayar katı şemadan geçer, izni yetmeyen türe ayar açık olsa da gönderilmez.
import { useCallback, useEffect, useState } from "react";
import type { NotificationSettingsView } from "../../src/api/wire";
import { can } from "../../src/lib/access";
import { fromForm, toForm, type NotificationForm } from "../../src/lib/notification-form";
import { useSession } from "../../src/state/session";
import { useRemote } from "../../src/state/useRemote";
import { ErrorBox } from "../../src/ui/data";
import { Screen } from "../../src/ui/Frame";
import { Banner, Button, ConfirmButton, Loading, Muted } from "../../src/ui/kit";
import { NotificationDevices, NotificationHistory } from "../../src/ui/NotificationDevices";
import { NotificationSettingsForm } from "../../src/ui/NotificationSettingsForm";
import { useWrite } from "../../src/ui/useWrite";

const SOURCE: Readonly<Record<NotificationSettingsView["kaynak"], string>> = {
  HESAP: "Kendi ayarlarınız kullanılıyor.",
  TESIS: "Tesis yöneticisinin varsayılanı kullanılıyor; değiştirip kaydederseniz yalnız sizin için geçerli olur.",
  VARSAYILAN: "Standart ayarlar kullanılıyor.",
};

export default function Notifications() {
  const { api, permissions } = useSession();
  const remote = useRemote("bildirim-ayarlar", () => api.notificationSettings());
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  const [form, setForm] = useState<NotificationForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (remote.data) {
      setView(remote.data);
      setForm(toForm(remote.data.etkin));
    }
  }, [remote.data]);
  const adopt = (v: NotificationSettingsView | null, message: string) => {
    if (!v) return;
    setView(v);
    setForm(toForm(v.etkin));
    setSaved(message);
  };
  const parsed = form ? fromForm(form) : null;
  const saveOwn = useWrite(useCallback(() => (parsed?.ok ? api.notificationSettingsSet(parsed.settings) : Promise.reject(new Error("Form geçersiz"))), [api, parsed]));
  const reset = useWrite(useCallback(() => api.notificationSettingsSet(null), [api]));
  const saveFacility = useWrite(useCallback(() => (parsed?.ok ? api.notificationFacilityDefaults(parsed.settings) : Promise.reject(new Error("Form geçersiz"))), [api, parsed]));
  const submit = async (w: typeof saveOwn, message: string) => {
    setSaved(null);
    if (!parsed?.ok) {
      setFormError(parsed && !parsed.ok ? parsed.error : "Form geçersiz");
      return;
    }
    setFormError(null);
    adopt(await w.run(JSON.stringify(parsed.settings)), message);
  };

  if (remote.loading && !view) return <Screen title="Bildirimler" module="bildirimler"><Loading /></Screen>;
  if (remote.error && !view) return <Screen title="Bildirimler" module="bildirimler"><ErrorBox text={remote.error} onRetry={remote.reload} /></Screen>;
  if (!view || !form) return <Screen title="Bildirimler" module="bildirimler"><Muted>Ayarlar okunamadı</Muted></Screen>;
  const error = formError ?? saveOwn.error ?? reset.error ?? saveFacility.error;
  return (
    <Screen title="Bildirimler" module="bildirimler">
      {view.gonderim === "kapali" ? <Banner tone="warn" text="Bildirim gönderimi sunucuda henüz açık değil; ayarlarınız saklanır ve açıldığında geçerli olur." testID="gonderim-kapali" /> : null}
      <Muted>{SOURCE[view.kaynak]}</Muted>
      <NotificationSettingsForm form={form} kinds={view.turler} onChange={(f) => { setForm(f); setSaved(null); }} />
      {error ? <Banner tone="error" text={error} testID="bildirim-hata" /> : null}
      {saved ? <Banner tone="off" text={saved} /> : null}
      <Button label="Kaydet" busy={saveOwn.busy} disabled={saveOwn.disabled} onPress={() => void submit(saveOwn, "Ayarlarınız kaydedildi")} testID="bildirim-kaydet" />
      {view.kaynak === "HESAP" ? (
        <ConfirmButton label="Tesis varsayılanına dön" question="Kendi ayarlarınız silinip tesis varsayılanı kullanılsın mı?" busy={reset.busy}
          onConfirm={() => void reset.run("sifirla").then((v) => adopt(v, "Tesis varsayılanına dönüldü"))} />
      ) : null}
      {can(permissions, "bulut:hesap:yonet") ? (
        <ConfirmButton label="Tesis varsayılanı olarak kaydet" question="Bu ayarlar, kendi ayarı olmayan bütün hesaplar için varsayılan olsun mu?" busy={saveFacility.busy}
          onConfirm={() => void submit(saveFacility, "Tesis varsayılanı kaydedildi")} testID="tesis-varsayilani" />
      ) : null}
      <NotificationDevices vapidKey={view.webPushAnahtari} />
      <NotificationHistory />
    </Screen>
  );
}
