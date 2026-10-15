// Davet: kod → parola → doğrulama uygulamasına sır (karekod + elle anahtar) → ilk kod. TOTP sırrı YALNIZ bu ekranda bir kez
// görünür; ekran kapanınca bellekten düşer (depoya yazılmaz). Zaten bulut hesabı olan kişi yeni hesap açmaz:
// e-posta + parola + TOTP ile mevcut kimliğini davetin fabrikasına bağlar (`/davet/bagla`; hata iletisi genel).
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { ApiError, errorMessage } from "../src/api/client";
import type { InviteAccepted, InviteInfo } from "../src/api/wire";
import { formatDateTime } from "../src/lib/format";
import { useSession } from "../src/state/session";
import { Banner, Body, Button, Field, Muted, Title } from "../src/ui/kit";
import { TotpQr } from "../src/ui/TotpQr";
import { color, space } from "../src/ui/theme";

export default function Invite() {
  const { api } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ davet?: string }>();
  const [code, setCode] = useState(typeof params.davet === "string" ? params.davet : "");
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [secret, setSecret] = useState<InviteAccepted | null>(null);
  const [totp, setTotp] = useState("");
  const [done, setDone] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPw, setLinkPw] = useState("");
  const [linkTotp, setLinkTotp] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      // Bağlamada yanlış faktör ile e-posta uyuşmazlığı sunucuda aynı 401'dir; ileti de tek ve genel.
      setError(linkMode && err instanceof ApiError && err.kind === "OTURUM" ? "Bilgiler doğrulanamadı. E-posta, parola ve doğrulama kodunu kontrol edin." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: color.bg }} contentContainerStyle={{ padding: space.xl, maxWidth: 480, width: "100%", alignSelf: "center" }}>
      <Title>Davet</Title>
      {error ? <Banner tone="error" text={error} /> : null}
      {done || linked ? (
        <View>
          <Banner tone="off" text={linked ? "Fabrika hesabınıza bağlandı. Giriş yaptıktan sonra fabrika değiştirerek ulaşabilirsiniz." : "Hesabınız etkin. Şimdi giriş yapabilirsiniz."} />
          <Button label="Girişe dön" onPress={() => router.replace("/giris")} testID="davet-giris" />
        </View>
      ) : info && linkMode ? (
        <View>
          <Body>{`${info.tesisAd ?? "Tesis"} · mevcut hesabınızla bağlanın`}</Body>
          <Field label="E-posta" value={linkEmail} onChangeText={setLinkEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" testID="bagla-eposta" />
          <Field label="Parola" value={linkPw} onChangeText={setLinkPw} secureTextEntry autoComplete="current-password" testID="bagla-parola" />
          <Field label="Doğrulama kodu" value={linkTotp} onChangeText={(t) => setLinkTotp(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" testID="bagla-totp" />
          <Button label="Bağla" busy={busy} disabled={linkEmail.trim() === "" || linkPw === "" || linkTotp.length !== 6} testID="bagla-gonder"
            onPress={() => void run(async () => { await api.inviteLink({ davet: code.trim(), eposta: linkEmail.trim(), parola: linkPw, totp: linkTotp }); setLinkPw(""); setLinkTotp(""); setLinked(true); })} />
          <Button label="Yeni hesap oluştur" tone="plain" onPress={() => { setLinkMode(false); setError(null); }} />
        </View>
      ) : secret ? (
        <View>
          <Body>Doğrulama uygulamanızla (Google Authenticator, Microsoft Authenticator vb.) karekodu okutun:</Body>
          <TotpQr value={secret.otpauth} />
          <Muted>Karekod okutamıyorsanız bu anahtarı elle ekleyin:</Muted>
          <Text selectable style={{ fontSize: 20, fontWeight: "700", letterSpacing: 2, marginVertical: space.m }} testID="totp-sirri">
            {secret.totpSirri.replace(/(.{4})/g, "$1 ").trim()}
          </Text>
          <Button label="Doğrulama uygulamasında aç" tone="plain" onPress={() => void Linking.openURL(secret.otpauth).catch(() => undefined)} />
          <Field label="Uygulamadaki 6 haneli kod" value={totp} onChangeText={(t) => setTotp(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
          <Button label="Onayla" busy={busy} disabled={totp.length !== 6} onPress={() => void run(async () => { await api.inviteConfirm(code.trim(), totp); setSecret(null); setDone(true); })} />
        </View>
      ) : info ? (
        <View>
          <Body>{`${info.ad} · ${info.eposta}`}</Body>
          <Muted>{`${info.tesisAd ?? "Tesis"} · davet ${formatDateTime(info.bitis)} tarihine kadar geçerli`}</Muted>
          <Field label="Parola (en az 12 karakter)" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
          <Field label="Parola (tekrar)" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" />
          {pw2 !== "" && pw !== pw2 ? <Muted>Parolalar aynı değil</Muted> : null}
          <Button label="Devam" busy={busy} disabled={pw === "" || pw !== pw2} onPress={() => void run(async () => setSecret(await api.inviteAccept(code.trim(), pw)))} />
          <Button label="Zaten TeksERP Yönetim hesabım var — bağla" tone="plain" testID="davet-bagla"
            onPress={() => { setLinkMode(true); setLinkEmail(info.eposta); setError(null); }} />
        </View>
      ) : (
        <View>
          <Field label="Davet kodu" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
          <Button label="Devam" busy={busy} disabled={code.trim() === ""} onPress={() => void run(async () => setInfo(await api.inviteInspect(code.trim())))} />
          <Button label="Girişe dön" tone="plain" onPress={() => router.replace("/giris")} />
        </View>
      )}
    </ScrollView>
  );
}
