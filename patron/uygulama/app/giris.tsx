// Giriş: ① kimlik + parola → ② doğrulama kodu (TOTP). Bulutta kod HER girişte (iki ekran, tek istek); fabrika
// sunucusunda kod yalnız sunucu isterse (409 TOTP_REQUIRED) sorulur. Hata iletisi hangi alanın yanlış olduğunu söylemez.
// "Fabrika sunucusuna bağlan": adres elle yazılır ya da paneldeki karekoddan okunur (telefonda), yoklanır, tanınırsa
// kaydedilir. Parola/kod hiçbir yere yazılmaz.
// Web duman betiği giriş sayfasında `input` sayar (≥ 2): ① adımda iki alan kalır.
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { ApiError, errorMessage } from "../src/api/client";
import { TOTP_REQUIRED } from "../src/api/erp";
import { useSession } from "../src/state/session";
import { AuthShell } from "../src/ui/diger/AuthShell";
import { KarekodOkut } from "../src/ui/diger/KarekodOkut";
import { Banner, Button, Field } from "../src/ui/kit";
import { space } from "../src/ui/tokens";

const hostOf = (adres: string) => adres.replace(/^https:\/\//, "");

function ServerStep({ onDone }: { readonly onDone: () => void }) {
  const { connectServer } = useSession();
  const [adres, setAdres] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  async function connect() {
    setBusy(true);
    setError(null);
    const msg = await connectServer(adres).catch(() => "Sunucuya ulaşılamıyor");
    setBusy(false);
    if (msg) setError(msg);
    else onDone();
  }
  async function connectScanned(scanned: string): Promise<string | null> {
    const msg = await connectServer(scanned);
    if (!msg) onDone();
    return msg;
  }
  if (scan) return <KarekodOkut onAdres={connectScanned} onElle={(msg) => { setScan(false); setError(msg ?? null); }} />;
  return (
    <AuthShell title="Sunucu ekle" subtitle="Fabrikanızın TeksERP adresi">
      {error ? <Banner tone="error" text={error} testID="sunucu-hata" /> : null}
      <Field label="Sunucu adresi" value={adres} onChangeText={setAdres} autoCapitalize="none" autoComplete="url" keyboardType="url" placeholder="erp.fabrika.com" testID="sunucu-adres" />
      <View style={{ height: space.xs }} />
      <Button label="Bağlan" icon="link-outline" busy={busy} disabled={adres.trim() === ""} onPress={() => void connect()} testID="sunucu-baglan" />
      {Platform.OS !== "web" ? (
        <Button label="Karekod okut" tone="secondary" icon="qr-code-outline" onPress={() => { setError(null); setScan(true); }} testID="sunucu-karekod" />
      ) : null}
      <Button label="Geri" tone="plain" onPress={onDone} testID="sunucu-geri" />
    </AuthShell>
  );
}

export default function Login() {
  const { login, phase, configured, server, forgetServer, yetenek } = useSession();
  const router = useRouter();
  const [addServer, setAddServer] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [eposta, setEposta] = useState("");
  const [parola, setParola] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase === "hazir") return <Redirect href="/pano" />;
  if (addServer) return <ServerStep onDone={() => { setAddServer(false); setStep(1); setError(null); }} />;

  const erp = server !== null;
  const codeFirst = yetenek.kodHerZaman;

  async function submit(code: string) {
    setBusy(true);
    setError(null);
    try {
      await login({ eposta: eposta.trim(), parola, totp: code.trim() });
      router.replace("/pano");
    } catch (err) {
      // Sunucu kod istedi (kod istek üzerine): ikinci adım açılır, ileti gösterilmez.
      if (err instanceof ApiError && err.code === TOTP_REQUIRED && step === 1) setStep(2);
      else setError(errorMessage(err));
      setTotp("");
    } finally {
      setBusy(false);
    }
  }

  const who = erp ? "Kullanıcı adı" : "E-posta";
  const subtitle1 = erp ? `${hostOf(server)} · kullanıcı adı ve parolanızla` : "Hesabınızın e-posta adresi ve parolasıyla";
  const footer =
    step !== 1 ? null : erp ? (
      <Button label="Sunucuyu kaldır" tone="plain" icon="close-circle-outline" onPress={() => void forgetServer()} testID="sunucu-kaldir" />
    ) : (
      <View>
        <Button label="Fabrika sunucusuna bağlan" tone="plain" icon="server-outline" onPress={() => setAddServer(true)} testID="sunucu-ekle" />
        <Button label="Davet kodum var" tone="plain" icon="mail-open-outline" onPress={() => router.push("/davet")} testID="davet-git" />
      </View>
    );

  return (
    <AuthShell
      title={step === 1 ? "Giriş yap" : "Doğrulama kodu"}
      subtitle={step === 1 ? subtitle1 : `${eposta.trim()} için doğrulama uygulamanızdaki 6 haneli kodu girin`}
      step={codeFirst ? { at: step, of: 2 } : undefined}
      footer={footer}
    >
      {!configured ? <Banner tone="error" text="Uygulama bulut adresi olmadan derlenmiş; fabrika sunucusu ekleyin" /> : null}
      {error ? <Banner tone="error" text={error} testID="giris-hata" /> : null}
      {step === 1 ? (
        <View>
          <Field label={who} value={eposta} onChangeText={setEposta} autoCapitalize="none" autoComplete={erp ? "username" : "email"} keyboardType={erp ? "default" : "email-address"} testID="eposta" />
          <Field label="Parola" value={parola} onChangeText={setParola} secureTextEntry autoComplete="password" testID="parola" />
          <View style={{ height: space.xs }} />
          {codeFirst ? (
            <Button label="Devam" icon="arrow-forward" disabled={!configured || eposta.trim() === "" || parola === ""} onPress={() => { setError(null); setStep(2); }} testID="devam" />
          ) : (
            <Button label="Giriş yap" icon="log-in-outline" busy={busy} disabled={!configured || eposta.trim() === "" || parola === ""} onPress={() => void submit("")} testID="giris" />
          )}
        </View>
      ) : (
        <View>
          <Field label="Doğrulama kodu" value={totp} onChangeText={(t) => setTotp(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" testID="totp"
            style={{ fontSize: 24, letterSpacing: 6, textAlign: "center" }} maxLength={6} placeholder="000000" />
          <Button label="Giriş yap" icon="log-in-outline" busy={busy} disabled={totp.length !== 6} onPress={() => void submit(totp)} testID="giris" />
          <Button label="Geri" tone="plain" onPress={() => { setStep(1); setTotp(""); setError(null); }} />
        </View>
      )}
    </AuthShell>
  );
}
