// Giriş iki ekran, TEK istek: ① e-posta + parola → ② doğrulama kodu (TOTP); sunucu üçünü birlikte
// denetler (TOTP'siz oturum yok). Hata iletisi hangi alanın yanlış olduğunu söylemez.
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { errorMessage } from "../src/api/client";
import { useSession } from "../src/state/session";
import { Banner, Button, Field, Muted, Title } from "../src/ui/kit";
import { color, space } from "../src/ui/theme";

export default function Login() {
  const { login, phase, configured } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [eposta, setEposta] = useState("");
  const [parola, setParola] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase === "hazir") return <Redirect href="/pano" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await login({ eposta: eposta.trim(), parola, totp: totp.trim() });
      router.replace("/pano");
    } catch (err) {
      setError(errorMessage(err));
      setTotp("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, maxWidth: 440, width: "100%", alignSelf: "center", marginTop: space.xl * 2 }}>
        <Title>TeksERP Patron</Title>
        {!configured ? <Banner tone="error" text="Uygulama bulut adresi olmadan derlenmiş; giriş yapılamaz" /> : null}
        {error ? <Banner tone="error" text={error} testID="giris-hata" /> : null}
        {step === 1 ? (
          <View>
            <Field label="E-posta" value={eposta} onChangeText={setEposta} autoCapitalize="none" autoComplete="email" keyboardType="email-address" testID="eposta" />
            <Field label="Parola" value={parola} onChangeText={setParola} secureTextEntry autoComplete="password" testID="parola" />
            <Button label="Devam" disabled={!configured || eposta.trim() === "" || parola === ""} onPress={() => { setError(null); setStep(2); }} testID="devam" />
            <Button label="Davet kodum var" tone="plain" onPress={() => router.push("/davet")} />
          </View>
        ) : (
          <View>
            <Muted>{`${eposta.trim()} için doğrulama uygulamanızdaki 6 haneli kodu girin`}</Muted>
            <Field label="Doğrulama kodu" value={totp} onChangeText={(t) => setTotp(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" testID="totp" />
            <Button label="Giriş yap" busy={busy} disabled={totp.length !== 6} onPress={() => void submit()} testID="giris" />
            <Button label="Geri" tone="plain" onPress={() => { setStep(1); setTotp(""); }} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
