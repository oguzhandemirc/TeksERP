// Hesabımı sil (Google Play hesap silme politikası): açıklama → parola + güncel doğrulama kodu → iki adımlı onay.
// Başarıda sunucu bütün oturumları kapatmıştır; "Tamam" bu cihazdaki oturumu ve önbelleği de siler.
// Metinler ve testID'ler sözleşmedir (mağaza/gizlilik metni + `account-deletion.test.tsx`); burada yalnız görünüm.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import type { AccountDeletion } from "../../src/api/wire";
import { DELETION_EFFECTS, LAST_ADMIN_HINT, deletionDoneText } from "../../src/lib/account-deletion";
import { useSession } from "../../src/state/session";
import { Screen } from "../../src/ui/Frame";
import { Banner, Button, Card, ConfirmButton, Field } from "../../src/ui/kit";
import { makeStyles, useTokens } from "../../src/ui/theme-context";
import { radius, space, typography } from "../../src/ui/tokens";
import { useWrite } from "../../src/ui/useWrite";

export default function DeleteAccount() {
  const { api, logout } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const [parola, setParola] = useState("");
  const [totp, setTotp] = useState("");
  const [done, setDone] = useState<AccountDeletion | null>(null);
  const del = useWrite(useCallback(() => api.deleteOwnAccount({ parola, totp }), [api, parola, totp]));
  if (done) {
    return (
      <Screen title="Hesabımı sil" module="profil">
        <Banner tone="off" text={deletionDoneText(done)} testID="hesap-silindi" />
        <Button label="Tamam" onPress={() => void logout()} testID="hesap-silindi-tamam" />
      </Screen>
    );
  }
  return (
    <Screen title="Hesabımı sil" module="profil">
      <Card>
        <View style={s.head}>
          <View style={[s.icon, { backgroundColor: t.status.kritik.bg }]}>
            <Ionicons name={t.status.kritik.icon} size={26} color={t.status.kritik.fill} />
          </View>
          <Text style={s.title} accessibilityRole="header">Hesabınızı silerseniz</Text>
        </View>
        <View style={s.list}>
          {DELETION_EFFECTS.map((e) => <Text key={e} style={s.item}>{`• ${e}`}</Text>)}
        </View>
        <View style={[s.hint, { backgroundColor: t.status.bilgi.bg }]}>
          <Ionicons name={t.status.bilgi.icon} size={18} color={t.status.bilgi.fill} />
          <Text style={[s.hintText, { color: t.status.bilgi.text }]}>{LAST_ADMIN_HINT}</Text>
        </View>
      </Card>
      <View style={s.gap} />
      <Field label="Parola" value={parola} onChangeText={setParola} secureTextEntry testID="hesap-sil-parola" />
      <Field label="Doğrulama kodu" value={totp} onChangeText={(v) => setTotp(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" testID="hesap-sil-totp" />
      {del.error ? <Banner tone="error" text={del.error} testID="hesap-sil-hata" /> : null}
      <ConfirmButton
        label="Hesabımı kalıcı olarak sil"
        question="Hesabınız ve bütün fabrika üyelikleriniz hemen kapanacak. Emin misiniz?"
        busy={del.busy}
        disabled={del.disabled || parola === "" || totp.length !== 6}
        onConfirm={() => void del.run(totp).then((r) => { if (r) setDone(r); })}
        testID="hesap-sil"
      />
      <Button label="Vazgeç" tone="plain" onPress={() => router.back()} />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, marginBottom: space.m },
  icon: { width: 44, height: 44, borderRadius: radius.cardInner, alignItems: "center" as const, justifyContent: "center" as const },
  title: { ...typography.title3, color: t.text, flex: 1 },
  list: { gap: space.s },
  item: { ...typography.callout, color: t.text },
  hint: { flexDirection: "row" as const, gap: space.s, alignItems: "flex-start" as const, borderRadius: radius.cardInner, padding: space.m, marginTop: space.m },
  hintText: { ...typography.subhead, flex: 1 },
  gap: { height: space.s },
}));
