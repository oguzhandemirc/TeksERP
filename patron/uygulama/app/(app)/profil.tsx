// Profil: lacivert kimlik kartı (ad, e-posta, rol, tesis; çok tesiste fabrika değiştir), Görünüm (Sistem · Açık · Koyu —
// anında uygulanır, tercih cihazda saklanır), güvenlik (parola değişimi ayrı sayfada, TOTP ile), bildirimlere geçiş,
// hesabımı sil (ayrı ekran: açıklama + parola + TOTP), çıkış (iki adım).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { moduleDef, moduleTitle } from "../../src/lib/access";
import { MODULE_ICON } from "../../src/ui/icons";
import { ROLE_LABEL, roleOf } from "../../src/ui/RoleBadge";
import { useSession } from "../../src/state/session";
import { initials, GroupCaption, GroupNote } from "../../src/ui/diger/parts";
import { FacilitySwitchModal } from "../../src/ui/FacilitySwitcher";
import { Screen } from "../../src/ui/Frame";
import { Banner, Button, ConfirmButton, Field } from "../../src/ui/kit";
import { ListGroup, ListRow } from "../../src/ui/ListRow";
import { SegmentedControl } from "../../src/ui/SegmentedControl";
import { makeStyles, THEME_PREF_LABEL, THEME_PREFS, useThemePref, useTokens } from "../../src/ui/theme-context";
import { radius, READABLE_MAX, space, typography } from "../../src/ui/tokens";
import { useWrite } from "../../src/ui/useWrite";

// Lacivert kart her temada koyudur: üstündeki metin `onNavy` token'larındandır.

function PasswordSheet({ visible, onClose, onDone }: { readonly visible: boolean; readonly onClose: () => void; readonly onDone: () => void }) {
  const { api } = useSession();
  const t = useTokens();
  const s = useStyles();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [totp, setTotp] = useState("");
  const change = useWrite(useCallback(() => api.changePassword({ mevcutParola: cur, yeniParola: next, totp }).then(() => true), [api, cur, next, totp]));
  const close = () => {
    setCur("");
    setNext("");
    setTotp("");
    change.setError(null);
    onClose();
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "formSheet" : undefined} onRequestClose={close}>
      <View style={[s.sheet, { backgroundColor: t.bg }]} testID="parola-sayfasi">
        <View style={s.sheetBar}>
          <Text style={s.sheetTitle} accessibilityRole="header">Parola değiştir</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={close} hitSlop={12} testID="parola-kapat">
            <Ionicons name="close-circle" size={30} color={t.textMuted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
          <Text style={s.sheetNote}>Doğrulama kodu (TOTP) her girişte istenir; doğrulama uygulamanızı değiştirmek için tesis yöneticiniz daveti yeniler.</Text>
          <Field label="Mevcut parola" value={cur} onChangeText={setCur} secureTextEntry autoComplete="current-password" />
          <Field label="Yeni parola (en az 12 karakter)" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password"
            hint={next !== "" && next.length < 12 ? `${12 - next.length} karakter daha` : undefined} />
          <Field label="Doğrulama kodu" value={totp} onChangeText={(v) => setTotp(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" />
          {change.error ? <Banner tone="error" text={change.error} /> : null}
          <Button label="Parolayı değiştir" icon="key-outline" busy={change.busy} disabled={change.disabled || cur === "" || next.length < 12 || totp.length !== 6} testID="parola-kaydet"
            onPress={() => void change.run(totp).then((r) => { if (r) { setCur(""); setNext(""); setTotp(""); onDone(); } })} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function Profile() {
  const { facility, facilities, permissions, logout } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const { pref, setPref } = useThemePref();
  const [sheet, setSheet] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [ok, setOk] = useState(false);
  const role = roleOf(permissions);
  const hesap = facility?.hesap;
  const many = facilities.length > 1;
  return (
    <Screen module="profil">
      <View style={[s.hero, { backgroundColor: t.navy, borderColor: t.scheme === "dark" ? t.onNavy.separator : t.navy }]} testID="profil-kart">
        <View style={s.heroTop}>
          <View style={[s.avatar, { backgroundColor: role === "yonetici" ? t.gold : t.onNavy.chip }]}>
            <Text style={[s.avatarText, { color: role === "yonetici" ? t.navy : t.onNavy.tint }]} maxFontSizeMultiplier={1}>{initials(hesap?.ad)}</Text>
          </View>
          <View style={s.flex}>
            <Text style={[s.heroName, { color: t.onNavy.text }]} numberOfLines={2}>{hesap?.ad ?? ""}</Text>
            <Text style={[s.heroMail, { color: t.onNavy.textSecondary }]} numberOfLines={1}>{hesap?.eposta ?? ""}</Text>
          </View>
        </View>
        <View style={s.heroBadges}>
          <View style={[s.rolePill, role === "yonetici" ? { backgroundColor: t.gold } : { backgroundColor: t.onNavy.chip }]} testID="profil-rol" accessible accessibilityLabel={`Rol: ${ROLE_LABEL[role]}`}>
            <Ionicons name={role === "yonetici" ? "shield-checkmark" : "people"} size={14} color={role === "yonetici" ? t.navy : t.onNavy.tint} />
            <Text style={[s.roleText, { color: role === "yonetici" ? t.navy : t.onNavy.tint }]}>{ROLE_LABEL[role]}</Text>
          </View>
        </View>
        <View style={[s.heroSep, { backgroundColor: t.onNavy.separator }]} />
        <View style={s.facRow}>
          <Ionicons name="business-outline" size={18} color={t.onNavy.textSecondary} />
          <View style={s.flex}>
            <Text style={[s.facName, { color: t.onNavy.text }]} numberOfLines={1}>{facility?.tesis.ad ?? "—"}</Text>
            {many ? <Text style={[s.facMeta, { color: t.onNavy.textMuted }]}>{`${facilities.length} fabrikaya üyesiniz`}</Text> : null}
          </View>
          {many ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Fabrika değiştir" onPress={() => setSwitcher(true)} testID="fabrika-degistir"
              style={({ pressed }) => [s.switch, { backgroundColor: t.onNavy.chip }, pressed && { opacity: 0.8 }]}>
              <Ionicons name="swap-horizontal" size={16} color={t.onNavy.tint} />
              <Text style={[s.switchText, { color: t.onNavy.tint }]}>Değiştir</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {many ? <FacilitySwitchModal visible={switcher} onClose={() => setSwitcher(false)} /> : null}

      <GroupCaption>Görünüm</GroupCaption>
      <ListGroup testID="profil-gorunum">
        <View style={s.pad}>
          <SegmentedControl items={THEME_PREFS.map((k) => ({ key: k, label: THEME_PREF_LABEL[k] }))} value={pref} onChange={setPref} testIDPrefix="tema-" accessibilityLabel="Tema" />
        </View>
      </ListGroup>
      <GroupNote>Sistem seçiliyken telefonun açık/koyu ayarı izlenir. Seçim bu cihazda saklanır.</GroupNote>

      {ok ? <Banner tone="off" icon="checkmark-circle" text="Parola değişti" /> : null}
      <GroupCaption>Güvenlik</GroupCaption>
      <ListGroup>
        <ListRow title="Parola değiştir" subtitle="Mevcut parola ve kod gerekir" icon="key-outline" domain="genel" onPress={() => { setOk(false); setSheet(true); }} testID="parola-degistir" />
        <ListRow title="Doğrulama kodu (TOTP)" subtitle="Her girişte istenir" icon="shield-checkmark-outline" domain="genel" />
      </ListGroup>
      <GroupNote>Doğrulama uygulamanızı değiştirmek için tesis yöneticiniz daveti yeniler.</GroupNote>

      <GroupCaption>Bildirimler</GroupCaption>
      <ListGroup>
        <ListRow title={moduleTitle("bildirimler")} subtitle={moduleDef("bildirimler").hint} icon={MODULE_ICON.bildirimler.icon} domain={MODULE_ICON.bildirimler.domain}
          onPress={() => router.push("/bildirimler" as never)} testID="bildirim-ayarlari" />
      </ListGroup>

      <GroupCaption>Hesap</GroupCaption>
      <ListGroup>
        <ListRow title="Hesabımı sil" subtitle="Hesap ve bütün üyelikler kapanır" icon="trash-outline" domain="genel"
          onPress={() => router.push("/hesap-sil" as never)} testID="hesap-sil-git" />
      </ListGroup>
      <GroupNote>Hesabınızı ve bütün fabrika üyeliklerinizi kapatır; kişisel verileriniz 30. günde silinir.</GroupNote>
      <View style={s.logout}>
        <ConfirmButton label="Çıkış yap" question="Bütün fabrikalardaki oturumunuz kapatılsın ve bu cihazdaki son veri silinsin mi?" onConfirm={() => void logout()} testID="cikis" />
      </View>
      <PasswordSheet visible={sheet} onClose={() => setSheet(false)} onDone={() => { setSheet(false); setOk(true); }} />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1, minWidth: 0 },
  hero: { borderRadius: radius.card, padding: space.ml, marginTop: space.s, borderWidth: 1, ...t.cardShadow },
  heroTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.l },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center" as const, justifyContent: "center" as const },
  avatarText: { fontSize: 24, fontWeight: "700" as const },
  heroName: { ...typography.title2 },
  heroMail: { ...typography.subhead, marginTop: 2 },
  heroBadges: { flexDirection: "row" as const, marginTop: space.m, gap: space.s },
  rolePill: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, borderRadius: radius.chip, paddingHorizontal: space.m, paddingVertical: 4 },
  roleText: { ...typography.footnote, fontWeight: "700" as const },
  heroSep: { height: 1, marginVertical: space.l, opacity: 0.8 },
  facRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  facName: { ...typography.headline },
  facMeta: { ...typography.footnote, marginTop: 1 },
  switch: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs, borderRadius: radius.chip, paddingHorizontal: space.m, minHeight: 36 },
  switchText: { ...typography.subhead, fontWeight: "600" as const },
  pad: { padding: space.m },
  logout: { marginTop: space.l },
  sheet: { flex: 1 },
  sheetBar: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.s },
  sheetTitle: { ...typography.title2, color: t.text },
  sheetBody: { padding: space.l, maxWidth: READABLE_MAX, width: "100%" as const, alignSelf: "center" as const },
  sheetNote: { ...typography.subhead, color: t.textSecondary, marginBottom: space.l },
}));
