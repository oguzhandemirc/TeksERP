// Fabrika değiştir: dokununca DOĞRUDAN modal açılır (açılır liste yok). Liste sunucudan; etkin tesis işaretli,
// hizmet aşaması ACIK değilse rozet. Geçiş başarılıysa pano açılır (önceki tesisin kayıt yolu yeni tesiste yoktur).
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSession } from "../state/session";
import { Banner, Button, Title } from "./kit";
import { TOUCH, color, space } from "./theme";

const PHASE_BADGE: Readonly<Record<string, string>> = { SALT_OKUNUR: "Salt okunur", KAPALI: "Kapalı" };

export function FacilitySwitchModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { facilities, facilityId, switchFacility, switchError } = useSession();
  const router = useRouter();
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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: color.bg, padding: space.l }} testID="tesis-modal">
        <Title>Fabrika değiştir</Title>
        {switchError ? <Banner tone="error" text={switchError} testID="tesis-gecis-hatasi" /> : null}
        <ScrollView style={{ flex: 1 }}>
          {facilities.map((f) => {
            const active = f.id === facilityId;
            const badge = PHASE_BADGE[f.hizmet];
            return (
              <Pressable key={f.id} accessibilityRole="button" accessibilityState={{ selected: active, disabled: busy !== null }} disabled={busy !== null}
                testID={`tesis-${f.id}`} onPress={() => (active ? onClose() : void choose(f.id))}
                style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: space.s, paddingHorizontal: space.m, marginBottom: space.xs, borderRadius: 8, borderWidth: 1, borderColor: active ? color.primary : color.line, backgroundColor: color.card }}>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: active ? "700" : "400", color: active ? color.primary : color.text }} numberOfLines={1}>{f.ad}</Text>
                {badge ? <Text testID={`tesis-rozet-${f.id}`} style={{ fontSize: 12, color: color.warn, borderWidth: 1, borderColor: color.warn, borderRadius: 6, paddingHorizontal: space.xs }}>{badge}</Text> : null}
                {busy === f.id ? <Text style={{ color: color.muted }}>…</Text> : active ? <Text style={{ color: color.primary }}>✓ Etkin</Text> : null}
              </Pressable>
            );
          })}
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
      <Button label="Fabrika değiştir" tone="plain" onPress={() => setOpen(true)} testID="fabrika-degistir" />
      <FacilitySwitchModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
