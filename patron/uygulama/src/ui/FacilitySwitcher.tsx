// Fabrika değiştir: dokununca DOĞRUDAN sayfa açılır (açılır liste yok). Liste sunucudan; etkin tesis işaretli,
// hizmet aşaması ACIK değilse rozet. Geçiş başarılıysa pano açılır (önceki tesisin kayıt yolu yeni tesiste yoktur).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSession } from "../state/session";
import { IconChip } from "./IconChip";
import { Banner, Button } from "./kit";
import { StatusBadge } from "./StatusBadge";
import { makeStyles, useTokens } from "./theme-context";
import { READABLE_MAX, TOUCH, radius, space, typography, type StatusKind } from "./tokens";

const PHASE_BADGE: Readonly<Record<string, { readonly label: string; readonly kind: StatusKind }>> = {
  SALT_OKUNUR: { label: "Salt okunur", kind: "uyari" },
  KAPALI: { label: "Kapalı", kind: "kritik" },
};

export function FacilitySwitchModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { facilities, facilityId, switchFacility, switchError } = useSession();
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const [busy, setBusy] = useState<string | null>(null);
  async function choose(id: string) {
    setBusy(id);
    const ok = await switchFacility(id);
    setBusy(null);
    if (ok) {
      onClose();
      router.replace("/pano" as never);
    }
  }
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false} presentationStyle={Platform.OS === "ios" ? "formSheet" : undefined}>
      <View style={s.sheet} testID="tesis-modal">
        <View style={s.bar}>
          <Text style={s.title} accessibilityRole="header">Fabrika değiştir</Text>
        </View>
        <Text style={s.note}>Üyesi olduğunuz fabrikalar. Geçince pano yeni fabrikanın verisiyle açılır.</Text>
        {switchError ? <Banner tone="error" text={switchError} testID="tesis-gecis-hatasi" /> : null}
        <ScrollView style={s.flex}>
          <View style={s.group}>
            {facilities.map((f, i) => {
              const active = f.id === facilityId;
              const badge = PHASE_BADGE[f.hizmet];
              return (
                <Pressable key={f.id} accessibilityRole="button" accessibilityState={{ selected: active, disabled: busy !== null }} disabled={busy !== null}
                  testID={`tesis-${f.id}`} onPress={() => (active ? onClose() : void choose(f.id))}
                  style={({ pressed }) => [s.row, i > 0 && s.sep, pressed && { backgroundColor: t.surfaceAlt }]}>
                  <IconChip domain={active ? "gelenKutusu" : "genel"} icon="business-outline" size={36} />
                  <Text style={[s.name, active && { color: t.tint, fontWeight: "700" }]} numberOfLines={1}>{f.ad}</Text>
                  {badge ? <View testID={`tesis-rozet-${f.id}`}><StatusBadge kind={badge.kind} label={badge.label} size="sm" /></View> : null}
                  {busy === f.id ? (
                    <ActivityIndicator color={t.tint} accessibilityLabel="Geçiliyor" />
                  ) : active ? (
                    <View style={s.active}>
                      <Ionicons name="checkmark-circle" size={20} color={t.tint} />
                      <Text style={[s.activeText, { color: t.tint }]}>Etkin</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <Button label="Kapat" tone="plain" onPress={onClose} testID="tesis-modal-kapat" />
      </View>
    </Modal>
  );
}

/** Profil satırı: yalnız birden çok tesiste görünür. */
export function FacilitySwitchButton() {
  const { facilities } = useSession();
  const [open, setOpen] = useState(false);
  if (facilities.length < 2) return null;
  return (
    <>
      <Button label="Fabrika değiştir" tone="plain" icon="swap-horizontal" onPress={() => setOpen(true)} testID="fabrika-degistir" />
      <FacilitySwitchModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  sheet: { flex: 1, backgroundColor: t.bg, padding: space.l, width: "100%" as const, maxWidth: READABLE_MAX, alignSelf: "center" as const },
  bar: { paddingTop: space.s, paddingBottom: space.xs },
  title: { ...typography.title2, color: t.text },
  note: { ...typography.subhead, color: t.textSecondary, marginBottom: space.m },
  group: { backgroundColor: t.surface, borderRadius: radius.card, overflow: "hidden" as const, ...t.cardShadow },
  row: { minHeight: TOUCH + 8, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s },
  sep: { borderTopWidth: 1, borderTopColor: t.separator },
  name: { ...typography.headline, fontWeight: "500" as const, color: t.text, flex: 1 },
  active: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
  activeText: { ...typography.subhead, fontWeight: "600" as const },
}));
