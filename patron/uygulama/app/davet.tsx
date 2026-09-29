// Davet: kod → parola → doğrulama uygulamasına sır → ilk kod. TOTP sırrı YALNIZ bu ekranda bir kez
// görünür; ekran kapanınca bellekten düşer (depoya yazılmaz).
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { errorMessage } from "../src/api/client";
import type { InviteAccepted, InviteInfo } from "../src/api/wire";
import { formatDateTime } from "../src/lib/format";
import { useSession } from "../src/state/session";
import { Banner, Body, Button, Field, Muted, Title } from "../src/ui/kit";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: color.bg }} contentContainerStyle={{ padding: space.xl, maxWidth: 480, width: "100%", alignSelf: "center" }}>
      <Title>Davet</Title>
      {error ? <Banner tone="error" text={error} /> : null}
      {done ? (
        <View>
          <Banner tone="off" text="Hesabınız etkin. Şimdi giriş yapabilirsiniz." />
          <Button label="Girişe dön" onPress={() => router.replace("/giris")} />
        </View>
      ) : secret ? (
        <View>
          <Body>Doğrulama uygulamanıza (Google Authenticator, Microsoft Authenticator vb.) bu anahtarı ekleyin:</Body>
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
