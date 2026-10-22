// Oturum kapısı: oturum yoksa girişe. İçerik bir yığındır (sekmeler + Diğer'den açılan bölümler); geniş ekranda
// (≥ 768) solda kalıcı ray. Bildirime dokunma oturum hazırken dinlenir.
import { Redirect, Stack } from "expo-router";
import { View } from "react-native";
import { useNotificationTaps } from "../../src/push/taps";
import { useSession } from "../../src/state/session";
import { SideNav, useWide } from "../../src/ui/Frame";
import { Loading } from "../../src/ui/kit";
import { useTokens } from "../../src/ui/theme-context";

export default function AppLayout() {
  const { phase } = useSession();
  const wide = useWide();
  const t = useTokens();
  useNotificationTaps(phase === "hazir");
  if (phase === "yukleniyor") return <Loading />;
  if (phase !== "hazir") return <Redirect href="/giris" />;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.bg }}>
      {wide ? <SideNav /> : null}
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
      </View>
    </View>
  );
}
