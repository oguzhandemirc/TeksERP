// Yeni cari fabrikaya GELEN KUTUSU üzerinden gider; kod ve mükerrer denetimi fabrikada.
// Gövde `buildCustomer` (forms.ts), gönderim `useWrite` (işlem kimliği kuralı) — yalnız görünüm yenilendi.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { buildCustomer } from "../../../src/lib/forms";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { haptic } from "../../../src/ui/haptics";
import { IconChip } from "../../../src/ui/IconChip";
import { Banner, Button, Field } from "../../../src/ui/kit";
import { SectionHeader } from "../../../src/ui/SectionHeader";
import { makeStyles, useTokens } from "../../../src/ui/theme-context";
import { STRIPE, TOUCH, radius, space, typography } from "../../../src/ui/tokens";
import { useWrite } from "../../../src/ui/useWrite";

function RoleToggle(p: { label: string; on: boolean; onPress: () => void; testID: string }) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Pressable
      onPress={() => { haptic("selection"); p.onPress(); }} testID={p.testID}
      accessibilityRole="checkbox" accessibilityState={{ checked: p.on }} accessibilityLabel={p.label}
      style={({ pressed }) => [s.toggle, p.on && { backgroundColor: t.domain.cariler.chip, borderColor: t.domain.cariler.fg }, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={p.on ? "checkmark-circle" : "ellipse-outline"} size={20} color={p.on ? t.domain.cariler.fg : t.textMuted} />
      <Text style={[s.toggleText, { color: p.on ? t.domain.cariler.fg : t.text }]}>{p.label}</Text>
    </Pressable>
  );
}

export default function NewCustomer() {
  const { api } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const [f, setF] = useState({ ad: "", musteri: true, tedarikci: false, il: "", vergiNo: "", telefon: "", eposta: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const built = buildCustomer(f);
  const send = useCallback((id: string) => (built.ok ? api.inboxCreate(id, "CARI", built.body) : Promise.reject(new Error(built.error))), [api, built]);
  const w = useWrite(send);
  const set = (patch: Partial<typeof f>) => setF((o) => ({ ...o, ...patch }));

  async function submit() {
    if (!built.ok) return setFormError(built.error);
    setFormError(null);
    const r = await w.run(JSON.stringify(built.body));
    if (r) router.replace({ pathname: "/gelen-kutusu/[mesajId]", params: { mesajId: r.mesajId } } as never);
  }
  const shown = formError ?? w.error;

  return (
    <Screen title="Yeni cari" module="cariler" back>
      <View style={s.intro}>
        <IconChip domain="gelenKutusu" icon="paper-plane-outline" size={32} />
        <Text style={s.introText}>Cari fabrikaya gelen kutusundan iletilir; kod ve mükerrer denetimi fabrikada yapılır.</Text>
      </View>
      <View style={s.card}>
        <View style={[s.stripe, { backgroundColor: t.domain.cariler.fg }]} />
        <Field label="Ad / unvan" value={f.ad} onChangeText={(v) => set({ ad: v })} testID="cari-ad" placeholder="Örn. Deniz Tekstil A.Ş." />
        <Text style={s.label}>Rol</Text>
        <View style={s.roles}>
          <RoleToggle label="Müşteri" on={f.musteri} onPress={() => set({ musteri: !f.musteri })} testID="rol-musteri" />
          <RoleToggle label="Tedarikçi" on={f.tedarikci} onPress={() => set({ tedarikci: !f.tedarikci })} testID="rol-tedarikci" />
        </View>
      </View>
      <SectionHeader title="Ayrıntılar" />
      <View style={s.card}>
        <View style={[s.stripe, { backgroundColor: t.domain.genel.fg }]} />
        <Field label="İl (isteğe bağlı)" value={f.il} onChangeText={(v) => set({ il: v })} />
        <Field label="Vergi no (isteğe bağlı)" value={f.vergiNo} onChangeText={(v) => set({ vergiNo: v.replace(/\D/g, "") })} keyboardType="number-pad" />
        <Field label="Telefon (isteğe bağlı)" value={f.telefon} onChangeText={(v) => set({ telefon: v })} keyboardType="phone-pad" />
        <Field label="E-posta (isteğe bağlı)" value={f.eposta} onChangeText={(v) => set({ eposta: v })} autoCapitalize="none" keyboardType="email-address" />
      </View>
      {shown ? <Banner tone="error" text={shown} /> : null}
      <Button label="Fabrikaya gönder" icon="paper-plane-outline" busy={w.busy} disabled={w.disabled} onPress={() => void submit()} testID="cari-gonder" />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  intro: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, marginBottom: space.m },
  introText: { ...typography.subhead, color: t.textSecondary, flex: 1 },
  card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, paddingLeft: space.l + STRIPE, marginBottom: space.m, overflow: "hidden" as const, ...t.cardShadow },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  label: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, marginBottom: space.xs },
  roles: { flexDirection: "row" as const, gap: space.s, flexWrap: "wrap" as const },
  toggle: { minHeight: TOUCH - 4, flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, paddingHorizontal: space.m, borderRadius: radius.chip, borderWidth: 1, borderColor: t.separator },
  toggleText: { ...typography.callout, fontWeight: "600" as const },
}));
