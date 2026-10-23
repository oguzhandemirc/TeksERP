// Davet: kod → parola → doğrulama uygulamasına sır (karekod + elle anahtar) → ilk kod. TOTP sırrı YALNIZ bu ekranda bir kez
// görünür; ekran kapanınca bellekten düşer (depoya yazılmaz). Zaten bulut hesabı olan kişi yeni hesap açmaz:
// e-posta + parola + TOTP ile mevcut kimliğini davetin fabrikasına bağlar (`/davet/bagla`; hata iletisi genel).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { ApiError, errorMessage } from "../src/api/client";
import type { InviteAccepted, InviteInfo } from "../src/api/wire";
import { formatDateTime } from "../src/lib/format";
import { useSession } from "../src/state/session";
import { AuthShell } from "../src/ui/diger/AuthShell";
import { Banner, Button, Field } from "../src/ui/kit";
import { TotpQr } from "../src/ui/TotpQr";
import { makeStyles, useTokens } from "../src/ui/theme-context";
import { radius, space, typography } from "../src/ui/tokens";

export default function Invite() {
  const { api } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
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

  const stage = done || linked ? "bitti" : info && linkMode ? "bagla" : secret ? "sir" : info ? "parola" : "kod";
  const head = {
    kod: { title: "Davet", subtitle: "Hesap yöneticinizin ilettiği davet kodunu girin", step: 1 },
    parola: { title: "Parolanızı belirleyin", subtitle: undefined, step: 2 },
    bagla: { title: "Mevcut hesabı bağla", subtitle: undefined, step: 2 },
    sir: { title: "Doğrulama uygulaması", subtitle: "Her girişte bu uygulamadaki 6 haneli kod istenir", step: 3 },
    bitti: { title: "Hazır", subtitle: undefined, step: 3 },
  }[stage];

  return (
    <AuthShell title={head.title} subtitle={head.subtitle} step={{ at: head.step, of: 3 }}>
      {error ? <Banner tone="error" text={error} /> : null}
      {done || linked ? (
        <View>
          <Banner tone="off" icon="checkmark-circle" text={linked ? "Fabrika hesabınıza bağlandı. Giriş yaptıktan sonra fabrika değiştirerek ulaşabilirsiniz." : "Hesabınız etkin. Şimdi giriş yapabilirsiniz."} />
          <Button label="Girişe dön" onPress={() => router.replace("/giris")} testID="davet-giris" />
        </View>
      ) : info && linkMode ? (
        <View>
          <Text style={s.lead}>{`${info.tesisAd ?? "Tesis"} · mevcut hesabınızla bağlanın`}</Text>
          <Field label="E-posta" value={linkEmail} onChangeText={setLinkEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" testID="bagla-eposta" />
          <Field label="Parola" value={linkPw} onChangeText={setLinkPw} secureTextEntry autoComplete="current-password" testID="bagla-parola" />
          <Field label="Doğrulama kodu" value={linkTotp} onChangeText={(v) => setLinkTotp(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" testID="bagla-totp" />
          <Button label="Bağla" icon="link-outline" busy={busy} disabled={linkEmail.trim() === "" || linkPw === "" || linkTotp.length !== 6} testID="bagla-gonder"
            onPress={() => void run(async () => { await api.inviteLink({ davet: code.trim(), eposta: linkEmail.trim(), parola: linkPw, totp: linkTotp }); setLinkPw(""); setLinkTotp(""); setLinked(true); })} />
          <Button label="Yeni hesap oluştur" tone="plain" onPress={() => { setLinkMode(false); setError(null); }} />
        </View>
      ) : secret ? (
        <View>
          <Text style={s.lead}>Doğrulama uygulamanızla (Google Authenticator, Microsoft Authenticator vb.) karekodu okutun:</Text>
          <TotpQr value={secret.otpauth} />
          <Text style={s.muted}>Karekod okutamıyorsanız bu anahtarı elle ekleyin:</Text>
          <View style={[s.keyBox, { backgroundColor: t.surfaceAlt, borderColor: t.separator }]}>
            <Ionicons name="key-outline" size={18} color={t.textSecondary} />
            <Text selectable style={[s.key, { color: t.text }]} testID="totp-sirri">
              {secret.totpSirri.replace(/(.{4})/g, "$1 ").trim()}
            </Text>
          </View>
          <Button label="Doğrulama uygulamasında aç" tone="plain" icon="open-outline" onPress={() => void Linking.openURL(secret.otpauth).catch(() => undefined)} />
          <Field label="Uygulamadaki 6 haneli kod" value={totp} onChangeText={(v) => setTotp(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
          <Button label="Onayla" icon="checkmark" busy={busy} disabled={totp.length !== 6} onPress={() => void run(async () => { await api.inviteConfirm(code.trim(), totp); setSecret(null); setDone(true); })} />
        </View>
      ) : info ? (
        <View>
          <View style={[s.who, { backgroundColor: t.surfaceAlt }]}>
            <Ionicons name="person-circle-outline" size={28} color={t.tint} />
            <View style={s.flex}>
              <Text style={s.whoName}>{`${info.ad} · ${info.eposta}`}</Text>
              <Text style={s.muted}>{`${info.tesisAd ?? "Tesis"} · davet ${formatDateTime(info.bitis)} tarihine kadar geçerli`}</Text>
            </View>
          </View>
          <Field label="Parola (en az 12 karakter)" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
          <Field label="Parola (tekrar)" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password"
            error={pw2 !== "" && pw !== pw2 ? "Parolalar aynı değil" : undefined} />
          <Button label="Devam" icon="arrow-forward" busy={busy} disabled={pw === "" || pw !== pw2} onPress={() => void run(async () => setSecret(await api.inviteAccept(code.trim(), pw)))} />
          <Button label="Zaten TeksERP Yönetim hesabım var — bağla" tone="plain" testID="davet-bagla"
            onPress={() => { setLinkMode(true); setLinkEmail(info.eposta); setError(null); }} />
        </View>
      ) : (
        <View>
          <Field label="Davet kodu" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} />
          <Button label="Devam" icon="arrow-forward" busy={busy} disabled={code.trim() === ""} onPress={() => void run(async () => setInfo(await api.inviteInspect(code.trim())))} />
          <Button label="Girişe dön" tone="plain" onPress={() => router.replace("/giris")} />
        </View>
      )}
    </AuthShell>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1, minWidth: 0 },
  lead: { ...typography.body, color: t.text, marginBottom: space.s },
  muted: { ...typography.subhead, color: t.textSecondary },
  keyBox: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, borderWidth: 1, borderRadius: radius.cardInner, padding: space.m, marginVertical: space.m },
  key: { fontSize: 20, fontWeight: "700" as const, letterSpacing: 2, flex: 1 },
  who: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, borderRadius: radius.cardInner, padding: space.m, marginBottom: space.l },
  whoName: { ...typography.headline, color: t.text },
}));
