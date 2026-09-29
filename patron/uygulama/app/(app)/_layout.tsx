// Oturum kapısı: oturum yoksa girişe; geniş ekranda kalıcı menü + içerik. Bildirime dokunma oturum hazırken dinlenir.
import { Redirect, Slot } from "expo-router";
import { View } from "react-native";
import { useNotificationTaps } from "../../src/push/taps";
import { useSession } from "../../src/state/session";
import { SideNav, useWide } from "../../src/ui/Frame";
import { Loading } from "../../src/ui/kit";
import { color } from "../../src/ui/theme";

export default function AppLayout() {
  const { phase } = useSession();
  const wide = useWide();
  useNotificationTaps(phase === "hazir");
  if (phase === "yukleniyor") return <Loading />;
  if (phase !== "hazir") return <Redirect href="/giris" />;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: color.bg }}>
      {wide ? <SideNav /> : null}
      <View style={{ flex: 1 }}><Slot /></View>
    </View>
  );
}
