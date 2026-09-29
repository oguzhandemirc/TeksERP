// Profil: hesap bilgisi, parola değişimi (TOTP ile), bildirim ayarlarına geçiş, çıkış.
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useSession } from "../../src/state/session";
import { Screen } from "../../src/ui/Frame";
import { Banner, Body, Button, Card, ConfirmButton, Field, Muted, Title } from "../../src/ui/kit";
import { useWrite } from "../../src/ui/useWrite";

export default function Profile() {
  const { api, facility, logout } = useSession();
  const router = useRouter();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [totp, setTotp] = useState("");
  const [ok, setOk] = useState(false);
  const change = useWrite(useCallback(() => api.changePassword({ mevcutParola: cur, yeniParola: next, totp }).then(() => true), [api, cur, next, totp]));
  return (
    <Screen title="Profil" module="profil">
      <Card>
        <Title>{facility?.hesap.ad ?? ""}</Title>
        <Body>{facility?.hesap.eposta ?? ""}</Body>
        <Muted>{facility?.tesis.ad ?? ""}</Muted>
      </Card>
      <Title>Parola değiştir</Title>
      <Muted>Doğrulama kodu (TOTP) her girişte istenir; doğrulama uygulamanızı değiştirmek için tesis yöneticiniz daveti yeniler.</Muted>
      <Field label="Mevcut parola" value={cur} onChangeText={setCur} secureTextEntry />
      <Field label="Yeni parola (en az 12 karakter)" value={next} onChangeText={setNext} secureTextEntry />
      <Field label="Doğrulama kodu" value={totp} onChangeText={(t) => setTotp(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
      {change.error ? <Banner tone="error" text={change.error} /> : null}
      {ok ? <Banner tone="off" text="Parola değişti" /> : null}
      <Button label="Parolayı değiştir" busy={change.busy} disabled={change.disabled || cur === "" || next.length < 12 || totp.length !== 6}
        onPress={() => void change.run(totp).then((r) => { if (r) { setOk(true); setCur(""); setNext(""); setTotp(""); } })} />
      <Title>Bildirimler</Title>
      <Muted>Hangi bildirimlerin, hangi saatlerde geleceğini ve eşikleri seçin; bu cihazı bildirim için kaydedin.</Muted>
      <Button label="Bildirim ayarları" onPress={() => router.push("/bildirimler" as never)} testID="bildirim-ayarlari" />
      <ConfirmButton label="Çıkış yap" question="Oturum kapatılsın ve bu cihazdaki son veri silinsin mi?" onConfirm={() => void logout()} testID="cikis" />
    </Screen>
  );
}
